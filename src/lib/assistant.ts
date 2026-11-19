import type { GarageData, JobCard, Page } from "./types";

export type ActivityKind =
  | "create"
  | "update"
  | "delete"
  | "payment"
  | "status"
  | "system";

export interface ActivityEvent {
  id: string;
  at: string;
  actor: string;
  label: string;
  detail?: string;
  kind: ActivityKind;
}

export type ReminderSeverity = "urgent" | "warning" | "info";

export interface Reminder {
  id: string;
  severity: ReminderSeverity;
  title: string;
  detail: string;
  page: Page;
  search?: string;
}

export interface AssistantAction {
  label: string;
  page?: Page;
  search?: string;
  invoiceId?: string;
  tab?: "reminders" | "activity";
  query?: string;
}

export interface AssistantReply {
  text: string;
  actions?: AssistantAction[];
}

export interface AssistantPermissions {
  finance: boolean;
  inventory: boolean;
  appointments: boolean;
}

const ACTIVITY_LIMIT = 200;
const SNOOZE_MS = 12 * 60 * 60 * 1000;

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

function money(amount: number | string | null | undefined) {
  return currency.format(Number(amount ?? 0));
}

function dateKey(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
  });
}

function timeOf(value: string) {
  return new Date(value).toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const statusNames: Record<string, string> = {
  received: "Received",
  diagnosing: "Diagnosing",
  awaiting_approval: "Awaiting approval",
  in_progress: "In progress",
  awaiting_parts: "Awaiting parts",
  completed: "Completed",
  collected: "Collected",
};

function clearStoredAssistantData(storage: Storage) {
  const keys = Object.keys(storage).filter((key) =>
    key.startsWith("garageos-activity-") || key.startsWith("garageos-snoozes-"),
  );
  for (const key of keys) storage.removeItem(key);
}

export function clearLegacyAssistantStorage() {
  try {
    clearStoredAssistantData(window.localStorage);
  } catch {
    // Storage may be blocked by the browser.
  }
}

export function clearAssistantStorage() {
  clearLegacyAssistantStorage();
  try {
    clearStoredAssistantData(window.sessionStorage);
  } catch {
    // Storage may be blocked by the browser.
  }
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the assistant still works in-memory.
  }
}

export function loadActivity(scope: string): ActivityEvent[] {
  const stored = readStore<unknown>(`garageos-activity-${scope}`, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((event): event is ActivityEvent =>
    event && typeof event === "object" &&
    typeof event.id === "string" && typeof event.at === "string" &&
    Number.isFinite(Date.parse(event.at)) &&
    typeof event.actor === "string" && typeof event.label === "string" &&
    (event.detail === undefined || typeof event.detail === "string") &&
    ["create", "update", "delete", "payment", "status", "system"].includes(event.kind),
  ).slice(0, ACTIVITY_LIMIT);
}

export function saveActivity(workshopId: string, events: ActivityEvent[]) {
  writeStore(`garageos-activity-${workshopId}`, events.slice(0, ACTIVITY_LIMIT));
}

export function loadSnoozes(workshopId: string): Record<string, number> {
  const stored = readStore<unknown>(`garageos-snoozes-${workshopId}`, {});
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(stored).filter(([, until]) =>
      typeof until === "number" && Number.isFinite(until) && until > now && until <= now + SNOOZE_MS,
    ),
  );
}

export function saveSnoozes(workshopId: string, snoozes: Record<string, number>) {
  writeStore(`garageos-snoozes-${workshopId}`, snoozes);
}

export function snoozeUntil() {
  return Date.now() + SNOOZE_MS;
}

export function newActivityEvent(
  actor: string,
  label: string,
  kind: ActivityKind,
  detail?: string,
): ActivityEvent {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    at: new Date().toISOString(),
    actor,
    label,
    detail,
    kind,
  };
}

function isActive(job: JobCard) {
  return job.status !== "completed" && job.status !== "collected";
}

function balanceOf(invoice: { amount_total: number; amount_paid: number }) {
  return Math.max(0, Number(invoice.amount_total) - Number(invoice.amount_paid));
}

export function deriveReminders(
  data: GarageData,
  permissions: AssistantPermissions,
  now = Date.now(),
): Reminder[] {
  const reminders: Reminder[] = [];
  const today = dateKey(new Date(now));
  const soon = new Date(now + 2 * 60 * 60 * 1000);

  data.jobs.forEach((job) => {
    const plate = job.vehicle?.registration_number || "vehicle";
    const customer = job.customer?.full_name || "customer";
    if (isActive(job) && job.estimated_completion_date) {
      const due = dateKey(job.estimated_completion_date);
      if (due < today) {
        reminders.push({
          id: `job-overdue-${job.id}`,
          severity: "urgent",
          title: `${job.job_number} is past its completion date`,
          detail: `Was due ${shortDate(job.estimated_completion_date)} · ${plate} · ${statusNames[job.status]}. Update the customer or revise the estimate.`,
          page: "Jobs",
          search: job.job_number,
        });
      } else if (due === today) {
        reminders.push({
          id: `job-due-${job.id}`,
          severity: "warning",
          title: `${job.job_number} is due today`,
          detail: `${plate} for ${customer} · currently ${statusNames[job.status]}.`,
          page: "Jobs",
          search: job.job_number,
        });
      }
    }
    if (job.status === "awaiting_approval") {
      reminders.push({
        id: `job-approval-${job.id}`,
        severity: "warning",
        title: `Approval needed on ${job.job_number}`,
        detail: `${customer}${job.customer?.phone ? ` · ${job.customer.phone}` : ""} hasn't approved the diagnosis yet.`,
        page: "Jobs",
        search: job.job_number,
      });
    }
    if (job.status === "awaiting_parts") {
      reminders.push({
        id: `job-parts-${job.id}`,
        severity: "warning",
        title: `${job.job_number} is waiting on parts`,
        detail: `${plate} · check stock or place a supplier order to keep the repair moving.`,
        page: "Jobs",
        search: job.job_number,
      });
    }
    if (
      job.status === "completed" &&
      job.actual_completion_date &&
      dateKey(job.actual_completion_date) <= dateKey(new Date(now - 2 * 86400000))
    ) {
      reminders.push({
        id: `job-collect-${job.id}`,
        severity: "info",
        title: `${job.job_number} is ready for collection`,
        detail: `Finished ${shortDate(job.actual_completion_date)} · call ${customer} to arrange pickup.`,
        page: "Jobs",
        search: job.job_number,
      });
    }
    if (isActive(job) && !job.assigned_mechanic_id && job.status !== "awaiting_approval") {
      reminders.push({
        id: `job-unassigned-${job.id}`,
        severity: "info",
        title: `${job.job_number} has no mechanic assigned`,
        detail: `${plate} · ${statusNames[job.status]} · assign someone so work can start.`,
        page: "Jobs",
        search: job.job_number,
      });
    }
  });

  if (permissions.inventory) {
    data.parts.forEach((part) => {
      const quantity = Number(part.quantity_on_hand);
      const minimum = Number(part.minimum_stock);
      if (quantity <= 0) {
        reminders.push({
          id: `part-out-${part.id}`,
          severity: "urgent",
          title: `${part.name} is out of stock`,
          detail: `SKU ${part.sku} · reorder before the next job needs it.`,
          page: "Inventory",
          search: part.name,
        });
      } else if (quantity <= minimum) {
        reminders.push({
          id: `part-low-${part.id}`,
          severity: "warning",
          title: `${part.name} is running low`,
          detail: `${quantity} left · minimum level is ${minimum}.`,
          page: "Inventory",
          search: part.name,
        });
      }
    });
  }

  if (permissions.finance) {
    data.invoices.forEach((invoice) => {
      if (invoice.status === "paid") return;
      const balance = balanceOf(invoice);
      const customer = invoice.customer?.full_name || "customer";
      if (invoice.due_date && dateKey(invoice.due_date) < today) {
        reminders.push({
          id: `invoice-overdue-${invoice.id}`,
          severity: "urgent",
          title: `${invoice.invoice_number} is overdue`,
          detail: `${money(balance)} from ${customer} · was due ${shortDate(invoice.due_date)}. Send a payment reminder.`,
          page: "Invoices",
          search: invoice.invoice_number,
        });
      } else if (
        !invoice.due_date &&
        new Date(invoice.created_at).getTime() < now - 7 * 86400000
      ) {
        reminders.push({
          id: `invoice-aging-${invoice.id}`,
          severity: "warning",
          title: `${invoice.invoice_number} has been open over a week`,
          detail: `${money(balance)} from ${customer} · issued ${shortDate(invoice.created_at)} with no due date.`,
          page: "Invoices",
          search: invoice.invoice_number,
        });
      }
    });
  }

  if (permissions.appointments) {
    data.appointments.forEach((appointment) => {
      if (appointment.status !== "scheduled") return;
      const when = new Date(appointment.scheduled_at);
      if (when.getTime() < now) return;
      const customer = appointment.customer?.full_name || "customer";
      if (dateKey(when) === today) {
        const startingSoon = when.getTime() <= soon.getTime();
        reminders.push({
          id: `appointment-${appointment.id}`,
          severity: startingSoon ? "warning" : "info",
          title: startingSoon
            ? `${customer} arrives at ${timeOf(appointment.scheduled_at)}`
            : `Appointment today at ${timeOf(appointment.scheduled_at)}`,
          detail: `${customer}${appointment.vehicle?.registration_number ? ` · ${appointment.vehicle.registration_number}` : ""} · ${appointment.reason}.`,
          page: "Appointments",
          search: customer,
        });
      }
    });
  }

  const order: Record<ReminderSeverity, number> = {
    urgent: 0,
    warning: 1,
    info: 2,
  };
  return reminders.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function activeReminders(
  reminders: Reminder[],
  snoozes: Record<string, number>,
  now = Date.now(),
) {
  return reminders.filter((reminder) => (snoozes[reminder.id] ?? 0) <= now);
}

function jobLines(job: JobCard, data: GarageData): string {
  const invoice = data.invoices.find((item) => item.job_card_id === job.id);
  const lines = [
    `${job.job_number} · ${job.vehicle?.registration_number || "Vehicle"} (${job.vehicle?.make || ""} ${job.vehicle?.model || ""})`,
    `Status: ${statusNames[job.status]} · received ${shortDate(job.date_received)}`,
    `Customer: ${job.customer?.full_name || "—"}${job.customer?.phone ? ` · ${job.customer.phone}` : ""}`,
    `Mechanic: ${job.mechanic?.full_name || "Unassigned"}`,
    `Reported issue: ${job.reported_problem}`,
  ];
  if (job.estimated_completion_date) {
    lines.push(`Estimated completion: ${shortDate(job.estimated_completion_date)}`);
  }
  if (job.diagnosis) lines.push(`Diagnosis: ${job.diagnosis}`);
  if (invoice) {
    lines.push(
      `Invoice ${invoice.invoice_number}: ${money(invoice.amount_total)} total, ${money(balanceOf(invoice))} balance.`,
    );
  }
  return lines.join("\n");
}

export function answerQuery(
  raw: string,
  data: GarageData,
  permissions: AssistantPermissions,
  activity: ActivityEvent[],
  now = Date.now(),
): AssistantReply {
  const q = raw.trim().toLowerCase();
  const today = dateKey(new Date(now));
  const active = data.jobs.filter(isActive);
  const reminders = deriveReminders(data, permissions, now);

  if (!q) {
    return {
      text: "Ask me about jobs, customers, stock, invoices or appointments — or type “help” to see what I can do.",
    };
  }

  if (/(^|\b)(help|what can you do|commands|abilities)(\b|$)/.test(q)) {
    return {
      text: [
        "Here's what I can help with:",
        "• “What needs attention?” — live reminders across the workshop",
        "• “Overdue jobs” / “Overdue invoices” — chase lists",
        "• “Today's revenue” / “This month” — payment summaries",
        "• “Low stock” — parts at or below minimum",
        "• “Appointments today” — the day's schedule",
        "• “Job status” — how the floor is doing",
        "• A job number (JOB-2026-101), plate (KDA 123A), invoice number or customer name — instant lookup",
        "• “Recent activity” — everything the team has changed",
        "I also log every action automatically and surface reminders in the bell.",
      ].join("\n"),
      actions: [{ label: "See reminders", tab: "reminders" }],
    };
  }

  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(q)) {
    return {
      text: `Hello! ${active.length} active job${active.length === 1 ? "" : "s"} on the floor and ${reminders.length} open reminder${reminders.length === 1 ? "" : "s"}. What would you like to check?`,
      actions: [{ label: "What needs attention?", tab: "reminders" }],
    };
  }

  if (/(attention|reminder|task|to-?do|pending|urgent|focus|what should|priorit)/.test(q)) {
    if (!reminders.length) {
      return {
        text: "You're all caught up — no overdue jobs, stock alerts or unpaid invoices right now. Nice work.",
      };
    }
    const lines = reminders.slice(0, 6).map((reminder) => {
      const tag =
        reminder.severity === "urgent"
          ? "Urgent"
          : reminder.severity === "warning"
            ? "Soon"
            : "Note";
      return `• [${tag}] ${reminder.title} — ${reminder.detail}`;
    });
    if (reminders.length > 6) {
      lines.push(`…and ${reminders.length - 6} more in the Reminders tab.`);
    }
    return {
      text: [`${reminders.length} thing${reminders.length === 1 ? "" : "s"} need${reminders.length === 1 ? "s" : ""} attention:`, ...lines].join("\n"),
      actions: [
        { label: "Open reminders", tab: "reminders" },
        ...reminders.slice(0, 2).map((reminder) => ({
          label: reminder.title,
          page: reminder.page,
          search: reminder.search,
        })),
      ],
    };
  }

  const jobMatch = data.jobs.find((job) =>
    q.includes(job.job_number.toLowerCase()),
  );
  if (jobMatch) {
    const invoice = data.invoices.find(
      (item) => item.job_card_id === jobMatch.id,
    );
    const actions: AssistantAction[] = [
      { label: "Open in Jobs", page: "Jobs", search: jobMatch.job_number },
    ];
    if (invoice && permissions.finance) {
      actions.push({ label: `View ${invoice.invoice_number}`, invoiceId: invoice.id });
    }
    return { text: jobLines(jobMatch, data), actions };
  }

  const normalisedPlate = q.replace(/\s+/g, "");
  const vehicleMatch = data.vehicles.find(
    (vehicle) =>
      vehicle.registration_number.replace(/\s+/g, "").toLowerCase() ===
        normalisedPlate ||
      (normalisedPlate.length >= 5 &&
        vehicle.registration_number
          .replace(/\s+/g, "")
          .toLowerCase()
          .includes(normalisedPlate)),
  );
  if (vehicleMatch) {
    const jobs = data.jobs.filter((job) => job.vehicle_id === vehicleMatch.id);
    const lines = [
      `${vehicleMatch.registration_number} · ${vehicleMatch.make} ${vehicleMatch.model}${vehicleMatch.manufacturing_year ? ` (${vehicleMatch.manufacturing_year})` : ""}`,
      `Owner: ${vehicleMatch.customer?.full_name || "—"}`,
      jobs.length
        ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} on record:`
        : "No repair jobs recorded for this vehicle yet.",
      ...jobs
        .slice(0, 4)
        .map(
          (job) =>
            `• ${job.job_number} · ${statusNames[job.status]} · ${shortDate(job.date_received)}`,
        ),
    ];
    return {
      text: lines.join("\n"),
      actions: [
        { label: "Open in Vehicles", page: "Vehicles", search: vehicleMatch.registration_number },
        ...(jobs[0]
          ? [{ label: `Open ${jobs[0].job_number}`, page: "Jobs" as Page, search: jobs[0].job_number }]
          : []),
      ],
    };
  }

  if (permissions.finance) {
    const invoiceMatch = data.invoices.find((invoice) =>
      q.includes(invoice.invoice_number.toLowerCase()),
    );
    if (invoiceMatch) {
      const payments = data.payments.filter(
        (payment) =>
          payment.invoice?.invoice_number === invoiceMatch.invoice_number,
      );
      return {
        text: [
          `${invoiceMatch.invoice_number} · ${invoiceMatch.customer?.full_name || "Customer"}`,
          `Total ${money(invoiceMatch.amount_total)} · paid ${money(invoiceMatch.amount_paid)} · balance ${money(balanceOf(invoiceMatch))}`,
          `Status: ${invoiceMatch.status.replace("_", " ")} · issued ${shortDate(invoiceMatch.created_at)}${invoiceMatch.due_date ? ` · due ${shortDate(invoiceMatch.due_date)}` : ""}`,
          payments.length
            ? `${payments.length} payment${payments.length === 1 ? "" : "s"} recorded, latest ${shortDate(payments[0].paid_at)}.`
            : "No payments recorded yet.",
        ].join("\n"),
        actions: [
          { label: "Print invoice", invoiceId: invoiceMatch.id },
          { label: "Open Invoices", page: "Invoices", search: invoiceMatch.invoice_number },
        ],
      };
    }
  }

  if (/(revenue|sales|income|earned|money|payment|collected amount|turnover)/.test(q)) {
    if (!permissions.finance) {
      return {
        text: "Revenue and payment figures are restricted to owners, managers and accountants. Ask your workshop owner for access.",
      };
    }
    const monthKey = today.slice(0, 7);
    const todayPayments = data.payments.filter(
      (payment) => dateKey(payment.paid_at) === today,
    );
    const monthPayments = data.payments.filter(
      (payment) => dateKey(payment.paid_at).slice(0, 7) === monthKey,
    );
    const sum = (list: typeof data.payments) =>
      list.reduce((total, payment) => total + Number(payment.amount), 0);
    const outstanding = data.invoices.reduce(
      (total, invoice) => total + balanceOf(invoice),
      0,
    );
    const openCount = data.invoices.filter(
      (invoice) => invoice.status !== "paid",
    ).length;
    return {
      text: [
        `Today: ${money(sum(todayPayments))} from ${todayPayments.length} payment${todayPayments.length === 1 ? "" : "s"}.`,
        `This month: ${money(sum(monthPayments))} from ${monthPayments.length} payment${monthPayments.length === 1 ? "" : "s"}.`,
        `Outstanding: ${money(outstanding)} across ${openCount} open invoice${openCount === 1 ? "" : "s"}.`,
      ].join("\n"),
      actions: [
        { label: "Open Invoices", page: "Invoices" },
        { label: "View reports", page: "Reports" },
      ],
    };
  }

  if (/overdue|late|behind|past due|chase/.test(q)) {
    const overdueJobs = reminders.filter((r) => r.id.startsWith("job-overdue"));
    const overdueInvoices = reminders.filter((r) =>
      r.id.startsWith("invoice-overdue"),
    );
    if (!overdueJobs.length && !overdueInvoices.length) {
      return { text: "Nothing is overdue right now — every job is within its estimate and no invoice is past its due date." };
    }
    const lines: string[] = [];
    if (overdueJobs.length) {
      lines.push(`${overdueJobs.length} overdue job${overdueJobs.length === 1 ? "" : "s"}:`);
      overdueJobs.forEach((r) => lines.push(`• ${r.title} — ${r.detail}`));
    }
    if (overdueInvoices.length) {
      lines.push(`${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? "" : "s"}:`);
      overdueInvoices.forEach((r) => lines.push(`• ${r.title} — ${r.detail}`));
    }
    return {
      text: lines.join("\n"),
      actions: [
        ...(overdueJobs.length ? [{ label: "Open Jobs", page: "Jobs" as Page }] : []),
        ...(overdueInvoices.length ? [{ label: "Open Invoices", page: "Invoices" as Page }] : []),
      ],
    };
  }

  if (/(low stock|out of stock|stock|inventory|parts|reorder|spare)/.test(q)) {
    if (!permissions.inventory) {
      return {
        text: "Inventory details are restricted to owners and managers.",
      };
    }
    const low = data.parts.filter(
      (part) => Number(part.quantity_on_hand) <= Number(part.minimum_stock),
    );
    if (!low.length) {
      return {
        text: `All ${data.parts.length} tracked parts are above their minimum levels. Stock is healthy.`,
        actions: [{ label: "Open Inventory", page: "Inventory" }],
      };
    }
    return {
      text: [
        `${low.length} part${low.length === 1 ? "" : "s"} at or below minimum:`,
        ...low
          .slice(0, 6)
          .map(
            (part) =>
              `• ${part.name} (${part.sku}) — ${part.quantity_on_hand} left, min ${part.minimum_stock}`,
          ),
      ].join("\n"),
      actions: [{ label: "Open Inventory", page: "Inventory" }],
    };
  }

  if (/(appointment|booking|schedule|visit|calendar|arriv)/.test(q)) {
    if (!permissions.appointments) {
      return {
        text: "Appointment details are restricted to the front desk and workshop managers.",
      };
    }
    const scheduled = data.appointments
      .filter(
        (appointment) =>
          appointment.status === "scheduled" &&
          new Date(appointment.scheduled_at).getTime() >= now,
      )
      .sort(
        (a, b) =>
          new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
      );
    const todays = scheduled.filter(
      (appointment) => dateKey(appointment.scheduled_at) === today,
    );
    if (!scheduled.length) {
      return {
        text: "No upcoming appointments on the calendar.",
        actions: [{ label: "Open Appointments", page: "Appointments" }],
      };
    }
    const lines = [
      todays.length
        ? `${todays.length} appointment${todays.length === 1 ? "" : "s"} today:`
        : "No appointments today. Next visits:",
      ...(todays.length ? todays : scheduled.slice(0, 5)).map(
        (appointment) =>
          `• ${shortDate(appointment.scheduled_at)} ${timeOf(appointment.scheduled_at)} — ${appointment.customer?.full_name || "Customer"} · ${appointment.reason}`,
      ),
    ];
    return {
      text: lines.join("\n"),
      actions: [{ label: "Open Appointments", page: "Appointments" }],
    };
  }

  if (/(ready|collect|pickup|pick up|handover|finished)/.test(q)) {
    const ready = data.jobs.filter((job) => job.status === "completed");
    if (!ready.length) {
      return { text: "No completed jobs waiting for collection at the moment." };
    }
    return {
      text: [
        `${ready.length} job${ready.length === 1 ? "" : "s"} completed and ready for collection:`,
        ...ready
          .slice(0, 6)
          .map(
            (job) =>
              `• ${job.job_number} · ${job.vehicle?.registration_number || "vehicle"} · ${job.customer?.full_name || "customer"}${job.customer?.phone ? ` · ${job.customer.phone}` : ""}`,
          ),
      ].join("\n"),
      actions: [{ label: "Open Jobs", page: "Jobs", search: "completed" }],
    };
  }

  if (/(activity|log|happened|history|recent action|who did|monitor)/.test(q)) {
    if (!activity.length) {
      return {
        text: "No actions logged yet this session. I record every create, update, status change and payment as it happens — check the Activity tab.",
        actions: [{ label: "Open activity log", tab: "activity" }],
      };
    }
    return {
      text: [
        `Last ${Math.min(activity.length, 5)} of ${activity.length} logged action${activity.length === 1 ? "" : "s"}:`,
        ...activity
          .slice(0, 5)
          .map(
            (event) =>
              `• ${event.actor}: ${event.label}${event.detail ? ` — ${event.detail}` : ""}`,
          ),
      ].join("\n"),
      actions: [{ label: "Open activity log", tab: "activity" }],
    };
  }

  if (/(job|repair|floor|workshop|busy|status|summary|overview|how are we|doing)/.test(q)) {
    const counts = new Map<string, number>();
    data.jobs.forEach((job) =>
      counts.set(job.status, (counts.get(job.status) || 0) + 1),
    );
    const completedThisMonth = data.jobs.filter(
      (job) =>
        (job.status === "completed" || job.status === "collected") &&
        (job.actual_completion_date || job.date_received).slice(0, 7) ===
          today.slice(0, 7),
    ).length;
    const breakdown = Array.from(counts.entries())
      .map(([status, count]) => `• ${statusNames[status] || status}: ${count}`)
      .join("\n");
    return {
      text: [
        `${active.length} active job${active.length === 1 ? "" : "s"} across ${new Set(active.map((job) => job.vehicle_id)).size} vehicles. ${completedThisMonth} completed this month.`,
        breakdown || "No jobs recorded yet.",
      ].join("\n"),
      actions: [{ label: "Open Jobs", page: "Jobs" }],
    };
  }

  const customerMatch = data.customers.find((customer) => {
    const name = customer.full_name.toLowerCase();
    return (
      (q.length >= 3 && name.includes(q)) ||
      name.split(/\s+/).every((part) => part.length > 2 && q.includes(part))
    );
  });
  if (customerMatch) {
    const vehicles = data.vehicles.filter(
      (vehicle) => vehicle.customer_id === customerMatch.id,
    );
    const jobs = data.jobs.filter(
      (job) => job.customer_id === customerMatch.id,
    );
    const lines = [
      `${customerMatch.full_name} · ${customerMatch.phone}${customerMatch.email ? ` · ${customerMatch.email}` : ""}`,
      `${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"}: ${vehicles.map((v) => v.registration_number).join(", ") || "none registered"}`,
      `${jobs.length} job${jobs.length === 1 ? "" : "s"} on record${jobs.length ? ` · latest ${jobs[0].job_number} (${statusNames[jobs[0].status]})` : ""}.`,
    ];
    if (permissions.finance) {
      const balance = data.invoices
        .filter((invoice) => invoice.customer_id === customerMatch.id)
        .reduce((total, invoice) => total + balanceOf(invoice), 0);
      lines.push(`Outstanding balance: ${money(balance)}.`);
    }
    if (customerMatch.notes) lines.push(`Notes: ${customerMatch.notes}`);
    return {
      text: lines.join("\n"),
      actions: [
        { label: "Open in Customers", page: "Customers", search: customerMatch.full_name },
      ],
    };
  }

  if (/(thank|thanks|asante|great|nice|good job)/.test(q)) {
    return {
      text: "You're welcome! I'll keep watching the floor — the bell will light up if anything needs attention.",
    };
  }

  return {
    text: [
      `I didn't quite catch “${raw.trim()}”.`,
      "Try “what needs attention?”, “today's revenue”, “low stock”, “appointments today”, or paste a job number, plate, invoice number or customer name.",
    ].join("\n"),
    actions: [
      { label: "What needs attention?", tab: "reminders" },
      { label: "See what I can do", query: "help" },
    ],
  };
}