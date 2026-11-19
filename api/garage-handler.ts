import { createHash, randomBytes } from "node:crypto";
import { attachDatabasePool } from "@vercel/functions";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import type {
  Appointment,
  Customer,
  GarageData,
  Invoice,
  JobCard,
  JobStatus,
  Payment,
  Profile,
  Role,
  SparePart,
  Vehicle,
} from "../src/lib/types.js";

import {
  ApiError,
  consumeRateLimit,
  readJsonBody,
  secureResponse,
  validateRequest,
} from "../server/security.js";

const roleSchema = z.enum([
  "owner",
  "manager",
  "mechanic",
  "receptionist",
  "accountant",
]);
const jobStatusSchema = z.enum([
  "received",
  "diagnosing",
  "awaiting_approval",
  "in_progress",
  "awaiting_parts",
  "completed",
  "collected",
]);
const dateSchema = z.iso.date();
const moneySchema = z.number().finite().min(0).max(9_999_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.001,
    "Amounts must have at most two decimal places.");
const quantitySchema = quantitySchema.max(2_147_483_647);
const optionalDateSchema = dateSchema.nullable();
const emailSchema = z.string().trim().email().max(254);
const nameSchema = z.string().trim().min(1).max(160);
const idSchema = z.string().uuid();

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("workspace"),
    fullName: z.string().trim().min(1).max(120).optional(),
    inviteToken: z.string().min(32).max(256).optional(),
  }),
  z.object({ action: z.literal("data") }),
  z.object({
    action: z.literal("saveCustomer"),
    customerId: idSchema.optional(),
    fullName: nameSchema,
    phone: z.string().trim().min(3).max(32),
    email: emailSchema.nullable(),
    notes: z.string().trim().max(4000).nullable(),
  }),
  z.object({ action: z.literal("archiveCustomer"), customerId: idSchema }),
  z.object({
    action: z.literal("saveVehicle"),
    customerId: idSchema,
    registrationNumber: z.string().trim().min(2).max(20),
    make: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(100),
    manufacturingYear: z.number().int().min(1886).max(2200).nullable(),
    mileage: quantitySchema.nullable(),
    engineType: z.string().trim().max(80).nullable(),
  }),
  z.object({
    action: z.literal("saveAppointment"),
    customerId: idSchema,
    vehicleId: idSchema.nullable(),
    scheduledAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({ action: z.literal("cancelAppointment"), appointmentId: idSchema }),
  z.object({
    action: z.literal("inviteStaff"),
    email: emailSchema,
    fullName: z.string().trim().min(1).max(120),
    role: z.enum(["manager", "mechanic", "receptionist", "accountant"]),
  }),
  z.object({
    action: z.literal("saveJob"),
    customerId: idSchema,
    vehicleId: idSchema,
    reportedProblem: z.string().trim().min(1).max(4000),
    assignedMechanicId: idSchema.nullable(),
    estimatedCompletionDate: optionalDateSchema,
  }),
  z.object({
    action: z.literal("updateJobStatus"),
    jobId: idSchema,
    status: jobStatusSchema,
  }),
  z.object({
    action: z.literal("savePart"),
    name: z.string().trim().min(1).max(160),
    sku: z.string().trim().min(1).max(80),
    quantityOnHand: quantitySchema,
    minimumStock: quantitySchema,
    purchasePrice: moneySchema,
    sellingPrice: moneySchema,
  }),
  z.object({
    action: z.literal("recordPartUsage"),
    jobId: idSchema,
    partId: idSchema,
    quantity: quantitySchema.min(1),
  }),
  z.object({
    action: z.literal("saveInvoice"),
    jobId: idSchema,
    amountTotal: moneySchema.min(0.01),
    dueDate: optionalDateSchema,
  }),
  z.object({
    action: z.literal("recordPayment"),
    invoiceId: idSchema,
    amount: moneySchema.min(0.01),
    method: z.enum(["cash", "bank_transfer", "mpesa"]),
    reference: z.string().trim().max(120).nullable(),
  }),
  z.object({
    action: z.literal("saveWorkshop"),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("sendWhatsAppNotification"),
    jobId: idSchema,
    status: z.enum(["received", "awaiting_approval", "in_progress", "completed"]),
  }),
]);

type ActionInput = z.infer<typeof actionSchema>;
type AuthClaims = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};
type ProfileRow = {
  id: string;
  workshop_id: string;
  email: string;
  full_name: string;
  role: Role;
};
type RequestContext = {
  client: PoolClient;
  claims: AuthClaims;
  profile: ProfileRow;
};
type NotificationJob = {
  id: string;
  job_number: string;
  status: JobStatus;
  phone: string;
  registration_number: string | null;
};

let pool: Pool | undefined;
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new ApiError(503, "The server is missing its Neon database connection.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 15_000,
    });
    if (process.env.VERCEL) attachDatabasePool(pool);
  }
  return pool;
}

function getJwks() {
  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  if (!jwksUrl) {
    throw new ApiError(503, "The server is missing its Neon Auth JWKS URL.");
  }
  if (!jwks) jwks = createRemoteJWKSet(new URL(jwksUrl));
  return jwks;
}

async function authenticate(request: Request): Promise<AuthClaims> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new ApiError(401, "Sign in to continue.");

  const authBaseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!authBaseUrl) {
    throw new ApiError(503, "The server is missing its Neon Auth base URL.");
  }
  const origin = new URL(authBaseUrl).origin;

  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], getJwks(), {
      algorithms: ["EdDSA"],
      requiredClaims: ["exp", "sub", "email"],
      issuer: origin,
      audience: origin,
    }));
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) {
      throw new ApiError(401, "Your session is invalid or expired. Sign in again.");
    }
    console.error("Neon Auth token verification failed.");
    throw new ApiError(503, "Neon Auth could not verify your session.");
  }

  const claims = z
    .object({
      sub: idSchema,
      email: emailSchema,
      emailVerified: z.boolean().optional(),
      name: z.string().max(120).nullable().optional(),
    })
    .safeParse(payload);
  if (!claims.success) {
    throw new ApiError(401, "Your session is missing required account details.");
  }

  return {
    id: claims.data.sub,
    email: claims.data.email.toLowerCase(),
    emailVerified: claims.data.emailVerified === true,
    name: claims.data.name || null,
  };
}

async function setIdentity(
  client: PoolClient,
  claims: AuthClaims,
): Promise<void> {
  await client.query(
    `SELECT
       set_config('garageos.user_id', $1, true),
       set_config('garageos.user_email', $2, true)`,
    [claims.id, claims.email],
  );
}

async function selectProfile(
  client: PoolClient,
  userId: string,
): Promise<ProfileRow | null> {
  const result = await client.query<ProfileRow>(
    `SELECT id, workshop_id, email, full_name, role
     FROM public.profiles
     WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function createOrAcceptProfile(
  client: PoolClient,
  claims: AuthClaims,
  input: Extract<ActionInput, { action: "workspace" }>,
): Promise<ProfileRow> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    claims.id,
  ]);
  const existing = await selectProfile(client, claims.id);
  if (existing) return existing;

  if (!claims.emailVerified) {
    throw new ApiError(403, "Verify your email before creating a workshop or accepting an invitation.");
  }

  if (input.inviteToken) {
    const tokenHash = createHash("sha256")
      .update(input.inviteToken)
      .digest("hex");
    const inviteResult = await client.query<{
      id: string;
      workshop_id: string;
      email: string;
      full_name: string;
      role: Role;
    }>(
      `SELECT id, workshop_id, email, full_name, role
       FROM public.staff_invites
       WHERE token_hash = $1
         AND lower(email) = $2
         AND accepted_at IS NULL
         AND expires_at > now()
       FOR UPDATE`,
      [tokenHash, claims.email],
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      throw new ApiError(403, "This staff invitation is invalid or expired.");
    }

    await client.query("SELECT set_config('garageos.invite_token_hash', $1, true)", [tokenHash]);
    await client.query(
      `INSERT INTO public.profiles (id, workshop_id, email, full_name, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [claims.id, invite.workshop_id, claims.email, invite.full_name, invite.role],
    );
    await client.query(
      "UPDATE public.staff_invites SET accepted_at = now() WHERE id = $1",
      [invite.id],
    );
    return {
      id: claims.id,
      workshop_id: invite.workshop_id,
      email: claims.email,
      full_name: invite.full_name,
      role: invite.role,
    };
  }

  const workshopResult = await client.query<{ id: string }>(
    `INSERT INTO public.workshops (owner_id)
     VALUES ($1)
     ON CONFLICT (owner_id) DO NOTHING
     RETURNING id`,
    [claims.id],
  );
  const workshopId =
    workshopResult.rows[0]?.id ??
    (
      await client.query<{ id: string }>(
        "SELECT id FROM public.workshops WHERE owner_id = $1",
        [claims.id],
      )
    ).rows[0]?.id;
  if (!workshopId) {
    throw new ApiError(500, "Your workshop could not be created.");
  }

  const fullName =
    input.fullName?.trim() ||
    claims.name?.trim() ||
    claims.email.split("@")[0] ||
    "Workshop owner";
  await client.query(
    `INSERT INTO public.profiles (id, workshop_id, email, full_name, role)
     VALUES ($1, $2, $3, $4, 'owner')
     ON CONFLICT (id) DO NOTHING`,
    [claims.id, workshopId, claims.email, fullName],
  );
  const profile = await selectProfile(client, claims.id);
  if (!profile) throw new ApiError(500, "Your workshop profile could not be created.");

  await client.query(
    `SELECT set_config('garageos.workshop_id', $1, true)`,
    [profile.workshop_id],
  );
  await logActivity(client, profile, "workshop.created", "workshop", profile.workshop_id);
  return profile;
}

async function withProfileContext<T>(
  claims: AuthClaims,
  action: (
    context: RequestContext,
  ) => Promise<T>,
  bootstrap?: Extract<ActionInput, { action: "workspace" }>,
): Promise<T> {
  const client = await getPool().connect();
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE garageos_app");
    await setIdentity(client, claims);
    let profile = await selectProfile(client, claims.id);
    if (!profile && bootstrap) {
      profile = await createOrAcceptProfile(client, claims, bootstrap);
    }
    if (!profile) {
      throw new ApiError(
        403,
        "No workshop is linked to this account. Sign up as an owner or use a valid invitation.",
      );
    }

    await client.query(
      "SELECT set_config('garageos.workshop_id', $1, true)",
      [profile.workshop_id],
    );
    const result = await action({ client, claims, profile });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requireRoles(profile: ProfileRow, allowed: Role[]) {
  if (!allowed.includes(profile.role)) {
    throw new ApiError(403, "Your workshop role cannot perform this action.");
  }
}

async function logActivity(
  client: PoolClient,
  profile: ProfileRow,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO public.activity_logs
       (workshop_id, actor_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      profile.workshop_id,
      profile.id,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
    ],
  );
}

async function workspace(
  context: RequestContext,
): Promise<{ profile: Profile; workshopName: string }> {
  const result = await context.client.query<{ name: string }>(
    "SELECT name FROM public.workshops WHERE id = $1",
    [context.profile.workshop_id],
  );
  const workshopName = result.rows[0]?.name;
  if (!workshopName) throw new ApiError(404, "Workshop not found.");
  return {
    profile: {
      id: context.profile.id,
      workshop_id: context.profile.workshop_id,
      full_name: context.profile.full_name,
      role: context.profile.role,
      workshop: { name: workshopName },
    },
    workshopName,
  };
}

async function loadGarageData(context: RequestContext): Promise<GarageData> {
  const { client, profile } = context;
  const mayViewFinance = ["owner", "manager", "accountant"].includes(profile.role);
  const mayViewAppointments = ["owner", "manager", "receptionist"].includes(
    profile.role,
  );
  const [
    staff,
    customers,
    vehicles,
    jobs,
    parts,
    invoices,
    payments,
    appointments,
  ] = await Promise.all([
    client.query<GarageData["staff"][number]>(
      `SELECT id, full_name, role
       FROM public.profiles
       WHERE workshop_id = $1
       ORDER BY full_name
       LIMIT 500`,
      [profile.workshop_id],
    ),
    client.query<Customer>(
      `SELECT id, full_name, phone, email, notes, is_archived, created_at
       FROM public.customers
       WHERE workshop_id = $1 AND is_archived = false
       ORDER BY created_at DESC
       LIMIT 1000`,
      [profile.workshop_id],
    ),
    client.query<Vehicle>(
      `SELECT v.id, v.customer_id, v.registration_number, v.make, v.model,
              v.manufacturing_year, v.mileage, v.engine_type, v.photo_path,
              jsonb_build_object('full_name', c.full_name) AS customer
       FROM public.vehicles AS v
       JOIN public.customers AS c
         ON c.workshop_id = v.workshop_id AND c.id = v.customer_id
       WHERE v.workshop_id = $1
       ORDER BY v.created_at DESC
       LIMIT 1000`,
      [profile.workshop_id],
    ),
    client.query<JobCard>(
      `SELECT j.*,
              jsonb_build_object('full_name', c.full_name, 'phone', c.phone) AS customer,
              jsonb_build_object(
                'registration_number', v.registration_number,
                'make', v.make,
                'model', v.model
              ) AS vehicle,
              CASE WHEN m.id IS NULL THEN NULL
                ELSE jsonb_build_object('full_name', m.full_name)
              END AS mechanic
       FROM public.job_cards AS j
       JOIN public.customers AS c
         ON c.workshop_id = j.workshop_id AND c.id = j.customer_id
       JOIN public.vehicles AS v
         ON v.workshop_id = j.workshop_id AND v.id = j.vehicle_id
       LEFT JOIN public.profiles AS m
         ON m.workshop_id = j.workshop_id AND m.id = j.assigned_mechanic_id
       WHERE j.workshop_id = $1
       ORDER BY j.date_received DESC, j.created_at DESC
       LIMIT 500`,
      [profile.workshop_id],
    ),
    client.query<SparePart>(
      `SELECT id, name, sku, quantity_on_hand, minimum_stock,
              purchase_price, selling_price, supplier_id
       FROM public.spare_parts
       WHERE workshop_id = $1
       ORDER BY name
       LIMIT 1000`,
      [profile.workshop_id],
    ),
    mayViewFinance
      ? client.query<Invoice>(
          `SELECT i.id, i.invoice_number, i.job_card_id, i.customer_id,
                  i.amount_total, i.amount_paid, i.status, i.due_date, i.created_at,
                  jsonb_build_object('full_name', c.full_name) AS customer,
                  CASE WHEN j.id IS NULL THEN NULL
                    ELSE jsonb_build_object('job_number', j.job_number)
                  END AS job
           FROM public.invoices AS i
           JOIN public.customers AS c
             ON c.workshop_id = i.workshop_id AND c.id = i.customer_id
           LEFT JOIN public.job_cards AS j
             ON j.workshop_id = i.workshop_id AND j.id = i.job_card_id
           WHERE i.workshop_id = $1
           ORDER BY i.created_at DESC
           LIMIT 1000`,
          [profile.workshop_id],
        )
      : Promise.resolve({ rows: [] as Invoice[] }),
    mayViewFinance
      ? client.query<Payment>(
          `SELECT p.id, p.amount, p.method, p.reference, p.paid_at,
                  jsonb_build_object(
                    'invoice_number', i.invoice_number,
                    'customer', jsonb_build_object('full_name', c.full_name)
                  ) AS invoice
           FROM public.payments AS p
           JOIN public.invoices AS i
             ON i.workshop_id = p.workshop_id AND i.id = p.invoice_id
           JOIN public.customers AS c
             ON c.workshop_id = i.workshop_id AND c.id = i.customer_id
           WHERE p.workshop_id = $1
           ORDER BY p.paid_at DESC
           LIMIT 5000`,
          [profile.workshop_id],
        )
      : Promise.resolve({ rows: [] as Payment[] }),
    mayViewAppointments
      ? client.query<Appointment>(
          `SELECT a.id, a.customer_id, a.vehicle_id, a.scheduled_at,
                  a.reason, a.status,
                  jsonb_build_object('full_name', c.full_name) AS customer,
                  CASE WHEN v.id IS NULL THEN NULL
                    ELSE jsonb_build_object('registration_number', v.registration_number)
                  END AS vehicle
           FROM public.appointments AS a
           JOIN public.customers AS c
             ON c.workshop_id = a.workshop_id AND c.id = a.customer_id
           LEFT JOIN public.vehicles AS v
             ON v.workshop_id = a.workshop_id AND v.id = a.vehicle_id
           WHERE a.workshop_id = $1
             AND a.scheduled_at >= now() - interval '1 day'
           ORDER BY a.scheduled_at
           LIMIT 100`,
          [profile.workshop_id],
        )
      : Promise.resolve({ rows: [] as Appointment[] }),
  ]);

  return {
    staff: staff.rows,
    customers: customers.rows,
    vehicles: vehicles.rows,
    jobs: jobs.rows,
    parts: parts.rows,
    invoices: invoices.rows,
    payments: payments.rows,
    appointments: appointments.rows,
  };
}

async function saveCustomer(
  context: RequestContext,
  input: Extract<ActionInput, { action: "saveCustomer" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager", "receptionist"]);
  const values = [
    profile.workshop_id,
    input.fullName,
    input.phone,
    input.email?.toLowerCase() ?? null,
    input.notes || null,
  ];
  if (input.customerId) {
    const result = await client.query(
      `UPDATE public.customers
       SET full_name = $2, phone = $3, email = $4, notes = $5, updated_at = now()
       WHERE workshop_id = $1 AND id = $6
       RETURNING id`,
      [...values, input.customerId],
    );
    if (!result.rowCount) throw new ApiError(404, "Customer not found.");
    await logActivity(client, profile, "customer.updated", "customer", input.customerId);
  } else {
    const result = await client.query<{ id: string }>(
      `INSERT INTO public.customers
         (workshop_id, full_name, phone, email, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [...values, profile.id],
    );
    await logActivity(client, profile, "customer.created", "customer", result.rows[0].id);
  }
  return { saved: true };
}

async function saveVehicle(
  context: RequestContext,
  input: Extract<ActionInput, { action: "saveVehicle" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager", "receptionist"]);
  const customer = await client.query(
    "SELECT 1 FROM public.customers WHERE id = $1 AND workshop_id = $2 AND is_archived = false",
    [input.customerId, profile.workshop_id],
  );
  if (!customer.rowCount) throw new ApiError(404, "Customer not found.");
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.vehicles
       (workshop_id, customer_id, registration_number, make, model,
        manufacturing_year, mileage, engine_type, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      profile.workshop_id,
      input.customerId,
      input.registrationNumber.toUpperCase(),
      input.make,
      input.model,
      input.manufacturingYear,
      input.mileage,
      input.engineType || null,
      profile.id,
    ],
  );
  await logActivity(client, profile, "vehicle.created", "vehicle", result.rows[0].id);
  return { saved: true };
}

async function saveAppointment(
  context: RequestContext,
  input: Extract<ActionInput, { action: "saveAppointment" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager", "receptionist"]);
  if (input.vehicleId) {
    const vehicle = await client.query(
      `SELECT 1 FROM public.vehicles
       WHERE id = $1 AND customer_id = $2 AND workshop_id = $3`,
      [input.vehicleId, input.customerId, profile.workshop_id],
    );
    if (!vehicle.rowCount) {
      throw new ApiError(400, "The selected vehicle does not belong to this customer.");
    }
  }
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.appointments
       (workshop_id, customer_id, vehicle_id, scheduled_at, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      profile.workshop_id,
      input.customerId,
      input.vehicleId,
      input.scheduledAt,
      input.reason,
      profile.id,
    ],
  );
  await logActivity(
    client,
    profile,
    "appointment.created",
    "appointment",
    result.rows[0].id,
  );
  return { saved: true };
}

async function inviteStaff(
  context: RequestContext,
  input: Extract<ActionInput, { action: "inviteStaff" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager"]);
  if (profile.role === "manager" && input.role === "manager") {
    throw new ApiError(403, "Only an owner can invite another manager.");
  }
  const email = input.email.toLowerCase();
  const existing = await client.query(
    `SELECT 1 FROM public.profiles
     WHERE workshop_id = $1 AND lower(email) = $2`,
    [profile.workshop_id, email],
  );
  if (existing.rowCount) {
    throw new ApiError(409, "That email already belongs to a workshop member.");
  }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await client.query(
    `DELETE FROM public.staff_invites
     WHERE workshop_id = $1 AND lower(email) = $2 AND accepted_at IS NULL`,
    [profile.workshop_id, email],
  );
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.staff_invites
       (workshop_id, email, full_name, role, token_hash, invited_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [profile.workshop_id, email, input.fullName, input.role, tokenHash, profile.id],
  );
  await logActivity(
    client,
    profile,
    "staff.invited",
    "staff_invite",
    result.rows[0].id,
    { email, role: input.role },
  );
  return { token, expiresInDays: 7 };
}

async function saveJob(
  context: RequestContext,
  input: Extract<ActionInput, { action: "saveJob" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager", "receptionist"]);
  const vehicle = await client.query(
    `SELECT 1 FROM public.vehicles
     WHERE id = $1 AND customer_id = $2 AND workshop_id = $3`,
    [input.vehicleId, input.customerId, profile.workshop_id],
  );
  if (!vehicle.rowCount) {
    throw new ApiError(400, "The selected vehicle does not belong to this customer.");
  }
  if (input.assignedMechanicId) {
    const mechanic = await client.query(
      `SELECT 1 FROM public.profiles
       WHERE id = $1 AND workshop_id = $2 AND role = 'mechanic'`,
      [input.assignedMechanicId, profile.workshop_id],
    );
    if (!mechanic.rowCount) throw new ApiError(400, "Select a valid workshop mechanic.");
  }
  const result = await client.query<{ id: string; job_number: string }>(
    `INSERT INTO public.job_cards
       (workshop_id, customer_id, vehicle_id, reported_problem,
        assigned_mechanic_id, estimated_completion_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, job_number`,
    [
      profile.workshop_id,
      input.customerId,
      input.vehicleId,
      input.reportedProblem,
      input.assignedMechanicId,
      input.estimatedCompletionDate,
      profile.id,
    ],
  );
  const job = result.rows[0];
  await client.query(
    `INSERT INTO public.job_card_updates
       (workshop_id, job_card_id, author_id, status, note)
     VALUES ($1, $2, $3, 'received', 'Job card created')`,
    [profile.workshop_id, job.id, profile.id],
  );
  await logActivity(client, profile, "job.created", "job_card", job.id, {
    jobNumber: job.job_number,
  });
  return { id: job.id };
}

async function updateJobStatus(
  context: RequestContext,
  input: Extract<ActionInput, { action: "updateJobStatus" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager", "mechanic"]);
  const jobResult = await client.query<{
    id: string;
    assigned_mechanic_id: string | null;
    status: JobStatus;
  }>(
    `SELECT id, assigned_mechanic_id, status
     FROM public.job_cards
     WHERE id = $1 AND workshop_id = $2
     FOR UPDATE`,
    [input.jobId, profile.workshop_id],
  );
  const job = jobResult.rows[0];
  if (!job) throw new ApiError(404, "Repair job not found.");
  if (job.status === input.status) return { updated: true };
  if (
    profile.role === "mechanic" &&
    (job.assigned_mechanic_id !== profile.id ||
      !["diagnosing", "in_progress", "awaiting_parts", "completed"].includes(
        input.status,
      ))
  ) {
    throw new ApiError(403, "Mechanics may update progress only on their assigned jobs.");
  }
  await client.query(
    `UPDATE public.job_cards
     SET status = $1,
         actual_completion_date = CASE
           WHEN $1 = 'completed' THEN current_date
           WHEN $1 = 'collected' THEN actual_completion_date
           ELSE NULL
         END,
         updated_at = now()
     WHERE id = $2 AND workshop_id = $3`,
    [input.status, input.jobId, profile.workshop_id],
  );
  await client.query(
    `INSERT INTO public.job_card_updates
       (workshop_id, job_card_id, author_id, status)
     VALUES ($1, $2, $3, $4)`,
    [profile.workshop_id, input.jobId, profile.id, input.status],
  );
  await logActivity(client, profile, "job.status_changed", "job_card", input.jobId, {
    from: job.status,
    to: input.status,
  });
  return { updated: true };
}

async function savePart(
  context: RequestContext,
  input: Extract<ActionInput, { action: "savePart" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager"]);
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.spare_parts
       (workshop_id, name, sku, quantity_on_hand, minimum_stock,
        purchase_price, selling_price, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      profile.workshop_id,
      input.name,
      input.sku,
      input.quantityOnHand,
      input.minimumStock,
      input.purchasePrice.toFixed(2),
      input.sellingPrice.toFixed(2),
      profile.id,
    ],
  );
  if (input.quantityOnHand > 0) {
    await client.query(
      `INSERT INTO public.inventory_transactions
         (workshop_id, spare_part_id, transaction_type, quantity_change,
          unit_cost, note, created_by)
       VALUES ($1, $2, 'opening_stock', $3, $4, 'Opening stock', $5)`,
      [
        profile.workshop_id,
        result.rows[0].id,
        input.quantityOnHand,
        input.purchasePrice.toFixed(2),
        profile.id,
      ],
    );
  }
  await logActivity(client, profile, "inventory.part_created", "spare_part", result.rows[0].id);
  return { saved: true };
}

async function recordPartUsage(
  context: RequestContext,
  input: Extract<ActionInput, { action: "recordPartUsage" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager", "mechanic"]);
  const jobResult = await client.query<{
    id: string;
    assigned_mechanic_id: string | null;
    status: JobStatus;
  }>(
    `SELECT id, assigned_mechanic_id, status
     FROM public.job_cards
     WHERE id = $1 AND workshop_id = $2
     FOR UPDATE`,
    [input.jobId, profile.workshop_id],
  );
  const job = jobResult.rows[0];
  if (!job) throw new ApiError(404, "Repair job not found.");
  if (
    profile.role === "mechanic" &&
    job.assigned_mechanic_id !== profile.id
  ) {
    throw new ApiError(403, "You can record parts only on jobs assigned to you.");
  }
  if (job.status === "completed" || job.status === "collected") {
    throw new ApiError(409, "Parts cannot be recorded on a completed job.");
  }

  const partResult = await client.query<{
    purchase_price: string;
    selling_price: string;
  }>(
    `UPDATE public.spare_parts
     SET quantity_on_hand = quantity_on_hand - $1, updated_at = now()
     WHERE id = $2 AND workshop_id = $3 AND quantity_on_hand >= $1
     RETURNING purchase_price, selling_price`,
    [input.quantity, input.partId, profile.workshop_id],
  );
  const part = partResult.rows[0];
  if (!part) {
    const exists = await client.query(
      "SELECT 1 FROM public.spare_parts WHERE id = $1 AND workshop_id = $2",
      [input.partId, profile.workshop_id],
    );
    if (!exists.rowCount) throw new ApiError(404, "Spare part not found.");
    throw new ApiError(409, "There is not enough stock to complete this transaction.");
  }

  await client.query(
    `INSERT INTO public.job_part_usage
       (workshop_id, job_card_id, spare_part_id, quantity, unit_cost, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      profile.workshop_id,
      input.jobId,
      input.partId,
      input.quantity,
      part.purchase_price,
      profile.id,
    ],
  );
  await client.query(
    `INSERT INTO public.inventory_transactions
       (workshop_id, spare_part_id, job_card_id, transaction_type,
        quantity_change, unit_cost, note, created_by)
     VALUES ($1, $2, $3, 'usage', $4, $5, $6, $7)`,
    [
      profile.workshop_id,
      input.partId,
      input.jobId,
      -input.quantity,
      part.purchase_price,
      `Used on job ${input.jobId}`,
      profile.id,
    ],
  );
  await logActivity(client, profile, "inventory.part_used", "job_card", input.jobId, {
    partId: input.partId,
    quantity: input.quantity,
  });
  return { recorded: true };
}

async function saveInvoice(
  context: RequestContext,
  input: Extract<ActionInput, { action: "saveInvoice" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager", "accountant"]);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `invoice:${profile.workshop_id}:${input.jobId}`,
  ]);
  const job = await client.query<{ customer_id: string }>(
    `SELECT customer_id FROM public.job_cards
     WHERE id = $1 AND workshop_id = $2`,
    [input.jobId, profile.workshop_id],
  );
  if (!job.rowCount) throw new ApiError(404, "Repair job not found.");
  const existing = await client.query(
    "SELECT 1 FROM public.invoices WHERE workshop_id = $1 AND job_card_id = $2",
    [profile.workshop_id, input.jobId],
  );
  if (existing.rowCount) throw new ApiError(409, "This repair job already has an invoice.");
  const invoice = await client.query<{ id: string }>(
    `INSERT INTO public.invoices
       (workshop_id, job_card_id, customer_id, amount_total, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      profile.workshop_id,
      input.jobId,
      job.rows[0].customer_id,
      input.amountTotal.toFixed(2),
      input.dueDate,
      profile.id,
    ],
  );
  await logActivity(client, profile, "invoice.created", "invoice", invoice.rows[0].id);
  return { saved: true };
}

async function recordPayment(
  context: RequestContext,
  input: Extract<ActionInput, { action: "recordPayment" }>,
) {
  const { client, profile } = context;
  requireRoles(profile, ["owner", "manager", "accountant"]);
  const invoiceResult = await client.query<{
    id: string;
    amount_total: string;
    amount_paid: string;
  }>(
    `SELECT id, amount_total, amount_paid
     FROM public.invoices
     WHERE id = $1 AND workshop_id = $2
     FOR UPDATE`,
    [input.invoiceId, profile.workshop_id],
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) throw new ApiError(404, "Invoice not found.");
  const balanceCheck = await client.query<{ exceeds: boolean }>(
    "SELECT $1::numeric > ($2::numeric - $3::numeric) AS exceeds",
    [input.amount.toFixed(2), invoice.amount_total, invoice.amount_paid],
  );
  if (balanceCheck.rows[0].exceeds) {
    throw new ApiError(409, "Payment cannot exceed the outstanding invoice balance.");
  }
  const payment = await client.query<{ id: string }>(
    `INSERT INTO public.payments
       (workshop_id, invoice_id, amount, method, reference, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      profile.workshop_id,
      input.invoiceId,
      input.amount.toFixed(2),
      input.method,
      input.reference || null,
      profile.id,
    ],
  );
  await client.query(
    `UPDATE public.invoices
     SET amount_paid = amount_paid + $1::numeric,
         status = CASE
           WHEN amount_paid + $1::numeric >= amount_total THEN 'paid'
           WHEN amount_paid + $1::numeric > 0 THEN 'partially_paid'
           ELSE 'unpaid'
         END,
         updated_at = now()
     WHERE id = $2 AND workshop_id = $3`,
    [input.amount.toFixed(2), input.invoiceId, profile.workshop_id],
  );
  await logActivity(client, profile, "payment.recorded", "payment", payment.rows[0].id, {
    invoiceId: input.invoiceId,
    amount: input.amount.toFixed(2),
    method: input.method,
  });
  return { recorded: true };
}

const notificationMessages: Record<string, string> = {
  received: "Your vehicle has been received",
  awaiting_approval: "Your repair quotation is ready for approval",
  in_progress: "Work on your vehicle has started",
  completed: "Your repair is complete and your vehicle is ready",
};

async function getNotificationJob(
  claims: AuthClaims,
  input: Extract<ActionInput, { action: "sendWhatsAppNotification" }>,
): Promise<NotificationJob> {
  return withProfileContext(claims, async ({ client, profile }) => {
    requireRoles(profile, ["owner", "manager", "receptionist"]);
    const result = await client.query<NotificationJob>(
      `SELECT j.id, j.job_number, j.status, c.phone,
              v.registration_number
       FROM public.job_cards AS j
       JOIN public.customers AS c
         ON c.workshop_id = j.workshop_id AND c.id = j.customer_id
       JOIN public.vehicles AS v
         ON v.workshop_id = j.workshop_id AND v.id = j.vehicle_id
       WHERE j.id = $1 AND j.workshop_id = $2`,
      [input.jobId, profile.workshop_id],
    );
    const job = result.rows[0];
    if (!job) throw new ApiError(404, "Repair job not found in your workshop.");
    if (job.status !== input.status) {
      throw new ApiError(409, "The repair status changed. Refresh the job before notifying the customer.");
    }
    return job;
  });
}

async function sendWhatsAppNotification(job: NotificationJob) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!accessToken || !phoneNumberId || !graphVersion || !templateName) {
    throw new ApiError(503, "WhatsApp notifications are not configured.");
  }
  if (!/^\d+$/.test(phoneNumberId) || !/^v\d+\.\d+$/.test(graphVersion)) {
    throw new ApiError(503, "WhatsApp phone-number ID or Graph API version is invalid.");
  }
  const formattedPhone = job.phone.replace(/[\s().-]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(formattedPhone)) {
    throw new ApiError(422, "The customer needs a valid international phone number.");
  }
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: formattedPhone.replace(/^\+/, ""),
        type: "template",
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_LANGUAGE_CODE || "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: notificationMessages[job.status] },
                { type: "text", text: job.job_number },
                { type: "text", text: job.registration_number || "your vehicle" },
              ],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(502, "Meta returned an invalid WhatsApp response.");
  }
  if (!response.ok) {
    console.error("WhatsApp provider rejected a message.", { status: response.status });
    throw new ApiError(502, "WhatsApp message was not accepted. Check the notification configuration.");
  }
  const messageId =
    typeof result === "object" &&
    result !== null &&
    "messages" in result &&
    Array.isArray(result.messages) &&
    typeof result.messages[0] === "object" &&
    result.messages[0] !== null &&
    "id" in result.messages[0] &&
    typeof result.messages[0].id === "string"
      ? result.messages[0].id
      : null;
  if (!messageId) {
    throw new ApiError(502, "Meta did not confirm acceptance of the WhatsApp message.");
  }
  return { accepted_by_meta: true, message_id: messageId };
}

async function runAction(claims: AuthClaims, input: ActionInput) {
  if (input.action === "sendWhatsAppNotification") {
    const job = await getNotificationJob(claims, input);
    return sendWhatsAppNotification(job);
  }

  const bootstrap =
    input.action === "workspace"
      ? input
      : undefined;
  return withProfileContext(
    claims,
    async (context) => {
      const { client, profile } = context;
      switch (input.action) {
        case "workspace":
          return workspace(context);
        case "data":
          return loadGarageData(context);
        case "saveCustomer":
          return saveCustomer(context, input);
        case "archiveCustomer": {
          requireRoles(profile, ["owner", "manager", "receptionist"]);
          const result = await client.query(
            `UPDATE public.customers
             SET is_archived = true, updated_at = now()
             WHERE id = $1 AND workshop_id = $2
             RETURNING id`,
            [input.customerId, profile.workshop_id],
          );
          if (!result.rowCount) throw new ApiError(404, "Customer not found.");
          await logActivity(client, profile, "customer.archived", "customer", input.customerId);
          return { archived: true };
        }
        case "saveVehicle":
          return saveVehicle(context, input);
        case "saveAppointment":
          return saveAppointment(context, input);
        case "cancelAppointment": {
          requireRoles(profile, ["owner", "manager", "receptionist"]);
          const result = await client.query(
            `UPDATE public.appointments
             SET status = 'cancelled', updated_at = now()
             WHERE id = $1 AND workshop_id = $2
             RETURNING id`,
            [input.appointmentId, profile.workshop_id],
          );
          if (!result.rowCount) throw new ApiError(404, "Appointment not found.");
          await logActivity(
            client,
            profile,
            "appointment.cancelled",
            "appointment",
            input.appointmentId,
          );
          return { cancelled: true };
        }
        case "inviteStaff":
          return inviteStaff(context, input);
        case "saveJob":
          return saveJob(context, input);
        case "updateJobStatus":
          return updateJobStatus(context, input);
        case "savePart":
          return savePart(context, input);
        case "recordPartUsage":
          return recordPartUsage(context, input);
        case "saveInvoice":
          return saveInvoice(context, input);
        case "recordPayment":
          return recordPayment(context, input);
        case "saveWorkshop": {
          requireRoles(profile, ["owner"]);
          const result = await client.query(
            `UPDATE public.workshops
             SET name = $1
             WHERE id = $2
             RETURNING id`,
            [input.name, profile.workshop_id],
          );
          if (!result.rowCount) throw new ApiError(404, "Workshop not found.");
          await logActivity(client, profile, "workshop.updated", "workshop", profile.workshop_id);
          return { saved: true };
        }
      }
    },
    bootstrap,
  );
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, {
      status: error.status,
      headers: error.headers,
    });
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "23505") {
    return Response.json(
      { error: "A record with the same unique value already exists." },
      { status: 409 },
    );
  }
  if (code === "23503" || code === "23514" || code.startsWith("22")) {
    return Response.json(
      { error: "The submitted values do not match a valid workshop record." },
      { status: 400 },
    );
  }
  console.error("GarageOS API request failed.", { code: /^\w{5}$/.test(code) ? code : "internal" });
  return Response.json(
    { error: "The request could not be completed. Check the server logs." },
    { status: 500 },
  );
}

export async function handleGarageRequest(request: Request): Promise<Response> {
  try {
    validateRequest(request);
    const body = await readJsonBody(request);
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "The submitted values are invalid.");
    }
    const claims = await authenticate(request);
    consumeRateLimit(`user:${claims.id}`, 120, 60_000);
    if (parsed.data.action === "inviteStaff") {
      consumeRateLimit(`invites:${claims.id}`, 10, 3_600_000);
    }
    if (parsed.data.action === "sendWhatsAppNotification") {
      consumeRateLimit(`notifications:${claims.id}`, 20, 60_000);
      consumeRateLimit(`notification-job:${claims.id}:${parsed.data.jobId}`, 1, 60_000);
    }
    const result = await runAction(claims, parsed.data);
    return secureResponse(Response.json(result));
  } catch (error) {
    return secureResponse(errorResponse(error));
  }
}
