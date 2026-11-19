import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("Set DATABASE_URL_UNPOOLED or DATABASE_URL before seeding.");
}

const ownerEmail = process.env.SEED_OWNER_EMAIL;
const pool = new Pool({ connectionString, max: 1 });

const now = new Date();
const at = (dayOffset, hour, minute = 0) =>
  new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    hour,
    minute,
    0,
    0,
  );
const pad = (value) => String(value).padStart(2, "0");
const dateKey = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

let client;

try {
  client = await pool.connect();

  const owners = await client.query(
    `SELECT p.id, p.full_name, p.email, w.id AS workshop_id, w.name AS workshop_name
       FROM public.profiles p
       JOIN public.workshops w ON w.id = p.workshop_id
      WHERE p.role = 'owner'
      ORDER BY p.created_at, w.created_at`,
  );

  if (!owners.rowCount) {
    throw new Error("No workshop owner found. Sign up in the app first.");
  }

  let owner;
  if (ownerEmail) {
    owner = owners.rows.find(
      (row) => row.email.toLowerCase() === ownerEmail.toLowerCase(),
    );
    if (!owner) {
      throw new Error(`No owner profile found for ${ownerEmail}.`);
    }
  } else if (owners.rowCount === 1) {
    owner = owners.rows[0];
  } else {
    throw new Error(
      `Multiple owners found (${owners.rows
        .map((row) => row.email)
        .join(", ")}). Set SEED_OWNER_EMAIL to choose one.`,
    );
  }

  const workshopId = owner.workshop_id;
  const profileId = owner.id;

  const existing = await client.query(
    `SELECT
       (SELECT count(*) FROM public.customers WHERE workshop_id = $1) AS customers,
       (SELECT count(*) FROM public.job_cards WHERE workshop_id = $1) AS jobs,
       (SELECT count(*) FROM public.spare_parts WHERE workshop_id = $1) AS parts,
       (SELECT count(*) FROM public.invoices WHERE workshop_id = $1) AS invoices`,
    [workshopId],
  );
  const counts = existing.rows[0];
  if (
    Number(counts.customers) +
      Number(counts.jobs) +
      Number(counts.parts) +
      Number(counts.invoices) >
    0
  ) {
    throw new Error(
      `${owner.workshop_name} already has business data (customers=${counts.customers}, jobs=${counts.jobs}, parts=${counts.parts}, invoices=${counts.invoices}). Refusing to duplicate sample data.`,
    );
  }

  await client.query("BEGIN");

  const insertCustomer = async (customer) => {
    const result = await client.query(
      `INSERT INTO public.customers
         (workshop_id, full_name, phone, email, notes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        workshopId,
        customer.name,
        customer.phone,
        customer.email ?? null,
        customer.notes ?? null,
        profileId,
        customer.createdAt ?? at(-30, 9),
      ],
    );
    return result.rows[0].id;
  };

  const insertVehicle = async (vehicle) => {
    const result = await client.query(
      `INSERT INTO public.vehicles
         (workshop_id, customer_id, registration_number, make, model,
          manufacturing_year, mileage, engine_type, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        workshopId,
        vehicle.customerId,
        vehicle.registration,
        vehicle.make,
        vehicle.model,
        vehicle.year,
        vehicle.mileage,
        vehicle.engineType ?? "petrol",
        profileId,
        vehicle.createdAt ?? at(-30, 9),
      ],
    );
    return result.rows[0].id;
  };

  const insertPart = async (part) => {
    const result = await client.query(
      `INSERT INTO public.spare_parts
         (workshop_id, name, sku, quantity_on_hand, minimum_stock,
          purchase_price, selling_price, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        workshopId,
        part.name,
        part.sku,
        part.quantity,
        part.minimum,
        part.purchasePrice,
        part.sellingPrice,
        profileId,
        at(-60, 9),
      ],
    );
    return result.rows[0].id;
  };

  const insertJob = async (job) => {
    const result = await client.query(
      `INSERT INTO public.job_cards
         (workshop_id, job_number, customer_id, vehicle_id, reported_problem,
          inspection_notes, diagnosis, recommended_repairs, status, labour_charge,
          date_received, estimated_completion_date, actual_completion_date,
          created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        workshopId,
        job.number,
        job.customerId,
        job.vehicleId,
        job.problem,
        job.inspection ?? null,
        job.diagnosis ?? null,
        job.repairs ?? null,
        job.status,
        job.labour,
        dateKey(at(job.receivedOffset, 12)),
        job.estimatedOffset === null
          ? null
          : dateKey(at(job.estimatedOffset, 12)),
        job.completedOffset === null
          ? null
          : dateKey(at(job.completedOffset, 12)),
        profileId,
        at(job.receivedOffset, 9, 15),
      ],
    );
    return result.rows[0].id;
  };

  const insertInvoice = async (invoice) => {
    const result = await client.query(
      `INSERT INTO public.invoices
         (workshop_id, invoice_number, job_card_id, customer_id, amount_total,
          amount_paid, status, due_date, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        workshopId,
        invoice.number,
        invoice.jobId ?? null,
        invoice.customerId,
        invoice.total,
        invoice.paid,
        invoice.status,
        invoice.dueOffset === null ? null : dateKey(at(invoice.dueOffset, 12)),
        profileId,
        at(invoice.createdOffset, 10, 30),
      ],
    );
    return result.rows[0].id;
  };

  const insertPayment = async (payment) => {
    await client.query(
      `INSERT INTO public.payments
         (workshop_id, invoice_id, amount, method, reference, recorded_by, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        workshopId,
        payment.invoiceId,
        payment.amount,
        payment.method,
        payment.reference ?? null,
        profileId,
        at(payment.dayOffset, payment.hour, payment.minute ?? 0),
      ],
    );
  };

  const customers = {};
  const customerSpecs = [
    {
      key: "mercy",
      name: "Mercy Wanjiku",
      phone: "+254 712 445 890",
      email: "mercy.wanjiku@gmail.com",
      notes: "Prefers WhatsApp updates.",
      createdAt: at(-95, 9),
    },
    {
      key: "peter",
      name: "Peter Kamau",
      phone: "+254 722 118 340",
      email: "peter.kamau@outlook.com",
      createdAt: at(-120, 9),
    },
    {
      key: "faith",
      name: "Faith Njeri",
      phone: "+254 733 902 116",
      email: "faith.njeri@gmail.com",
      createdAt: at(-70, 9),
    },
    {
      key: "brian",
      name: "Brian Ochieng",
      phone: "+254 701 556 774",
      email: "brian.ochieng@gmail.com",
      notes: "Corporate account — invoice to Acme Logistics.",
      createdAt: at(-60, 9),
    },
    {
      key: "sarah",
      name: "Sarah Achieng",
      phone: "+254 715 330 208",
      createdAt: at(-45, 9),
    },
    {
      key: "james",
      name: "James Mwangi",
      phone: "+254 720 887 431",
      email: "jmwangi@gmail.com",
      createdAt: at(-38, 9),
    },
    {
      key: "grace",
      name: "Grace Nyambura",
      phone: "+254 799 204 651",
      email: "grace.nyambura@gmail.com",
      createdAt: at(-26, 9),
    },
    {
      key: "david",
      name: "David Kiptoo",
      phone: "+254 711 649 303",
      createdAt: at(-18, 9),
    },
  ];

  for (const spec of customerSpecs) {
    customers[spec.key] = await insertCustomer(spec);
  }

  const vehicles = {};
  const vehicleSpecs = [
    {
      key: "probox",
      customerId: customers.mercy,
      registration: "KBW 412J",
      make: "Toyota",
      model: "Probox",
      year: 2016,
      mileage: 142000,
      engineType: "petrol",
      createdAt: at(-95, 9),
    },
    {
      key: "note",
      customerId: customers.peter,
      registration: "KCZ 887T",
      make: "Nissan",
      model: "Note",
      year: 2017,
      mileage: 98000,
      createdAt: at(-120, 9),
    },
    {
      key: "demio",
      customerId: customers.faith,
      registration: "KCA 233K",
      make: "Mazda",
      model: "Demio",
      year: 2015,
      mileage: 167500,
      createdAt: at(-70, 9),
    },
    {
      key: "prado",
      customerId: customers.brian,
      registration: "KDG 776X",
      make: "Toyota",
      model: "Land Cruiser Prado",
      year: 2019,
      mileage: 62000,
      engineType: "diesel",
      createdAt: at(-60, 9),
    },
    {
      key: "forester",
      customerId: customers.sarah,
      registration: "KCF 558M",
      make: "Subaru",
      model: "Forester",
      year: 2018,
      mileage: 88000,
      createdAt: at(-45, 9),
    },
    {
      key: "dmax",
      customerId: customers.james,
      registration: "KDK 301P",
      make: "Isuzu",
      model: "D-Max",
      year: 2020,
      mileage: 54000,
      engineType: "diesel",
      createdAt: at(-38, 9),
    },
    {
      key: "fit",
      customerId: customers.grace,
      registration: "KCM 944B",
      make: "Honda",
      model: "Fit",
      year: 2016,
      mileage: 121000,
      createdAt: at(-26, 9),
    },
    {
      key: "hiace",
      customerId: customers.david,
      registration: "KBB 672D",
      make: "Toyota",
      model: "Hiace",
      year: 2013,
      mileage: 310000,
      engineType: "diesel",
      createdAt: at(-18, 9),
    },
    {
      key: "axio",
      customerId: customers.mercy,
      registration: "KDL 118G",
      make: "Toyota",
      model: "Axio",
      year: 2019,
      mileage: 47000,
      createdAt: at(-50, 9),
    },
    {
      key: "alto",
      customerId: customers.peter,
      registration: "KBS 550C",
      make: "Suzuki",
      model: "Alto",
      year: 2014,
      mileage: 133000,
      createdAt: at(-80, 9),
    },
  ];

  for (const spec of vehicleSpecs) {
    vehicles[spec.key] = await insertVehicle(spec);
  }

  const partSpecs = [
    { name: "Engine oil filter", sku: "OF-1042", quantity: 24, minimum: 10, purchasePrice: 350, sellingPrice: 650 },
    { name: "Brake pads (front)", sku: "BP-2210", quantity: 6, minimum: 8, purchasePrice: 2200, sellingPrice: 3400 },
    { name: "Air filter", sku: "AF-3080", quantity: 15, minimum: 5, purchasePrice: 800, sellingPrice: 1350 },
    { name: "Iridium spark plug", sku: "SP-4411", quantity: 40, minimum: 16, purchasePrice: 450, sellingPrice: 800 },
    { name: "Shock absorber", sku: "SA-5512", quantity: 4, minimum: 4, purchasePrice: 5500, sellingPrice: 8200 },
    { name: "Radiator hose", sku: "RH-7021", quantity: 9, minimum: 3, purchasePrice: 950, sellingPrice: 1650 },
    { name: "Wiper blade set", sku: "WB-8103", quantity: 12, minimum: 6, purchasePrice: 700, sellingPrice: 1200 },
    { name: "Clutch kit", sku: "CK-9204", quantity: 2, minimum: 3, purchasePrice: 12500, sellingPrice: 17500 },
    { name: "Battery 70Ah", sku: "BT-3345", quantity: 5, minimum: 2, purchasePrice: 9800, sellingPrice: 13500 },
    { name: "Headlight bulb H4", sku: "HL-4478", quantity: 30, minimum: 10, purchasePrice: 300, sellingPrice: 550 },
  ];
  for (const spec of partSpecs) {
    await insertPart(spec);
  }

  const jobs = {};
  const jobSpecs = [
    {
      key: "j101",
      number: "JOB-2026-101",
      customerId: customers.mercy,
      vehicleId: vehicles.probox,
      problem: "Engine overheating on long drives; coolant level keeps dropping.",
      inspection: "Coolant residue around the water pump housing.",
      diagnosis: "Water pump seal failing; thermostat opening late.",
      repairs: "Replace water pump and thermostat, flush cooling system.",
      status: "diagnosing",
      labour: 3500,
      receivedOffset: -2,
      estimatedOffset: 2,
      completedOffset: null,
    },
    {
      key: "j102",
      number: "JOB-2026-102",
      customerId: customers.peter,
      vehicleId: vehicles.note,
      problem: "Knocking noise from the front suspension over bumps.",
      status: "received",
      labour: 0,
      receivedOffset: -1,
      estimatedOffset: 3,
      completedOffset: null,
    },
    {
      key: "j103",
      number: "JOB-2026-103",
      customerId: customers.faith,
      vehicleId: vehicles.demio,
      problem: "Brakes squealing and the pedal feels soft.",
      diagnosis: "Front pads worn to 2 mm; discs slightly scored.",
      repairs: "Replace front pads and machine the discs.",
      status: "awaiting_approval",
      labour: 4500,
      receivedOffset: -3,
      estimatedOffset: 3,
      completedOffset: null,
    },
    {
      key: "j104",
      number: "JOB-2026-104",
      customerId: customers.brian,
      vehicleId: vehicles.prado,
      problem: "Air conditioning blows warm air.",
      diagnosis: "Condenser leak and low refrigerant charge.",
      repairs: "Replace condenser, vacuum test and regas.",
      status: "in_progress",
      labour: 7000,
      receivedOffset: -5,
      estimatedOffset: 1,
      completedOffset: null,
    },
    {
      key: "j105",
      number: "JOB-2026-105",
      customerId: customers.sarah,
      vehicleId: vehicles.forester,
      problem: "Check engine light on; engine idles roughly.",
      diagnosis: "Faulty ignition coil on cylinder 3. Replacement ordered.",
      status: "awaiting_parts",
      labour: 4000,
      receivedOffset: -4,
      estimatedOffset: 2,
      completedOffset: null,
    },
    {
      key: "j106",
      number: "JOB-2026-106",
      customerId: customers.james,
      vehicleId: vehicles.dmax,
      problem: "Clutch slips under load, especially uphill.",
      diagnosis: "Clutch kit worn; flywheel needs resurfacing.",
      repairs: "Replace clutch kit and resurface flywheel.",
      status: "in_progress",
      labour: 12000,
      receivedOffset: -6,
      estimatedOffset: 3,
      completedOffset: null,
    },
    {
      key: "j107",
      number: "JOB-2026-107",
      customerId: customers.grace,
      vehicleId: vehicles.fit,
      problem: "Scheduled 90,000 km service.",
      inspection: "All fluids checked; rear tyres at 4 mm.",
      diagnosis: "Service complete. Recommend tyres within 3 months.",
      status: "completed",
      labour: 3000,
      receivedOffset: -12,
      estimatedOffset: -4,
      completedOffset: -4,
    },
    {
      key: "j108",
      number: "JOB-2026-108",
      customerId: customers.david,
      vehicleId: vehicles.hiace,
      problem: "Starter motor clicks but the engine will not crank.",
      diagnosis: "Worn starter solenoid.",
      repairs: "Replace starter motor.",
      status: "collected",
      labour: 5500,
      receivedOffset: -20,
      estimatedOffset: -10,
      completedOffset: -10,
    },
    {
      key: "j109",
      number: "JOB-2026-109",
      customerId: customers.mercy,
      vehicleId: vehicles.axio,
      problem: "Rear brakes grinding; steering pulls slightly right.",
      diagnosis: "Rear pads metal-to-metal; alignment out of spec.",
      repairs: "Replace rear pads, machine discs, four-wheel alignment.",
      status: "completed",
      labour: 3200,
      receivedOffset: -15,
      estimatedOffset: -3,
      completedOffset: -3,
    },
  ];

  for (const spec of jobSpecs) {
    jobs[spec.key] = await insertJob(spec);
  }

  const invoices = {};
  const invoiceSpecs = [
    {
      key: "i041",
      number: "INV-2026-041",
      jobId: jobs.j107,
      customerId: customers.grace,
      total: 18400,
      paid: 18400,
      status: "paid",
      createdOffset: -4,
      dueOffset: 3,
    },
    {
      key: "i042",
      number: "INV-2026-042",
      jobId: jobs.j108,
      customerId: customers.david,
      total: 16750,
      paid: 16750,
      status: "paid",
      createdOffset: -9,
      dueOffset: -2,
    },
    {
      key: "i043",
      number: "INV-2026-043",
      jobId: jobs.j109,
      customerId: customers.mercy,
      total: 14200,
      paid: 14200,
      status: "paid",
      createdOffset: -3,
      dueOffset: 4,
    },
    {
      key: "i044",
      number: "INV-2026-044",
      jobId: jobs.j104,
      customerId: customers.brian,
      total: 24500,
      paid: 10000,
      status: "partially_paid",
      createdOffset: -2,
      dueOffset: 5,
    },
    {
      key: "i045",
      number: "INV-2026-045",
      jobId: jobs.j106,
      customerId: customers.james,
      total: 32000,
      paid: 8000,
      status: "partially_paid",
      createdOffset: -1,
      dueOffset: 7,
    },
    {
      key: "i046",
      number: "INV-2026-046",
      jobId: jobs.j105,
      customerId: customers.sarah,
      total: 19800,
      paid: 0,
      status: "unpaid",
      createdOffset: -3,
      dueOffset: 4,
    },
    {
      key: "i047",
      number: "INV-2026-047",
      jobId: null,
      customerId: customers.faith,
      total: 6700,
      paid: 0,
      status: "unpaid",
      createdOffset: -5,
      dueOffset: 2,
    },
    {
      key: "i048",
      number: "INV-2026-048",
      jobId: null,
      customerId: customers.peter,
      total: 4300,
      paid: 4300,
      status: "paid",
      createdOffset: -5,
      dueOffset: 2,
    },
  ];

  for (const spec of invoiceSpecs) {
    invoices[spec.key] = await insertInvoice(spec);
  }

  const paymentSpecs = [
    { invoiceId: invoices.i041, amount: 10000, method: "mpesa", reference: "QGH7412KP", dayOffset: -4, hour: 11, minute: 20 },
    { invoiceId: invoices.i041, amount: 8400, method: "cash", dayOffset: 0, hour: 9, minute: 20 },
    { invoiceId: invoices.i042, amount: 12000, method: "bank_transfer", reference: "KCB-88213", dayOffset: -8, hour: 14, minute: 5 },
    { invoiceId: invoices.i042, amount: 4750, method: "mpesa", reference: "SJ41KD9P", dayOffset: -6, hour: 16, minute: 40 },
    { invoiceId: invoices.i043, amount: 14200, method: "mpesa", reference: "QK92LM2X", dayOffset: -2, hour: 13, minute: 10 },
    { invoiceId: invoices.i044, amount: 10000, method: "bank_transfer", reference: "EQ-55120", dayOffset: -1, hour: 10, minute: 45 },
    { invoiceId: invoices.i045, amount: 8000, method: "mpesa", reference: "RK55QW1N", dayOffset: 0, hour: 15, minute: 45 },
    { invoiceId: invoices.i048, amount: 4300, method: "cash", dayOffset: -5, hour: 12, minute: 0 },
  ];
  for (const spec of paymentSpecs) {
    await insertPayment(spec);
  }

  const appointmentSpecs = [
    { customerId: customers.peter, vehicleId: vehicles.note, scheduledAt: at(1, 9, 30), reason: "Suspension noise inspection", status: "scheduled" },
    { customerId: customers.grace, vehicleId: vehicles.fit, scheduledAt: at(2, 11, 0), reason: "Post-service check and AC regas", status: "scheduled" },
    { customerId: customers.sarah, vehicleId: vehicles.forester, scheduledAt: at(4, 14, 30), reason: "Refit ignition coil once part arrives", status: "scheduled" },
    { customerId: customers.david, vehicleId: vehicles.hiace, scheduledAt: at(5, 10, 0), reason: "Brake inspection before long trip", status: "scheduled" },
    { customerId: customers.mercy, vehicleId: vehicles.probox, scheduledAt: at(-2, 16, 0), reason: "Coolant leak follow-up", status: "completed" },
  ];
  for (const spec of appointmentSpecs) {
    await client.query(
      `INSERT INTO public.appointments
         (workshop_id, customer_id, vehicle_id, scheduled_at, reason, status,
          created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        workshopId,
        spec.customerId,
        spec.vehicleId,
        spec.scheduledAt,
        spec.reason,
        spec.status,
        profileId,
        at(-7, 9),
      ],
    );
  }

  await client.query("COMMIT");

  console.log(`Seeded sample data for ${owner.workshop_name} (owner: ${owner.full_name})`);
  console.log(
    `  customers: ${customerSpecs.length}, vehicles: ${vehicleSpecs.length}, jobs: ${jobSpecs.length}`,
  );
  console.log(
    `  parts: ${partSpecs.length}, invoices: ${invoiceSpecs.length}, payments: ${paymentSpecs.length}, appointments: ${appointmentSpecs.length}`,
  );
} catch (error) {
  if (client) {
    await client.query("ROLLBACK").catch(() => {});
  }
  console.error(
    "Seeding failed:",
    error instanceof Error ? error.message : "Unexpected seeding error.",
  );
  process.exitCode = 1;
} finally {
  if (client) client.release();
  await pool.end();
}
