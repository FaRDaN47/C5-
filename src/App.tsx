import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CarFront,
  Check,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  CornerDownLeft,
  Download,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AssistantPanel, { type AssistantTab } from "./components/AssistantPanel";
import { garageApi } from "./lib/api";
import {
  activeReminders,
  deriveReminders,
  loadActivity,
  loadSnoozes,
  newActivityEvent,
  saveActivity,
  saveSnoozes,
  snoozeUntil,
  type ActivityEvent,
  type ActivityKind,
} from "./lib/assistant";
import { authClient, isNeonAuthConfigured, type AuthSessionData } from "./lib/auth";
import { whatsappNotificationsEnabled } from "./lib/config";
import type {
  Appointment,
  Customer,
  GarageData,
  Invoice,
  JobCard,
  JobStatus,
  Page,
  Payment,
  Profile,
  Role,
  SparePart,
  Vehicle,
} from "./lib/types";

type Modal =
  | "customer"
  | "vehicle"
  | "appointment"
  | "invite"
  | "job"
  | "part"
  | "usage"
  | "invoice"
  | "payment"
  | "workshop"
  | null;
type Toast = { text: string; kind: "success" | "error" | "info" };
type AuthMode = "sign_in" | "sign_up";
type Theme = "light" | "dark";

const emptyData: GarageData = {
  staff: [],
  customers: [],
  vehicles: [],
  jobs: [],
  parts: [],
  invoices: [],
  payments: [],
  appointments: [],
};

const jobStatuses: JobStatus[] = [
  "received",
  "diagnosing",
  "awaiting_approval",
  "in_progress",
  "awaiting_parts",
  "completed",
  "collected",
];

const statusNames: Record<JobStatus, string> = {
  received: "Received",
  diagnosing: "Diagnosing",
  awaiting_approval: "Awaiting approval",
  in_progress: "In progress",
  awaiting_parts: "Awaiting parts",
  completed: "Completed",
  collected: "Collected",
};

const navItems: { name: Page; icon: typeof LayoutDashboard }[] = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Jobs", icon: ClipboardList },
  { name: "Customers", icon: UsersRound },
  { name: "Vehicles", icon: CarFront },
  { name: "Appointments", icon: CalendarDays },
  { name: "Inventory", icon: Package },
  { name: "Invoices", icon: CircleDollarSign },
  { name: "Reports", icon: Activity },
  { name: "Team", icon: UsersRound },
];

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

function money(amount: number | string | null | undefined) {
  return currency.format(Number(amount ?? 0));
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function localDateKey(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function localMonthKey(value: string | Date = new Date()) {
  return localDateKey(value).slice(0, 7);
}

function initials(name: string | null | undefined) {
  return (name || "Garage").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function countDigits(value: string) {
  return (value.match(/\d/g) || []).length;
}

function hasErrors(errors: Record<string, string>) {
  return Object.keys(errors).length > 0;
}

function statusClass(status: string) {
  const classes: Record<string, string> = {
    received: "bg-slate-100 text-slate-600 ring-slate-500/10",
    diagnosing: "bg-blue-50 text-blue-700 ring-blue-600/10",
    awaiting_approval: "bg-amber-50 text-amber-700 ring-amber-600/10",
    in_progress: "bg-lime-50 text-lime-800 ring-lime-600/10",
    awaiting_parts: "bg-orange-50 text-orange-700 ring-orange-600/10",
    completed: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
    collected: "bg-slate-100 text-slate-500 ring-slate-500/10",
    unpaid: "bg-rose-50 text-rose-700 ring-rose-600/10",
    partially_paid: "bg-amber-50 text-amber-700 ring-amber-600/10",
    paid: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
    scheduled: "bg-blue-50 text-blue-700 ring-blue-600/10",
  };
  return classes[status] || "bg-slate-100 text-slate-600 ring-slate-500/10";
}

function statusDot(status: string) {
  const classes: Record<string, string> = {
    received: "bg-slate-400",
    diagnosing: "bg-blue-500",
    awaiting_approval: "bg-amber-500",
    in_progress: "bg-lime-500",
    awaiting_parts: "bg-orange-500",
    completed: "bg-emerald-500",
    collected: "bg-slate-400",
    unpaid: "bg-rose-500",
    partially_paid: "bg-amber-500",
    paid: "bg-emerald-500",
    scheduled: "bg-blue-500",
  };
  return classes[status] || "bg-slate-400";
}

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("garageos-theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  const [session, setSession] = useState<AuthSessionData | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("sign_in");
  const [authBusy, setAuthBusy] = useState(false);
  const [authVerificationPending, setAuthVerificationPending] = useState(false);
  const [authVerificationCode, setAuthVerificationCode] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [data, setData] = useState<GarageData>(emptyData);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [page, setPage] = useState<Page>("Overview");
  const [modal, setModal] = useState<Modal>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workshopName, setWorkshopName] = useState("");
  const [reportDays, setReportDays] = useState(30);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [jobCustomerId, setJobCustomerId] = useState("");
  const [appointmentCustomerId, setAppointmentCustomerId] = useState("");
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "" });
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteToken] = useState(
    () => new URLSearchParams(window.location.search).get("invite"),
  );
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("chat");
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [snoozes, setSnoozes] = useState<Record<string, number>>({});
  const [reminderTick, setReminderTick] = useState(() => Date.now());
  const seenReminderIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("garageos-theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#151d24" : "#eef0eb");
  }, [theme]);

  const refresh = useCallback(async () => {
    if (!profile?.workshop_id) return;
    setDataLoading(true);
    setDataError("");
    try {
      setData(await garageApi<GarageData>("data"));
    } catch (error) {
      setDataError(messageOf(error));
    } finally {
      setDataLoading(false);
    }
  }, [profile?.workshop_id]);

  useEffect(() => {
    if (!authClient) {
      setAuthReady(true);
      return;
    }
    let active = true;
    authClient
      .getSession()
      .then(({ data: result, error }) => {
        if (!active) return;
        if (error) setAuthError(error.message || "Unable to load your session.");
        setSession(result ?? null);
        setAuthReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAuthError(messageOf(error));
        setAuthReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!authClient || !session?.user) {
      setProfile(null);
      setProfileError("");
      setProfileLoading(false);
      return;
    }
    let active = true;
    setProfileLoading(true);
    setProfileError("");
    void (async () => {
      try {
        const result = await garageApi<{
          profile: Profile;
          workshopName: string;
        }>("workspace", {
          fullName: session.user.name || undefined,
          ...(inviteToken ? { inviteToken } : {}),
        });
        if (!active) return;
        setProfile(result.profile);
        setWorkshopName(result.workshopName);
        if (inviteToken) {
          const currentUrl = new URL(window.location.href);
          currentUrl.searchParams.delete("invite");
          window.history.replaceState({}, "", currentUrl);
        }
      } catch (error) {
        if (!active) return;
        setProfileError(messageOf(error));
      } finally {
        if (active) setProfileLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [inviteToken, session?.user?.id, session?.user?.name]);

  useEffect(() => {
    if (profile) void refresh();
  }, [profile, refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setAssistantOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setReminderTick(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!profile?.workshop_id) {
      setActivity([]);
      setSnoozes({});
      seenReminderIds.current = null;
      return;
    }
    setActivity(loadActivity(profile.workshop_id));
    setSnoozes(loadSnoozes(profile.workshop_id));
  }, [profile?.workshop_id]);

  const shortcutLabel =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘K"
      : "Ctrl K";

  const canManageJobs = profile
    ? ["owner", "manager", "receptionist"].includes(profile.role)
    : false;
  const canUpdateJobs = profile
    ? ["owner", "manager", "mechanic"].includes(profile.role)
    : false;
  const canRecordParts = profile
    ? ["owner", "manager", "mechanic"].includes(profile.role)
    : false;
  const canManageCustomers = profile
    ? ["owner", "manager", "receptionist"].includes(profile.role)
    : false;
  const canManageInventory = profile
    ? ["owner", "manager"].includes(profile.role)
    : false;
  const canManageInvoices = profile
    ? ["owner", "manager", "accountant"].includes(profile.role)
    : false;
  const canManageTeam = profile
    ? ["owner", "manager"].includes(profile.role)
    : false;
  const visibleNavItems = navItems.filter(({ name }) => {
    if (name === "Inventory") return canManageInventory;
    if (name === "Invoices" || name === "Reports") return canManageInvoices;
    if (name === "Appointments") return canManageCustomers;
    if (name === "Team") return canManageTeam;
    return true;
  });

  const assistantPermissions = useMemo(
    () => ({
      finance: canManageInvoices,
      inventory: canManageInventory,
      appointments: canManageCustomers,
    }),
    [canManageInvoices, canManageInventory, canManageCustomers],
  );

  const reminders = useMemo(
    () =>
      activeReminders(
        deriveReminders(data, assistantPermissions, reminderTick),
        snoozes,
        reminderTick,
      ),
    [data, assistantPermissions, snoozes, reminderTick],
  );

  useEffect(() => {
    if (dataLoading) return;
    const currentIds = new Set(reminders.map((reminder) => reminder.id));
    const previous = seenReminderIds.current;
    seenReminderIds.current = currentIds;
    const fresh = previous
      ? reminders.filter(
          (reminder) =>
            !previous.has(reminder.id) && reminder.severity !== "info",
        )
      : reminders.filter((reminder) => reminder.severity !== "info");
    if (!fresh.length || assistantOpen) return;
    const urgent = fresh.filter((reminder) => reminder.severity === "urgent").length;
    setToast((current) =>
      current ?? {
        text: urgent
          ? `Assistant: ${urgent} urgent item${urgent === 1 ? "" : "s"} need${urgent === 1 ? "s" : ""} attention — open the bell to review.`
          : `Assistant: ${fresh.length} new reminder${fresh.length === 1 ? "" : "s"} — open the bell to review.`,
        kind: "info",
      },
    );
  }, [reminders, dataLoading, assistantOpen]);

  const logActivity = useCallback(
    (label: string, kind: ActivityKind, detail?: string) => {
      if (!profile?.workshop_id) return;
      const event = newActivityEvent(
        profile.full_name || "Staff",
        label,
        kind,
        detail,
      );
      setActivity((current) => {
        const next = [event, ...current].slice(0, 200);
        saveActivity(profile.workshop_id, next);
        return next;
      });
    },
    [profile?.workshop_id, profile?.full_name],
  );

  const runAction = async (
    action: () => Promise<void>,
    successText = "Changes saved",
    activityEntry?: { label: string; kind: ActivityKind; detail?: string },
  ) => {
    try {
      await action();
      setFormErrors({});
      if (activityEntry) {
        logActivity(activityEntry.label, activityEntry.kind, activityEntry.detail);
      }
      setToast({ text: successText, kind: "success" });
    } catch (error) {
      setToast({ text: messageOf(error), kind: "error" });
    }
  };

  const authenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authClient) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      if (authMode === "sign_up") {
        const { data: result, error } = await authClient.signUp.email({
          email: authForm.email.trim(),
          password: authForm.password,
          name: authForm.name.trim(),
        });
        if (error) throw error;
        if (result?.user && !result.token) {
          setAuthVerificationPending(true);
          setAuthError("Enter the verification code sent to your email.");
          return;
        }
      } else {
        const { error } = await authClient.signIn.email({
          email: authForm.email.trim(),
          password: authForm.password,
        });
        if (error) throw error;
      }
      const { data: current, error } = await authClient.getSession();
      if (error) throw error;
      setSession(current ?? null);
    } catch (error) {
      setAuthError(messageOf(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const verifyEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authClient) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await authClient.$fetch("/email-otp/verify-email", {
        method: "POST",
        body: {
          email: authForm.email.trim(),
          otp: authVerificationCode.trim(),
        },
      });
      if (error) throw error;
      setAuthVerificationPending(false);
      setAuthVerificationCode("");
      const { data: current, error: sessionError } =
        await authClient.getSession();
      if (sessionError) throw sessionError;
      if (current?.session) {
        setSession(current);
      } else {
        setAuthMode("sign_in");
        setAuthError("Email verified. Sign in to continue.");
      }
    } catch (error) {
      setAuthError(messageOf(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    if (!authClient) return;
    const { error } = await authClient.signOut();
    if (error) setToast({ text: error.message || "Unable to sign out.", kind: "error" });
    else {
      setData(emptyData);
      setSession(null);
      setToast(null);
    }
  };

  const saveCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("full_name") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    const email = String(form.get("email") || "").trim();
    const errors: Record<string, string> = {};
    if (fullName.length < 2) errors.full_name = "Enter the customer's full name.";
    if (countDigits(phone) < 7) errors.phone = "Enter a phone number with at least 7 digits.";
    if (email && !emailPattern.test(email)) errors.email = "Enter a valid email address.";
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    await runAction(async () => {
      await garageApi("saveCustomer", {
        customerId: customerToEdit?.id,
        fullName,
        phone,
        email: email || null,
        notes: String(form.get("notes") || "").trim() || null,
      });
      await refresh();
      setCustomerToEdit(null);
      setModal(null);
    }, customerToEdit ? "Customer updated" : "Customer added", {
      label: customerToEdit ? "Updated customer" : "Added customer",
      kind: customerToEdit ? "update" : "create",
      detail: fullName,
    });
  };

  const archiveCustomer = async (customer: Customer) => {
    if (!window.confirm(`Archive ${customer.full_name}?`)) return;
    await runAction(async () => {
      await garageApi("archiveCustomer", { customerId: customer.id });
      await refresh();
    }, "Customer archived", {
      label: "Archived customer",
      kind: "delete",
      detail: customer.full_name,
    });
  };

  const saveVehicle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customerId = String(form.get("customer_id") || "");
    const registrationNumber = String(form.get("registration_number") || "").trim();
    const make = String(form.get("make") || "").trim();
    const model = String(form.get("model") || "").trim();
    const yearRaw = String(form.get("manufacturing_year") || "");
    const mileageRaw = String(form.get("mileage") || "");
    const errors: Record<string, string> = {};
    if (!customerId) errors.customer_id = "Select the vehicle owner.";
    if (!registrationNumber) errors.registration_number = "Enter the registration number.";
    if (!make) errors.make = "Enter the vehicle make.";
    if (!model) errors.model = "Enter the vehicle model.";
    if (yearRaw) {
      const year = Number(yearRaw);
      if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1) {
        errors.manufacturing_year = `Use a year between 1900 and ${new Date().getFullYear() + 1}.`;
      }
    }
    if (mileageRaw && (!Number.isFinite(Number(mileageRaw)) || Number(mileageRaw) < 0)) {
      errors.mileage = "Mileage cannot be negative.";
    }
    const normalised = registrationNumber.replace(/\s+/g, "").toLowerCase();
    if (
      normalised &&
      data.vehicles.some(
        (vehicle) => vehicle.registration_number.replace(/\s+/g, "").toLowerCase() === normalised,
      )
    ) {
      errors.registration_number = "This registration number is already on file.";
    }
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    await runAction(async () => {
      await garageApi("saveVehicle", {
        customerId,
        registrationNumber,
        make,
        model,
        manufacturingYear: yearRaw ? Number(yearRaw) : null,
        mileage: mileageRaw ? Number(mileageRaw) : null,
        engineType: String(form.get("engine_type") || "").trim() || null,
      });
      await refresh();
      setModal(null);
    }, "Vehicle registered", {
      label: "Registered vehicle",
      kind: "create",
      detail: `${registrationNumber} · ${make} ${model}`,
    });
  };

  const saveAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customerId = String(form.get("customer_id") || "");
    const scheduledAt = String(form.get("scheduled_at") || "");
    const reason = String(form.get("reason") || "").trim();
    const errors: Record<string, string> = {};
    const scheduledDate = new Date(scheduledAt);
    if (!customerId) errors.customer_id = "Select the customer for this visit.";
    if (!scheduledAt || Number.isNaN(scheduledDate.getTime())) {
      errors.scheduled_at = "Choose a valid date and time.";
    } else if (scheduledDate.getTime() < Date.now() - 60_000) {
      errors.scheduled_at = "Choose a date and time in the future.";
    }
    if (!reason) errors.reason = "Tell the team why the customer is visiting.";
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    await runAction(async () => {
      await garageApi("saveAppointment", {
        customerId,
        vehicleId: String(form.get("vehicle_id") || "") || null,
        scheduledAt: scheduledDate.toISOString(),
        reason,
      });
      await refresh();
      setModal(null);
    }, "Appointment booked", {
      label: "Booked appointment",
      kind: "create",
      detail: `${data.customers.find((customer) => customer.id === customerId)?.full_name || "Customer"} · ${shortDate(scheduledAt)} ${scheduledDate.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}`,
    });
  };

  const cancelAppointment = async (appointment: Appointment) => {
    if (!window.confirm("Cancel this appointment?")) return;
    await runAction(async () => {
      await garageApi("cancelAppointment", { appointmentId: appointment.id });
      await refresh();
    }, "Appointment cancelled", {
      label: "Cancelled appointment",
      kind: "delete",
      detail: `${appointment.customer?.full_name || "Customer"} · ${shortDate(appointment.scheduled_at)}`,
    });
  };

  const inviteStaff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("full_name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const role = String(form.get("role") || "");
    const errors: Record<string, string> = {};
    if (!fullName) errors.full_name = "Enter the staff member's name.";
    if (!emailPattern.test(email)) errors.email = "Enter a valid email address.";
    if (!role) errors.role = "Choose a workshop role.";
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    await runAction(async () => {
      const result = await garageApi<{ token: string }>("inviteStaff", {
        email,
        fullName,
        role,
      });
      setInviteUrl(
        `${window.location.origin}/?invite=${encodeURIComponent(result.token)}`,
      );
    }, "Invitation link created", {
      label: "Invited staff member",
      kind: "create",
      detail: `${fullName} · ${role}`,
    });
  };

  const saveJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customerId = String(form.get("customer_id") || "");
    const vehicleId = String(form.get("vehicle_id") || "");
    const reportedProblem = String(form.get("reported_problem") || "").trim();
    const errors: Record<string, string> = {};
    if (!customerId) errors.customer_id = "Select the customer.";
    if (!vehicleId) errors.vehicle_id = "Select the vehicle being repaired.";
    if (reportedProblem.length < 5) {
      errors.reported_problem = "Describe the reported issue (at least 5 characters).";
    }
    if (vehicleId && !data.vehicles.some((vehicle) => vehicle.id === vehicleId && vehicle.customer_id === customerId)) {
      errors.vehicle_id = "Choose a vehicle registered to this customer.";
    }
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    let notificationToast: Toast | null = null;
    await runAction(async () => {
      const created = await garageApi<{ id: string }>("saveJob", {
        customerId,
        vehicleId,
        reportedProblem,
        assignedMechanicId:
          String(form.get("assigned_mechanic_id") || "") || null,
        estimatedCompletionDate:
          String(form.get("estimated_completion_date") || "") || null,
      });
      await refresh();
      setModal(null);
      if (whatsappNotificationsEnabled) {
        try {
          const notification = await garageApi<{
            accepted_by_meta: boolean;
          }>("sendWhatsAppNotification", {
            jobId: created.id,
            status: "received",
          });
          if (!notification.accepted_by_meta) {
            throw new Error("Meta did not confirm message acceptance.");
          }
          notificationToast = {
            text: "Job saved; WhatsApp request accepted by Meta. Final delivery isn't yet confirmed.",
            kind: "info",
          };
        } catch (error) {
          notificationToast = {
            text: `Job saved; WhatsApp wasn't sent: ${messageOf(error)}`,
            kind: "error",
          };
        }
      }
    }, "Job card created", {
      label: "Created job card",
      kind: "create",
      detail: `${data.vehicles.find((vehicle) => vehicle.id === vehicleId)?.registration_number || "Vehicle"} · ${data.customers.find((customer) => customer.id === customerId)?.full_name || "Customer"}`,
    });
    if (notificationToast) setToast(notificationToast);
  };

  const updateJobStatus = async (job: JobCard, status: JobStatus) => {
    if (status === job.status) return;
    try {
      await garageApi("updateJobStatus", { jobId: job.id, status });
    } catch (error) {
      setToast({ text: messageOf(error), kind: "error" });
      return;
    }
    await refresh();
    logActivity(
      `Moved ${job.job_number} to ${statusNames[status]}`,
      "status",
      job.vehicle?.registration_number,
    );
    if (
      whatsappNotificationsEnabled &&
      ["owner", "manager", "receptionist"].includes(profile?.role || "") &&
      ["received", "awaiting_approval", "in_progress", "completed"].includes(status)
    ) {
      try {
        const notification = await garageApi<{
          accepted_by_meta: boolean;
        }>("sendWhatsAppNotification", { jobId: job.id, status });
        if (!notification.accepted_by_meta) {
          throw new Error("Meta did not confirm message acceptance.");
        }
      } catch (error) {
        setToast({
          text: `Job saved; WhatsApp wasn't sent: ${messageOf(error)}`,
          kind: "error",
        });
        return;
      }
      setToast({
        text: "Job updated; WhatsApp request accepted by Meta. Final delivery isn't yet confirmed.",
        kind: "info",
      });
      return;
    }
    setToast({ text: `Job moved to ${statusNames[status]}.`, kind: "success" });
  };

  const savePart = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const sku = String(form.get("sku") || "").trim();
    const quantity = Number(form.get("quantity_on_hand"));
    const minimum = Number(form.get("minimum_stock"));
    const purchase = Number(form.get("purchase_price"));
    const selling = Number(form.get("selling_price"));
    const errors: Record<string, string> = {};
    if (!name) errors.name = "Enter the part name.";
    if (!sku) errors.sku = "Enter the SKU or part number.";
    if (sku && data.parts.some((part) => part.sku.toLowerCase() === sku.toLowerCase())) {
      errors.sku = "This SKU is already in inventory.";
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      errors.quantity_on_hand = "Quantity must be a whole number of 0 or more.";
    }
    if (!Number.isInteger(minimum) || minimum < 0) {
      errors.minimum_stock = "Threshold must be a whole number of 0 or more.";
    }
    if (!Number.isFinite(purchase) || purchase < 0) {
      errors.purchase_price = "Purchase price cannot be negative.";
    }
    if (!Number.isFinite(selling) || selling < 0) {
      errors.selling_price = "Selling price cannot be negative.";
    }
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    await runAction(async () => {
      await garageApi("savePart", {
        name,
        sku,
        quantityOnHand: quantity,
        minimumStock: minimum,
        purchasePrice: purchase,
        sellingPrice: selling,
      });
      await refresh();
      setModal(null);
    }, "Part added to inventory", {
      label: "Added spare part",
      kind: "create",
      detail: `${name} · ${sku} · ${quantity} in stock`,
    });
  };

  const recordPartUsage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const jobId = String(form.get("job_id") || "");
    const partId = String(form.get("part_id") || "");
    const quantity = Number(form.get("quantity"));
    const part = data.parts.find((item) => item.id === partId);
    const errors: Record<string, string> = {};
    if (!jobId) errors.job_id = "Select the repair job.";
    if (!partId) errors.part_id = "Select the spare part.";
    if (!Number.isInteger(quantity) || quantity < 1) {
      errors.quantity = "Enter a whole number of at least 1.";
    } else if (part && quantity > Number(part.quantity_on_hand)) {
      errors.quantity = `Only ${part.quantity_on_hand} in stock.`;
    }
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    await runAction(async () => {
      await garageApi("recordPartUsage", {
        jobId,
        partId,
        quantity,
      });
      await refresh();
      setModal(null);
    }, "Part usage recorded and stock updated", {
      label: "Recorded parts usage",
      kind: "update",
      detail: `${quantity} × ${part?.name || "part"} → ${data.jobs.find((job) => job.id === jobId)?.job_number || "job"}`,
    });
  };

  const saveInvoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const jobId = String(form.get("job_id") || "");
    const job = data.jobs.find((item) => item.id === jobId);
    const amount = Number(form.get("amount_total"));
    const errors: Record<string, string> = {};
    if (!job) errors.job_id = "Select a valid repair job.";
    if (job && data.invoices.some((invoice) => invoice.job_card_id === job.id)) {
      errors.job_id = "This job already has an invoice.";
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.amount_total = "Enter an invoice total greater than zero.";
    }
    setFormErrors(errors);
    if (hasErrors(errors) || !job) return;
    await runAction(async () => {
      await garageApi("saveInvoice", {
        jobId: job.id,
        amountTotal: amount,
        dueDate: String(form.get("due_date") || "") || null,
      });
      await refresh();
      setModal(null);
    }, "Invoice created", {
      label: "Created invoice",
      kind: "create",
      detail: `${job.job_number} · ${money(amount)}`,
    });
  };

  const recordPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const invoiceId = String(form.get("invoice_id") || "");
    const amount = Number(form.get("amount"));
    const invoice = data.invoices.find((item) => item.id === invoiceId);
    const balance = invoice
      ? Math.max(0, Number(invoice.amount_total) - Number(invoice.amount_paid))
      : 0;
    const errors: Record<string, string> = {};
    if (!invoice) errors.invoice_id = "Select an outstanding invoice.";
    if (!Number.isFinite(amount) || amount <= 0) {
      errors.amount = "Enter an amount greater than zero.";
    } else if (invoice && amount > balance) {
      errors.amount = `Amount exceeds the ${money(balance)} balance.`;
    }
    setFormErrors(errors);
    if (hasErrors(errors) || !invoice) return;
    await runAction(async () => {
      await garageApi("recordPayment", {
        invoiceId: invoice.id,
        amount,
        method: String(form.get("method") || ""),
        reference: String(form.get("reference") || "").trim() || null,
      });
      await refresh();
      setModal(null);
    }, "Payment recorded", {
      label: "Recorded payment",
      kind: "payment",
      detail: `${money(amount)} · ${invoice.invoice_number} · ${String(form.get("method") || "").replace("_", " ")}`,
    });
  };

  const saveWorkshop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const errors: Record<string, string> = {};
    if (name.length < 2) errors.name = "Enter the workshop name.";
    setFormErrors(errors);
    if (hasErrors(errors)) return;
    await runAction(async () => {
      await garageApi("saveWorkshop", { name });
      setWorkshopName(name);
      setModal(null);
    }, "Workshop details updated", {
      label: "Updated workshop name",
      kind: "update",
      detail: name,
    });
  };

  if (!isNeonAuthConfigured) return <SetupScreen />;
  if (!authReady || (session && profileLoading)) return <LoadingScreen />;
  if (!session) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        values={authForm}
        setValues={setAuthForm}
        error={authError}
        busy={authBusy}
        submit={authenticate}
        verificationPending={authVerificationPending}
        verificationCode={authVerificationCode}
        setVerificationCode={setAuthVerificationCode}
        verify={verifyEmail}
        theme={theme}
        toggleTheme={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
      />
    );
  }
  if (profileError || !profile) {
    return (
      <ProfileError
        error={
          profileError ||
          "Your account has no workshop profile. Ask your workshop owner to provision your staff account."
        }
        onSignOut={signOut}
      />
    );
  }

  const activeJobs = data.jobs.filter(
    (job) => job.status !== "completed" && job.status !== "collected",
  );
  const pendingApprovals = data.jobs.filter((job) => job.status === "awaiting_approval");
  const outstanding = data.invoices.reduce(
    (total, invoice) => total + Math.max(0, Number(invoice.amount_total) - Number(invoice.amount_paid)),
    0,
  );
  const todayKey = localDateKey();
  const currentMonthKey = localMonthKey();
  const todayRevenue = data.payments
    .filter((payment) => localDateKey(payment.paid_at) === todayKey)
    .reduce((total, payment) => total + Number(payment.amount), 0);
  const monthRevenue = data.payments
    .filter((payment) => localMonthKey(payment.paid_at) === currentMonthKey)
    .reduce((total, payment) => total + Number(payment.amount), 0);
  const lowStock = data.parts.filter(
    (part) => Number(part.quantity_on_hand) <= Number(part.minimum_stock),
  );
  const upcomingAppointments = data.appointments.filter(
    (appointment) =>
      appointment.status === "scheduled" &&
      new Date(appointment.scheduled_at).getTime() >= Date.now(),
  );

  const pageTitles: Record<Page, string> = {
    Overview: "Good morning",
    Jobs: "Repair jobs",
    Customers: "Customers",
    Vehicles: "Vehicles",
    Appointments: "Appointments",
    Inventory: "Parts inventory",
    Invoices: "Invoices & payments",
    Reports: "Workshop reports",
    Team: "Workshop team",
  };
  const pageDescriptions: Record<Page, string> = {
    Overview: "Here’s what’s happening in your workshop today.",
    Jobs: "Track every repair from check-in through collection.",
    Customers: "Keep customer details, vehicles and service history together.",
    Vehicles: "Vehicles registered with your workshop.",
    Appointments: "Schedule and manage customer workshop bookings.",
    Inventory: "Monitor parts, stock levels and usage.",
    Invoices: "Create invoices and keep payment records up to date.",
    Reports: "See how your workshop is performing over time.",
    Team: "Manage workshop access and invite your staff.",
  };

  const openNew = () => {
    const modalForPage: Partial<Record<Page, Modal>> = {
      Jobs: "job",
      Customers: "customer",
      Vehicles: "vehicle",
      Appointments: "appointment",
      Inventory: "part",
      Invoices: "invoice",
      Team: "invite",
    };
    const next = modalForPage[page];
    if (!next) return;
    setFormErrors({});
    if (next === "job") setJobCustomerId("");
    if (next === "appointment") setAppointmentCustomerId("");
    setModal(next);
  };

  const filteredCustomers = data.customers.filter((customer) =>
    `${customer.full_name} ${customer.phone} ${customer.email || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredVehicles = data.vehicles.filter((vehicle) =>
    `${vehicle.registration_number} ${vehicle.make} ${vehicle.model} ${vehicle.customer?.full_name || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const filteredJobs = activeJobs
    .concat(data.jobs.filter((job) => job.status === "completed" || job.status === "collected"))
    .filter((job) =>
      `${job.job_number} ${job.customer?.full_name || ""} ${job.vehicle?.registration_number || ""} ${job.status}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const filteredParts = data.parts.filter((part) =>
    `${part.name} ${part.sku}`.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredInvoices = data.invoices.filter((invoice) =>
    `${invoice.invoice_number} ${invoice.customer?.full_name || ""} ${invoice.status}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const jobVehicles = data.vehicles.filter(
    (vehicle) => vehicle.customer_id === jobCustomerId,
  );
  const appointmentVehicles = data.vehicles.filter(
    (vehicle) => vehicle.customer_id === appointmentCustomerId,
  );

  const reportPayments = data.payments.filter((payment) => {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - reportDays);
    return new Date(payment.paid_at) >= threshold;
  });
  const reportRevenue = reportPayments.reduce(
    (total, payment) => total + Number(payment.amount),
    0,
  );
  const reportChart = buildRevenueChart(reportPayments, reportDays);

  return (
    <div className="min-h-screen bg-canvas">
      {mobileNavOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-[linear-gradient(180deg,#161f27_0%,#10171d_100%)] text-white transition-transform duration-200 lg:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lime text-ink shadow-[0_8px_20px_-8px_rgba(197,244,103,0.7)]">
            <Wrench size={20} strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-display text-[17px] font-extrabold tracking-tight">Garage<span className="text-lime">OS</span></div>
            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">Workshop suite</div>
          </div>
        </div>
        <div className="px-4 pt-6">
          <div className="px-3 pb-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Workspace
          </div>
          <nav className="space-y-1">
            {visibleNavItems.map(({ name, icon: Icon }) => {
              const active = page === name;
              return (
                <button
                  key={name}
                  onClick={() => {
                    setPage(name);
                    setSearch("");
                    setMobileNavOpen(false);
                  }}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition ${
                    active
                      ? "bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                  }`}
                >
                  <Icon size={17} strokeWidth={1.8} className={active ? "text-lime" : "text-slate-500 group-hover:text-slate-300"} />
                  <span className="flex-1">{name}</span>
                  {name === "Jobs" && activeJobs.length > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-lime text-ink" : "bg-lime/15 text-lime"}`}>
                      {activeJobs.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="mt-auto border-t border-white/10 p-4">
          <button
            onClick={() => setModal("workshop")}
            disabled={profile.role !== "owner"}
            title={
              profile.role === "owner"
                ? "Workshop settings"
                : "Only workshop owners can edit workshop settings"
            }
            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-white/5 disabled:cursor-default disabled:hover:bg-transparent"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-xs font-semibold text-lime ring-1 ring-inset ring-white/10">
              {initials(workshopName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold">{workshopName}</div>
              <div className="mt-0.5 capitalize text-[10px] text-slate-400">{profile.role}</div>
            </div>
            <Settings2 size={15} className="text-slate-500" />
          </button>
          <button
            onClick={() => void signOut()}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-line-soft bg-[var(--color-header)] px-5 backdrop-blur-xl md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            >
              <Menu size={20} />
            </button>
            <div className="hidden items-center gap-2 text-xs text-muted md:flex">
              <span className="font-medium">Workspace</span>
              <span className="text-slate-300">/</span>
              <span className="font-semibold text-ink">{page}</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              aria-label="Open command palette"
              title={`Search anything (${shortcutLabel})`}
              onClick={() => setCommandOpen(true)}
              className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-50 hover:text-ink sm:hidden"
            >
              <Search size={18} />
            </button>
            <label className="relative hidden w-[260px] sm:block">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${page.toLowerCase()}...`}
                title={`Filter this page · ${shortcutLabel} for global search`}
                className="h-9 w-full rounded-xl border-line bg-slate-50 pl-10 pr-16 text-xs focus:border-lime focus:bg-surface"
              />
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 lg:block">
                {shortcutLabel}
              </kbd>
            </label>
            <span className="hidden h-6 w-px bg-line sm:block" />
            <button
              aria-label="Open workshop assistant"
              title={`Workshop assistant (Ctrl J)`}
              onClick={() => {
                setAssistantTab("chat");
                setAssistantOpen(true);
              }}
              className={`relative rounded-xl p-2 transition hover:bg-slate-50 ${assistantOpen ? "text-accent" : "text-slate-500 hover:text-ink"}`}
            >
              <Sparkles size={18} />
            </button>
            <button
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
              className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-50 hover:text-ink"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              title={reminders.length ? `${reminders.length} assistant reminder${reminders.length === 1 ? "" : "s"}` : "Assistant reminders"}
              aria-label="Open assistant reminders"
              onClick={() => {
                setAssistantTab("reminders");
                setAssistantOpen(true);
              }}
              className="relative rounded-xl p-2 text-slate-500 hover:bg-slate-50"
            >
              <Bell size={18} />
              {reminders.length > 0 && (
                <span className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ring-2 ring-surface ${reminders.some((reminder) => reminder.severity === "urgent") ? "bg-rose-500" : "bg-amber-500"}`}>
                  {reminders.length}
                </span>
              )}
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent ring-1 ring-inset ring-accent-line">
              {initials(profile.full_name || session.user.email)}
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 py-7 md:px-8 md:py-9">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="font-display text-[27px] font-extrabold tracking-[-0.025em] text-ink md:text-[30px]">
                  {page === "Overview" ? `Welcome back, ${profile.full_name.split(" ")[0] || "there"}` : pageTitles[page]}
                </h1>
                {page === "Overview" && <span className="text-2xl">👋</span>}
                {page === "Overview" && (
                  <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium text-muted shadow-sm sm:inline-flex">
                    <CalendarDays size={12} />
                    {new Date().toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" })}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[13px] text-muted">{pageDescriptions[page]}</p>
            </div>
            {page === "Overview" ? (
              canManageJobs && (
                <button
                  onClick={() => {
                    setFormErrors({});
                    setJobCustomerId("");
                    setModal("job");
                  }}
                  className="button-primary"
                >
                  <Plus size={16} />
                  New job card
                </button>
              )
            ) : page !== "Reports" && (
              <button
                onClick={openNew}
                disabled={
                  (page === "Jobs" && !canManageJobs) ||
                  (["Customers", "Vehicles"].includes(page) && !canManageCustomers) ||
                  (page === "Inventory" && !canManageInventory) ||
                  (page === "Invoices" && !canManageInvoices) ||
                  (page === "Appointments" && !canManageCustomers) ||
                  (page === "Team" && !canManageTeam)
                }
                className="button-primary"
              >
                <Plus size={16} />
                {page === "Jobs"
                  ? "New job card"
                  : page === "Customers"
                    ? "Add customer"
                    : page === "Vehicles"
                      ? "Register vehicle"
                      : page === "Appointments"
                        ? "Book appointment"
                      : page === "Inventory"
                        ? "Add part"
                        : page === "Invoices"
                          ? "Create invoice"
                          : "Invite staff"}
              </button>
            )}
          </div>

          {dataError && (
            <div role="alert" className="mb-5 flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <span>Couldn’t load workshop data: {dataError}</span>
              <button onClick={() => void refresh()} className="shrink-0 font-semibold underline">Retry</button>
            </div>
          )}

          {page === "Overview" && (
            <OverviewPage
              data={data}
              loading={dataLoading}
              showFinance={canManageInvoices}
              showAppointments={canManageCustomers}
              showInventory={canManageInventory}
              vehiclesInWorkshop={
                new Set(activeJobs.map((job) => job.vehicle_id)).size
              }
              activeJobs={activeJobs}
              pendingApprovals={pendingApprovals}
              outstanding={outstanding}
              todayRevenue={todayRevenue}
              monthRevenue={monthRevenue}
              lowStock={lowStock}
              appointments={upcomingAppointments}
              onNavigate={setPage}
            />
          )}
          {page === "Jobs" && (
            <JobsPage
              jobs={filteredJobs}
              loading={dataLoading}
              canUpdate={canUpdateJobs}
              canRecordParts={canRecordParts}
              role={profile.role}
              onStatus={updateJobStatus}
              onAddUsage={() => setModal("usage")}
            />
          )}
          {page === "Customers" && (
            <CustomersPage
              customers={filteredCustomers}
              vehicles={data.vehicles}
              jobs={data.jobs}
              invoices={data.invoices}
              showBalances={canManageInvoices}
              loading={dataLoading}
              canManage={canManageCustomers}
              onArchive={archiveCustomer}
              onEdit={(customer) => {
                setFormErrors({});
                setCustomerToEdit(customer);
                setModal("customer");
              }}
            />
          )}
          {page === "Vehicles" && (
            <VehiclesPage vehicles={filteredVehicles} loading={dataLoading} />
          )}
          {page === "Appointments" && (
            <AppointmentsPage
              appointments={data.appointments}
              loading={dataLoading}
              canManage={canManageCustomers}
              onCancel={cancelAppointment}
            />
          )}
          {page === "Inventory" && (
            <InventoryPage
              parts={filteredParts}
              loading={dataLoading}
              canManage={canManageInventory}
              onUsage={() => setModal("usage")}
            />
          )}
          {page === "Invoices" && (
            <InvoicesPage
              invoices={filteredInvoices}
              loading={dataLoading}
              canManage={canManageInvoices}
              onPayment={() => setModal("payment")}
              onPreview={setSelectedInvoice}
            />
          )}
          {page === "Reports" && (
            <ReportsPage
              reportDays={reportDays}
              setReportDays={setReportDays}
              reportPayments={reportPayments}
              revenue={reportRevenue}
              chart={reportChart}
              invoices={data.invoices}
              jobs={data.jobs}
              parts={data.parts}
            />
          )}
          {page === "Team" && (
            <TeamPage staff={data.staff} loading={dataLoading} canManage={canManageTeam} />
          )}
        </div>
      </main>

      {modal && (
        <Modal
          title={modal === "customer" && customerToEdit ? "Edit customer" : modalTitle(modal)}
          onClose={() => {
            setModal(null);
            setFormErrors({});
            setCustomerToEdit(null);
            setInviteUrl("");
            setJobCustomerId("");
            setAppointmentCustomerId("");
          }}
        >
          {modal === "customer" && (
            <form onSubmit={saveCustomer} noValidate onInput={() => setFormErrors({})} className="space-y-4">
              <Field label="Full name" name="full_name" defaultValue={customerToEdit?.full_name} required autoFocus error={formErrors.full_name} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone number" name="phone" type="tel" defaultValue={customerToEdit?.phone} required placeholder="+254 7..." error={formErrors.phone} />
                <Field label="Email address" name="email" type="email" defaultValue={customerToEdit?.email || ""} error={formErrors.email} />
              </div>
              <Field label="Customer notes" name="notes" as="textarea" defaultValue={customerToEdit?.notes || ""} placeholder="Anything your team should know..." />
              <ModalActions onCancel={() => { setModal(null); setCustomerToEdit(null); }} submitLabel={customerToEdit ? "Save changes" : "Save customer"} />
            </form>
          )}
          {modal === "vehicle" && (
            <form onSubmit={saveVehicle} noValidate onInput={() => setFormErrors({})} className="space-y-4">
              <Field label="Customer" name="customer_id" as="select" required error={formErrors.customer_id}>
                <option value="">Select a customer</option>
                {data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Registration number" name="registration_number" required placeholder="KDA 123A" error={formErrors.registration_number} />
                <Field label="Make" name="make" required placeholder="Toyota" error={formErrors.make} />
                <Field label="Model" name="model" required placeholder="Corolla" error={formErrors.model} />
                <Field label="Manufacturing year" name="manufacturing_year" type="number" min="1900" max={new Date().getFullYear() + 1} error={formErrors.manufacturing_year} />
                <Field label="Current mileage (km)" name="mileage" type="number" min="0" error={formErrors.mileage} />
                <Field label="Engine type" name="engine_type" placeholder="Petrol, diesel, hybrid..." />
              </div>
              {data.customers.length === 0 && <InlineNotice>Create a customer before registering a vehicle.</InlineNotice>}
              <ModalActions onCancel={() => setModal(null)} submitLabel="Register vehicle" disabled={!data.customers.length} />
            </form>
          )}
          {modal === "appointment" && (
            <form onSubmit={saveAppointment} noValidate onInput={() => setFormErrors({})} className="space-y-4">
              <Field
                label="Customer"
                name="customer_id"
                as="select"
                required
                value={appointmentCustomerId}
                onChange={(event) => setAppointmentCustomerId(event.target.value)}
                error={formErrors.customer_id}
              >
                <option value="">Select a customer</option>
                {data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
              </Field>
              <Field
                key={`appointment-vehicle-${appointmentCustomerId}`}
                label="Vehicle (optional)"
                name="vehicle_id"
                as="select"
                disabled={!appointmentCustomerId}
              >
                <option value="">{appointmentCustomerId ? "No vehicle selected" : "Select a customer first"}</option>
                {appointmentVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration_number} · {vehicle.make} {vehicle.model}</option>)}
              </Field>
              <Field label="Date and time" name="scheduled_at" type="datetime-local" required error={formErrors.scheduled_at} />
              <Field label="Reason for visit" name="reason" required placeholder="Routine service, inspection..." error={formErrors.reason} />
              {appointmentCustomerId && !appointmentVehicles.length && <InlineNotice>This customer has no registered vehicle. You can still book the appointment and add a vehicle later.</InlineNotice>}
              {!data.customers.length && <InlineNotice>Add a customer before booking an appointment.</InlineNotice>}
              <ModalActions onCancel={() => setModal(null)} submitLabel="Book appointment" disabled={!data.customers.length} />
            </form>
          )}
          {modal === "invite" && (
            inviteUrl ? (
              <div className="space-y-4">
                <InlineNotice>
                  Share this one-time link with the invited staff member. They must
                  sign up with the invited email and verify it in Neon Auth. The
                  link expires after seven days; GarageOS does not send it by email.
                </InlineNotice>
                <label className="block text-xs font-medium text-slate-700">
                  Invitation link
                  <input className="field" value={inviteUrl} readOnly />
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(inviteUrl)
                        .then(() =>
                          setToast({ text: "Invitation link copied.", kind: "success" }),
                        )
                        .catch((error: unknown) =>
                          setToast({ text: messageOf(error), kind: "error" }),
                        );
                    }}
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    className="button-primary"
                    onClick={() => {
                      setInviteUrl("");
                      setModal(null);
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={inviteStaff} noValidate onInput={() => setFormErrors({})} className="space-y-4">
                <Field label="Staff member name" name="full_name" required autoFocus error={formErrors.full_name} />
                <Field label="Email address" name="email" type="email" required error={formErrors.email} />
                <Field label="Workshop role" name="role" as="select" required error={formErrors.role}>
                  <option value="manager">Workshop Manager</option>
                  <option value="mechanic">Mechanic</option>
                  <option value="receptionist">Receptionist</option>
                  <option value="accountant">Accountant</option>
                </Field>
                <InlineNotice>
                  GarageOS creates a time-limited invitation link. The invited
                  person must verify the matching email address in Neon Auth.
                </InlineNotice>
                <ModalActions onCancel={() => setModal(null)} submitLabel="Create invitation link" />
              </form>
            )
          )}
          {modal === "job" && (
            <form onSubmit={saveJob} noValidate onInput={() => setFormErrors({})} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Customer"
                  name="customer_id"
                  as="select"
                  required
                  value={jobCustomerId}
                  onChange={(event) => setJobCustomerId(event.target.value)}
                  error={formErrors.customer_id}
                >
                  <option value="">Select a customer</option>
                  {data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
                </Field>
                <Field
                  key={`job-vehicle-${jobCustomerId}`}
                  label="Vehicle"
                  name="vehicle_id"
                  as="select"
                  required
                  disabled={!jobCustomerId}
                  error={formErrors.vehicle_id}
                >
                  <option value="">{jobCustomerId ? "Select a vehicle" : "Select a customer first"}</option>
                  {jobVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.registration_number} · {vehicle.make} {vehicle.model}
                    </option>
                  ))}
                </Field>
              </div>
              <Field label="Reported problem" name="reported_problem" as="textarea" required placeholder="Describe the issue reported by the customer..." error={formErrors.reported_problem} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Estimated completion" name="estimated_completion_date" type="date" />
                <Field label="Assign mechanic" name="assigned_mechanic_id" as="select">
                  <option value="">Unassigned</option>
                  {data.staff.filter((member) => member.role === "mechanic").map((member) => (
                    <option key={member.id} value={member.id}>{member.full_name}</option>
                  ))}
                </Field>
              </div>
              {jobCustomerId && !jobVehicles.length && (
                <InlineNotice>This customer has no registered vehicles. Register one before opening a job card.</InlineNotice>
              )}
              {(data.customers.length === 0 || data.vehicles.length === 0) && (
                <InlineNotice>Add a customer and register their vehicle before opening a job card.</InlineNotice>
              )}
              <ModalActions onCancel={() => setModal(null)} submitLabel="Create job card" disabled={!jobCustomerId || !jobVehicles.length} />
            </form>
          )}
          {modal === "part" && (
            <form onSubmit={savePart} noValidate onInput={() => setFormErrors({})} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Part name" name="name" required error={formErrors.name} />
                <Field label="SKU / part number" name="sku" required error={formErrors.sku} />
                <Field label="Opening quantity" name="quantity_on_hand" type="number" min="0" step="1" required error={formErrors.quantity_on_hand} />
                <Field label="Low-stock threshold" name="minimum_stock" type="number" min="0" step="1" required error={formErrors.minimum_stock} />
                <Field label="Purchase price (KES)" name="purchase_price" type="number" min="0" step="0.01" required error={formErrors.purchase_price} />
                <Field label="Selling price (KES)" name="selling_price" type="number" min="0" step="0.01" required error={formErrors.selling_price} />
              </div>
              <ModalActions onCancel={() => setModal(null)} submitLabel="Add part" />
            </form>
          )}
          {modal === "usage" && (
            <form onSubmit={recordPartUsage} noValidate onInput={() => setFormErrors({})} className="space-y-4">
              <Field label="Repair job" name="job_id" as="select" required error={formErrors.job_id}>
                <option value="">Select an active job</option>
                {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.job_number} · {job.vehicle?.registration_number || "Vehicle"}</option>)}
              </Field>
              <Field label="Spare part" name="part_id" as="select" required error={formErrors.part_id}>
                <option value="">Select a part</option>
                {data.parts.map((part) => <option key={part.id} value={part.id}>{part.name} · {part.quantity_on_hand} in stock</option>)}
              </Field>
              <Field label="Quantity used" name="quantity" type="number" min="1" step="1" required error={formErrors.quantity} />
              <InlineNotice>Stock is deducted atomically. Quantities that exceed available stock are rejected.</InlineNotice>
              <ModalActions onCancel={() => setModal(null)} submitLabel="Record part usage" disabled={!activeJobs.length || !data.parts.length} />
            </form>
          )}
          {modal === "invoice" && (
            <form onSubmit={saveInvoice} noValidate onInput={() => setFormErrors({})} className="space-y-4">
              <Field label="Repair job" name="job_id" as="select" required error={formErrors.job_id}>
                <option value="">Select a job</option>
                {data.jobs.map((job) => <option key={job.id} value={job.id}>{job.job_number} · {job.customer?.full_name || "Customer"}</option>)}
              </Field>
              <Field label="Invoice total (KES)" name="amount_total" type="number" min="0.01" step="0.01" required error={formErrors.amount_total} />
              <Field label="Due date" name="due_date" type="date" />
              <InlineNotice>Invoice totals are recorded in KES. Itemized quotations and tax configuration are not part of this MVP.</InlineNotice>
              <ModalActions onCancel={() => setModal(null)} submitLabel="Create invoice" disabled={!data.jobs.length} />
            </form>
          )}
          {modal === "payment" && (
            <form onSubmit={recordPayment} noValidate onInput={() => setFormErrors({})} className="space-y-4">
              <Field label="Invoice" name="invoice_id" as="select" required error={formErrors.invoice_id}>
                <option value="">Select an outstanding invoice</option>
                {data.invoices.filter((invoice) => invoice.status !== "paid").map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoice_number} · {invoice.customer?.full_name || "Customer"} · due {money(Number(invoice.amount_total) - Number(invoice.amount_paid))}
                  </option>
                ))}
              </Field>
              <Field label="Amount received (KES)" name="amount" type="number" min="0.01" step="0.01" required error={formErrors.amount} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Payment method" name="method" as="select" required>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="mpesa">M-Pesa</option>
                </Field>
                <Field label="Reference (optional)" name="reference" placeholder="Receipt or transaction ID" />
              </div>
              <InlineNotice>Payments are recorded transactionally and cannot exceed the invoice balance.</InlineNotice>
              <ModalActions onCancel={() => setModal(null)} submitLabel="Record payment" disabled={!data.invoices.some((invoice) => invoice.status !== "paid")} />
            </form>
          )}
          {modal === "workshop" && (
            <form onSubmit={saveWorkshop} noValidate onInput={() => setFormErrors({})} className="space-y-4">
              <Field label="Workshop name" name="name" defaultValue={workshopName} required autoFocus error={formErrors.name} />
              <InlineNotice>Your workshop data is isolated from other GarageOS workspaces.</InlineNotice>
              <ModalActions onCancel={() => setModal(null)} submitLabel="Save workshop" />
            </form>
          )}
        </Modal>
      )}

      {commandOpen && (
        <CommandPalette
          data={data}
          theme={theme}
          shortcutLabel={shortcutLabel}
          pages={visibleNavItems.map(({ name }) => name)}
          permissions={{
            job: canManageJobs,
            customer: canManageCustomers,
            inventory: canManageInventory,
            invoices: canManageInvoices,
            team: canManageTeam,
            usage: canRecordParts,
          }}
          onClose={() => setCommandOpen(false)}
          onNavigate={(next, term) => {
            setPage(next);
            setSearch(term || "");
            setMobileNavOpen(false);
          }}
          onCreate={(next) => {
            setFormErrors({});
            setJobCustomerId("");
            setAppointmentCustomerId("");
            setModal(next);
          }}
          onOpenInvoice={setSelectedInvoice}
          onAssistant={() => {
            setAssistantTab("chat");
            setAssistantOpen(true);
          }}
          onToggleTheme={() =>
            setTheme((current) => (current === "dark" ? "light" : "dark"))
          }
        />
      )}

      {selectedInvoice && (
        <Modal title="Invoice preview" onClose={() => setSelectedInvoice(null)} print>
          <InvoiceDocument
            workshopName={workshopName}
            invoice={selectedInvoice}
            payments={data.payments.filter(
              (payment) => payment.invoice?.invoice_number === selectedInvoice.invoice_number,
            )}
          />
          <div className="mt-6 flex justify-end gap-2 print:hidden">
            <button className="button-secondary" onClick={() => setSelectedInvoice(null)}>Close</button>
            <button className="button-primary" onClick={() => window.print()}>Print / save PDF</button>
          </div>
        </Modal>
      )}

      <AssistantPanel
        open={assistantOpen}
        tab={assistantTab}
        setTab={setAssistantTab}
        onClose={() => setAssistantOpen(false)}
        data={data}
        activity={activity}
        reminders={reminders}
        workshopName={workshopName}
        userName={profile.full_name || session.user.email || "there"}
        permissions={assistantPermissions}
        onNavigate={(next, term) => {
          setPage(next);
          setSearch(term || "");
          setMobileNavOpen(false);
        }}
        onOpenInvoice={setSelectedInvoice}
        onSnooze={(reminderId) => {
          if (!profile?.workshop_id) return;
          setSnoozes((current) => {
            const next = { ...current, [reminderId]: snoozeUntil() };
            saveSnoozes(profile.workshop_id, next);
            return next;
          });
          setToast({ text: "Reminder snoozed for 12 hours.", kind: "info" });
        }}
        onClearActivity={() => {
          if (!profile?.workshop_id) return;
          if (!window.confirm("Clear the monitored activity log?")) return;
          setActivity([]);
          saveActivity(profile.workshop_id, []);
        }}
      />

      {toast && (
        <div
          role={toast.kind === "error" ? "alert" : "status"}
          className={`fixed bottom-5 right-5 z-[60] flex max-w-[calc(100vw-40px)] items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm shadow-float backdrop-blur ${
            toast.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-line bg-surface text-ink"
          }`}
        >
          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${toast.kind === "error" ? "bg-rose-100 text-rose-700" : toast.kind === "info" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
            {toast.kind === "success" ? <Check size={14} /> : <Activity size={14} />}
          </span>
          <span className="pt-0.5 leading-relaxed">{toast.text}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="ml-1 shrink-0 self-start rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-ink"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}

function buildRevenueChart(payments: Payment[], days: number) {
  const entries = new Map<string, number>();
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days + 1);
  for (let index = 0; index < days; index += 1) {
    entries.set(localDateKey(date), 0);
    date.setDate(date.getDate() + 1);
  }
  payments.forEach((payment) => {
    const key = localDateKey(payment.paid_at);
    if (entries.has(key)) entries.set(key, (entries.get(key) || 0) + Number(payment.amount));
  });
  return Array.from(entries, ([key, amount]) => ({
    date: key,
    label: new Date(`${key}T00:00:00`).toLocaleDateString("en-KE", {
      day: "numeric",
      month: days > 7 ? "short" : undefined,
      weekday: days <= 7 ? "short" : undefined,
    }),
    amount,
  }));
}

function OverviewPage({
  data,
  loading,
  showFinance,
  showAppointments,
  showInventory,
  vehiclesInWorkshop,
  activeJobs,
  pendingApprovals,
  outstanding,
  todayRevenue,
  monthRevenue,
  lowStock,
  appointments,
  onNavigate,
}: {
  data: GarageData;
  loading: boolean;
  showFinance: boolean;
  showAppointments: boolean;
  showInventory: boolean;
  vehiclesInWorkshop: number;
  activeJobs: JobCard[];
  pendingApprovals: JobCard[];
  outstanding: number;
  todayRevenue: number;
  monthRevenue: number;
  lowStock: SparePart[];
  appointments: Appointment[];
  onNavigate: (page: Page) => void;
}) {
  const completedThisMonth = data.jobs.filter(
    (job) =>
      (job.status === "completed" || job.status === "collected") &&
      localMonthKey(job.actual_completion_date || job.date_received) ===
        localMonthKey(),
  ).length;
  const previousMonth = new Date();
  previousMonth.setDate(1);
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  const previousMonthRevenue = data.payments
    .filter((payment) => localMonthKey(payment.paid_at) === localMonthKey(previousMonth))
    .reduce((total, payment) => total + Number(payment.amount), 0);
  const revenueDelta = previousMonthRevenue > 0
    ? Math.round(((monthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100)
    : null;
  const openInvoices = data.invoices.filter((invoice) => invoice.status !== "paid").length;
  const paymentsToday = data.payments.filter(
    (payment) => localDateKey(payment.paid_at) === localDateKey(),
  ).length;
  const chartData = buildRevenueChart(data.payments, 7);
  const pulseMetrics = [
    { label: "Vehicles in workshop", value: vehiclesInWorkshop, icon: CarFront },
    { label: "Active jobs", value: activeJobs.length, icon: Wrench },
    { label: "Awaiting approval", value: pendingApprovals.length, icon: Clock3 },
    { label: "Completed this month", value: completedThisMonth, icon: Check },
  ];
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        {showFinance ? (
          <div className="hero-panel flex flex-col rounded-2xl p-5 md:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Revenue this month</div>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <span className="font-display text-[34px] font-extrabold leading-none tracking-[-0.03em] text-white md:text-[42px]">
                    {loading ? "—" : money(monthRevenue)}
                  </span>
                  {!loading && revenueDelta !== null ? (
                    <span className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${revenueDelta >= 0 ? "bg-lime/15 text-lime" : "bg-rose-500/15 text-rose-200"}`}>
                      {revenueDelta >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                      {Math.abs(revenueDelta)}% vs last month
                    </span>
                  ) : (
                    !loading && <span className="mb-1 text-[11px] text-white/45">First month of data</span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-white/55">
                  <span>Today <span className="font-semibold text-white/85">{loading ? "—" : money(todayRevenue)}</span></span>
                  <span className="h-3 w-px bg-white/15" />
                  <span>{loading ? "—" : paymentsToday} payment{!loading && paymentsToday === 1 ? "" : "s"} today</span>
                </div>
              </div>
              <button onClick={() => onNavigate("Reports")} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-semibold text-white/80 transition hover:border-lime/40 hover:text-lime">
                View reports →
              </button>
            </div>
            <div className="mt-5 h-[150px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
                  <defs><linearGradient id="heroRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c5f467" stopOpacity={0.3} /><stop offset="95%" stopColor="#c5f467" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "rgba(238,243,246,0.45)" }} dy={6} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(value) => money(Number(value))}
                    cursor={{ stroke: "rgba(197,244,103,0.25)" }}
                    contentStyle={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "#111a22", color: "#eef3f6", fontSize: 12 }}
                    itemStyle={{ color: "#c5f467" }}
                    labelStyle={{ color: "#9aa8b5" }}
                  />
                  <Area type="monotone" dataKey="amount" stroke="#c5f467" strokeWidth={2.5} fill="url(#heroRevenueFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
              <span>Payments · last 7 days</span>
              <span>{openInvoices} open invoices</span>
            </div>
          </div>
        ) : (
          <div className="hero-panel flex flex-col justify-between rounded-2xl p-5 md:p-7">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Operations focus</div>
              <div className="mt-3 font-display text-[42px] font-extrabold leading-none tracking-[-0.03em] text-white">{loading ? "—" : activeJobs.length}</div>
              <div className="mt-2 text-[11px] text-white/55">active repair jobs across {vehiclesInWorkshop} vehicles</div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5"><div className="font-display text-xl font-bold text-white">{loading ? "—" : pendingApprovals.length}</div><div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-white/45">Awaiting approval</div></div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5"><div className="font-display text-xl font-bold text-white">{loading ? "—" : completedThisMonth}</div><div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-white/45">Completed this month</div></div>
            </div>
            <p className="mt-5 text-[10px] leading-relaxed text-white/40">Revenue and payment figures are restricted to owners, managers and accountants.</p>
          </div>
        )}

        <div className="card flex flex-col p-5 md:p-6">
          <div className="flex items-start justify-between">
            <div><h2 className="text-sm font-semibold">Workshop pulse</h2><p className="mt-1 text-xs text-muted">Live snapshot of the floor</p></div>
            <div className="rounded-xl bg-accent-soft p-2 text-accent"><Activity size={17} /></div>
          </div>
          <div className="mt-5 grid flex-1 grid-cols-2 gap-3">
            {pulseMetrics.map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-line-soft bg-surface-muted p-3.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-accent shadow-sm ring-1 ring-inset ring-line-soft"><Icon size={15} /></span>
                <div className="mt-3 font-display text-2xl font-extrabold tracking-tight">{loading ? "—" : value}</div>
                <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">{label}</div>
              </div>
            ))}
          </div>
          {showFinance && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-line-soft bg-surface-muted px-4 py-3">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted">Outstanding</div>
                <div className="mt-0.5 font-display text-sm font-bold">{loading ? "—" : money(outstanding)}</div>
              </div>
              <button onClick={() => onNavigate("Invoices")} className="text-[11px] font-semibold text-accent hover:underline">{openInvoices} invoices →</button>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 text-muted"><Package size={13} /> Low stock</span>
            {showInventory
              ? <button onClick={() => onNavigate("Inventory")} className={`font-semibold ${lowStock.length ? "text-amber-700" : "text-accent"} hover:underline`}>{lowStock.length} items →</button>
              : <span className="font-semibold">{lowStock.length} items</span>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="card p-5 md:p-6">
          <div className="flex items-center justify-between">
            <div><h2 className="text-sm font-semibold">Upcoming appointments</h2><p className="mt-1 text-xs text-muted">Next visits on the calendar</p></div>
            <button onClick={() => onNavigate("Appointments")} className="rounded-xl border border-line p-2 text-muted transition hover:bg-slate-50 hover:text-ink"><CalendarDays size={16} /></button>
          </div>
          <div className="mt-4 divide-y divide-line-soft">
            {appointments.slice(0, 5).map((appointment) => (
              <div key={appointment.id} className="flex items-center gap-3 py-3">
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft text-[10px] font-semibold leading-tight text-accent">
                  <span>{new Date(appointment.scheduled_at).toLocaleDateString("en-KE", { day: "2-digit" })}</span>
                  <span className="uppercase tracking-wide">{new Date(appointment.scheduled_at).toLocaleDateString("en-KE", { month: "short" })}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{appointment.customer?.full_name || "Customer"}</div>
                  <div className="mt-1 truncate text-[11px] text-muted">{appointment.vehicle?.registration_number || "Vehicle"} · {appointment.reason}</div>
                </div>
                <div className="whitespace-nowrap rounded-full border border-line px-2.5 py-1 text-[10px] font-medium text-muted">{new Date(appointment.scheduled_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            ))}
            {!showAppointments && <InlineNotice>Appointment details are restricted to the front desk and workshop managers.</InlineNotice>}
            {showAppointments && !appointments.length && !loading && <EmptyInline text="No upcoming appointments." />}
            {loading && !appointments.length && <div className="py-1"><ListSkeleton rows={3} /></div>}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div><h2 className="text-sm font-semibold">Recent payments</h2><p className="mt-1 text-xs text-muted">Latest received transactions</p></div>
            {showFinance && <button onClick={() => onNavigate("Invoices")} className="text-[11px] font-semibold text-accent hover:underline">View all →</button>}
          </div>
          {showFinance ? (
          <>
          <div className="divide-y divide-line-soft px-5">
            {data.payments.slice(0, 5).map((payment) => (
              <div key={payment.id} className="flex items-center gap-3 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ArrowDownRight size={17} /></div>
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{payment.invoice?.customer?.full_name || "Customer"}</div><div className="mt-1 text-[10px] capitalize text-muted">{payment.method.replace("_", " ")} · {shortDate(payment.paid_at)}</div></div>
                <div className="whitespace-nowrap text-xs font-semibold text-emerald-700">+{money(payment.amount)}</div>
              </div>
            ))}
            {!data.payments.length && !loading && <EmptyInline text="No payments recorded yet." />}
            {loading && !data.payments.length && <ListSkeleton rows={4} />}
          </div>
          <div className="border-t border-line-soft px-5 py-3 text-[11px]">
            <div className="flex justify-between"><span className="text-muted">Payments this month</span><span className="font-display font-bold">{loading ? "—" : money(monthRevenue)}</span></div>
          </div>
          </>
          ) : (
            <div className="p-5"><InlineNotice>Payment and balance information is restricted to workshop owners, managers and accountants.</InlineNotice></div>
          )}
        </div>
      </div>

      <div className="card mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4 md:px-6">
          <div><h2 className="text-sm font-semibold">Recent repair jobs</h2><p className="mt-1 text-xs text-muted">Latest activity from the workshop floor</p></div>
          <button onClick={() => onNavigate("Jobs")} className="text-[11px] font-semibold text-accent hover:underline">All jobs →</button>
        </div>
        <div className="max-h-[72vh] overflow-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="table-head"><tr><th className="px-5 py-3.5">Job / vehicle</th><th className="px-4 py-3.5">Customer</th><th className="px-4 py-3.5">Received</th><th className="px-4 py-3.5">Status</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.jobs.slice(0, 5).map((job) => (
                <tr key={job.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-5 py-3.5"><div className="font-semibold">{job.job_number}</div><div className="mt-1 text-[10px] text-muted">{job.vehicle?.registration_number} · {job.vehicle?.make} {job.vehicle?.model}</div></td>
                  <td className="px-4 py-3.5 text-slate-600">{job.customer?.full_name || "—"}</td>
                  <td className="px-4 py-3.5 text-slate-500">{shortDate(job.date_received)}</td>
                  <td className="px-4 py-3.5"><StatusPill value={job.status} label={statusNames[job.status]} /></td>
                </tr>
              ))}
              {!data.jobs.length && !loading && <tr><td colSpan={4}><EmptyInline text="No repair jobs yet. Start with a new job card." /></td></tr>}
              {loading && !data.jobs.length && <TableSkeleton columns={4} rows={4} />}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function JobsPage({
  jobs,
  loading,
  canUpdate,
  canRecordParts,
  role,
  onStatus,
  onAddUsage,
}: {
  jobs: JobCard[];
  loading: boolean;
  canUpdate: boolean;
  canRecordParts: boolean;
  role: Role;
  onStatus: (job: JobCard, status: JobStatus) => void;
  onAddUsage: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const visible = jobs.filter((job) => filter === "all" || job.status === filter);
  const mechanicStatuses: JobStatus[] = [
    "diagnosing",
    "in_progress",
    "awaiting_parts",
    "completed",
  ];
  const statusOptionsFor = (job: JobCard) => {
    if (role !== "mechanic") return jobStatuses;
    const allowed = jobStatuses.filter((status) =>
      mechanicStatuses.includes(status),
    );
    return allowed.includes(job.status) ? allowed : [job.status, ...allowed];
  };
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div><h2 className="text-sm font-semibold">Job cards <span className="ml-1.5 inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-muted ring-1 ring-inset ring-line">{visible.length}</span></h2><p className="mt-1 text-xs text-muted">Repair status and assigned vehicle</p></div>
        <div className="flex items-center gap-2">
          <select aria-label="Filter jobs by status" value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-lg border-line py-2 pl-3 pr-8 text-xs">
            <option value="all">All statuses</option>
            {jobStatuses.map((status) => <option key={status} value={status}>{statusNames[status]}</option>)}
          </select>
          {canRecordParts && <button className="button-secondary !py-2 text-xs" onClick={onAddUsage}><Package size={14} />Record parts used</button>}
        </div>
      </div>
      <div className="max-h-[72vh] overflow-auto">
        <table className="w-full min-w-[830px] text-left text-xs">
          <thead className="table-head"><tr><th className="px-5 py-3">Job card</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Reported issue</th><th className="px-4 py-3">Mechanic</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Update</th></tr></thead>
          <tbody className="divide-y divide-line">
            {visible.map((job) => (
              <tr key={job.id} className="align-top transition-colors hover:bg-slate-50/70">
                <td className="px-5 py-4"><div className="font-semibold">{job.job_number}</div><div className="mt-1 text-[10px] text-muted">{job.vehicle?.registration_number} · {job.vehicle?.make} {job.vehicle?.model}</div><div className="mt-1 text-[10px] text-muted">Due {shortDate(job.estimated_completion_date)}</div></td>
                <td className="px-4 py-4"><div className="font-medium">{job.customer?.full_name || "—"}</div><div className="mt-1 text-[10px] text-muted">{job.customer?.phone}</div></td>
                <td className="max-w-[200px] px-4 py-4 text-slate-600">{job.reported_problem}</td>
                <td className="px-4 py-4 text-slate-600">{job.mechanic?.full_name || "Unassigned"}</td>
                <td className="px-4 py-4"><StatusPill value={job.status} label={statusNames[job.status]} /></td>
                <td className="px-4 py-4">
                  {canUpdate ? (
                    <select aria-label={`Update ${job.job_number} status`} value={job.status} onChange={(event) => onStatus(job, event.target.value as JobStatus)} className="max-w-[145px] rounded-lg border-line py-1.5 pl-2 pr-7 text-[10px]">
                      {statusOptionsFor(job).map((status) => <option key={status} value={status}>{statusNames[status]}</option>)}
                    </select>
                  ) : <span className="text-[10px] text-muted">Read only</span>}
                </td>
              </tr>
            ))}
            {!visible.length && !loading && <tr><td colSpan={6}><EmptyState icon={ClipboardList} title="No jobs found" description="Create a job card to start tracking a repair." /></td></tr>}
            {loading && !jobs.length && <TableSkeleton columns={6} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomersPage({
  customers,
  vehicles,
  jobs,
  invoices,
  showBalances,
  loading,
  canManage,
  onArchive,
  onEdit,
}: {
  customers: Customer[];
  vehicles: Vehicle[];
  jobs: JobCard[];
  invoices: Invoice[];
  showBalances: boolean;
  loading: boolean;
  canManage: boolean;
  onArchive: (customer: Customer) => void;
  onEdit: (customer: Customer) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="text-sm font-semibold">Customer directory</h2><p className="mt-1 text-xs text-muted">Contact details and registered vehicles</p></div><div className="flex items-center gap-1 text-xs text-muted"><UsersRound size={15} />{customers.length} customers</div></div>
      <div className="max-h-[72vh] overflow-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="table-head"><tr><th className="px-5 py-3">Customer</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Vehicles</th><th className="px-4 py-3">Repair history</th><th className="px-4 py-3">Balance due</th><th className="px-4 py-3">Added</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-line">
            {customers.map((customer) => {
              const ownedVehicles = vehicles.filter((vehicle) => vehicle.customer_id === customer.id);
              const repairCount = jobs.filter((job) => job.customer_id === customer.id).length;
              const balance = invoices
                .filter((invoice) => invoice.customer_id === customer.id)
                .reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount_total) - Number(invoice.amount_paid)), 0);
              return (
                <tr key={customer.id} className="transition-colors hover:bg-slate-50/70">
                  <td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{initials(customer.full_name)}</div><span className="font-semibold">{customer.full_name}</span></div></td>
                  <td className="px-4 py-3.5"><div>{customer.phone}</div><div className="mt-1 text-[10px] text-muted">{customer.email || "No email"}</div></td>
                  <td className="px-4 py-3.5"><div className="flex flex-wrap gap-1.5">{ownedVehicles.length ? ownedVehicles.map((vehicle) => <span key={vehicle.id} className="rounded bg-slate-100 px-2 py-1 text-[10px] font-medium">{vehicle.registration_number}</span>) : <span className="text-muted">None yet</span>}</div></td>
                  <td className="px-4 py-3.5 text-slate-600">{repairCount} job{repairCount === 1 ? "" : "s"}</td>
                  <td className={`px-4 py-3.5 font-medium ${showBalances && balance ? "text-rose-700" : "text-slate-500"}`}>{showBalances ? money(balance) : "Restricted"}</td>
                  <td className="px-4 py-3.5 text-slate-500">{shortDate(customer.created_at)}</td>
                  <td className="px-4 py-3.5">
                    {canManage && <div className="flex gap-2"><button onClick={() => onEdit(customer)} title="Edit customer" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-ink"><Pencil size={14} /></button><button onClick={() => onArchive(customer)} className="text-[10px] font-medium text-slate-400 hover:text-rose-700">Archive</button></div>}
                  </td>
                </tr>
              );
            })}
            {!customers.length && !loading && <tr><td colSpan={7}><EmptyState icon={UsersRound} title="No customers yet" description="Add your first customer to get started." /></td></tr>}
            {loading && !customers.length && <TableSkeleton columns={7} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VehiclesPage({ vehicles, loading }: { vehicles: Vehicle[]; loading: boolean }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="text-sm font-semibold">Registered vehicles</h2><p className="mt-1 text-xs text-muted">Vehicle ownership and service details</p></div><div className="flex items-center gap-1 text-xs text-muted"><CarFront size={15} />{vehicles.length} vehicles</div></div>
      <div className="max-h-[72vh] overflow-auto">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="table-head"><tr><th className="px-5 py-3">Vehicle</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Year</th><th className="px-4 py-3">Mileage</th><th className="px-4 py-3">Engine</th></tr></thead>
          <tbody className="divide-y divide-line">
            {vehicles.map((vehicle) => <tr key={vehicle.id} className="transition-colors hover:bg-slate-50/70"><td className="px-5 py-4"><div className="font-semibold">{vehicle.registration_number}</div><div className="mt-1 text-[10px] text-muted">{vehicle.make} {vehicle.model}</div></td><td className="px-4 py-4">{vehicle.customer?.full_name || "—"}</td><td className="px-4 py-4 text-slate-600">{vehicle.manufacturing_year || "—"}</td><td className="px-4 py-4 text-slate-600">{vehicle.mileage != null ? `${Number(vehicle.mileage).toLocaleString()} km` : "—"}</td><td className="px-4 py-4 text-slate-600">{vehicle.engine_type || "—"}</td></tr>)}
            {!vehicles.length && !loading && <tr><td colSpan={5}><EmptyState icon={CarFront} title="No vehicles registered" description="Register a customer vehicle to make it available for repair jobs." /></td></tr>}
            {loading && !vehicles.length && <TableSkeleton columns={5} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AppointmentsPage({
  appointments,
  loading,
  canManage,
  onCancel,
}: {
  appointments: Appointment[];
  loading: boolean;
  canManage: boolean;
  onCancel: (appointment: Appointment) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div><h2 className="text-sm font-semibold">Workshop appointments</h2><p className="mt-1 text-xs text-muted">Upcoming bookings and recently completed visits</p></div>
        <div className="flex items-center gap-1 text-xs text-muted"><CalendarDays size={15} />{appointments.length} bookings</div>
      </div>
      <div className="max-h-[72vh] overflow-auto">
        <table className="w-full min-w-[700px] text-left text-xs">
          <thead className="table-head"><tr><th className="px-5 py-3">Date / time</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-line">
            {appointments.map((appointment) => (
              <tr key={appointment.id} className="transition-colors hover:bg-slate-50/70">
                <td className="px-5 py-3.5"><div className="font-semibold">{shortDate(appointment.scheduled_at)}</div><div className="mt-1 text-[10px] text-muted">{new Date(appointment.scheduled_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</div></td>
                <td className="px-4 py-3.5">{appointment.customer?.full_name || "—"}</td>
                <td className="px-4 py-3.5 text-slate-600">{appointment.vehicle?.registration_number || "—"}</td>
                <td className="max-w-[220px] px-4 py-3.5 text-slate-600">{appointment.reason}</td>
                <td className="px-4 py-3.5"><StatusPill value={appointment.status} label={appointment.status} /></td>
                <td className="px-4 py-3.5">{canManage && appointment.status === "scheduled" && <button onClick={() => onCancel(appointment)} className="text-[10px] font-medium text-slate-400 hover:text-rose-700">Cancel</button>}</td>
              </tr>
            ))}
            {!appointments.length && !loading && <tr><td colSpan={6}><EmptyState icon={CalendarDays} title="No appointments" description="Book a customer visit to see it in this schedule." /></td></tr>}
            {loading && !appointments.length && <TableSkeleton columns={6} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamPage({
  staff,
  loading,
  canManage,
}: {
  staff: GarageData["staff"];
  loading: boolean;
  canManage: boolean;
}) {
  const roleNames: Record<string, string> = {
    owner: "Owner / Admin",
    manager: "Workshop Manager",
    mechanic: "Mechanic",
    receptionist: "Receptionist",
    accountant: "Accountant",
  };
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div><h2 className="text-sm font-semibold">Workshop staff</h2><p className="mt-1 text-xs text-muted">Access is enforced by database policies for each workshop role.</p></div>
        <div className="flex items-center gap-1 text-xs text-muted"><UsersRound size={15} />{staff.length} members</div>
      </div>
      <div className="divide-y divide-line">
        {staff.map((member) => (
          <div key={member.id} className="flex items-center gap-3 px-5 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">{initials(member.full_name)}</div>
            <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{member.full_name}</div><div className="mt-1 text-[10px] text-muted">{roleNames[member.role] || member.role}</div></div>
            {member.role === "owner" && <StatusPill value="completed" label="Owner" />}
          </div>
        ))}
        {!staff.length && !loading && <EmptyState icon={UsersRound} title="No staff profiles" description="Workshop staff will appear here after they accept their Neon Auth invitation." />}
        {loading && !staff.length && <div className="px-5"><ListSkeleton rows={4} /></div>}
      </div>
      {!canManage && <div className="border-t border-line bg-slate-50 px-5 py-3 text-[10px] text-muted">Only workshop owners and managers can invite staff.</div>}
      {canManage && <div className="border-t border-line bg-slate-50 px-5 py-3 text-[10px] text-muted">Invitations create staff profiles with a fixed role after email confirmation.</div>}
    </div>
  );
}

function InventoryPage({
  parts,
  loading,
  canManage,
  onUsage,
}: {
  parts: SparePart[];
  loading: boolean;
  canManage: boolean;
  onUsage: () => void;
}) {
  const lowStock = parts.filter((part) => Number(part.quantity_on_hand) <= Number(part.minimum_stock));
  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <MiniStat icon={Package} label="Parts tracked" value={parts.length} />
        <MiniStat icon={ArrowDownRight} label="Low stock" value={lowStock.length} tone={lowStock.length ? "warning" : "default"} />
        <MiniStat icon={CircleDollarSign} label="Inventory value" value={money(parts.reduce((sum, part) => sum + Number(part.quantity_on_hand) * Number(part.purchase_price), 0))} />
      </div>
      {lowStock.length > 0 && <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"><Package size={16} /><span><strong>{lowStock.length} low-stock alert{lowStock.length === 1 ? "" : "s"}:</strong> {lowStock.slice(0, 3).map((part) => part.name).join(", ")}{lowStock.length > 3 ? "…" : ""}</span></div>}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><h2 className="text-sm font-semibold">Spare parts</h2><p className="mt-1 text-xs text-muted">Stock on hand and pricing</p></div>{canManage && <button className="button-secondary !py-2 text-xs" onClick={onUsage}><Package size={14} />Record usage</button>}</div>
        <div className="max-h-[72vh] overflow-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="table-head"><tr><th className="px-5 py-3">Part</th><th className="px-4 py-3">SKU</th><th className="px-4 py-3">In stock</th><th className="px-4 py-3">Min. level</th><th className="px-4 py-3">Cost</th><th className="px-4 py-3">Selling price</th><th className="px-4 py-3">Stock status</th></tr></thead>
            <tbody className="divide-y divide-line">
              {parts.map((part) => {
                const isLow = Number(part.quantity_on_hand) <= Number(part.minimum_stock);
                return <tr key={part.id} className="transition-colors hover:bg-slate-50/70"><td className="px-5 py-3.5"><div className="font-semibold">{part.name}</div></td><td className="px-4 py-3.5 font-mono text-[10px] text-slate-500">{part.sku}</td><td className={`px-4 py-3.5 font-semibold ${isLow ? "text-amber-700" : ""}`}>{part.quantity_on_hand}</td><td className="px-4 py-3.5 text-slate-500">{part.minimum_stock}</td><td className="px-4 py-3.5">{money(part.purchase_price)}</td><td className="px-4 py-3.5">{money(part.selling_price)}</td><td className="px-4 py-3.5"><StatusPill value={isLow ? "awaiting_parts" : "completed"} label={isLow ? "Reorder" : "In stock"} /></td></tr>;
              })}
              {!parts.length && !loading && <tr><td colSpan={7}><EmptyState icon={Package} title="Inventory is empty" description="Add spare parts to track quantities, prices and stock alerts." /></td></tr>}
              {loading && !parts.length && <TableSkeleton columns={7} />}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function InvoicesPage({
  invoices,
  loading,
  canManage,
  onPayment,
  onPreview,
}: {
  invoices: Invoice[];
  loading: boolean;
  canManage: boolean;
  onPayment: () => void;
  onPreview: (invoice: Invoice) => void;
}) {
  const totalOutstanding = invoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount_total) - Number(invoice.amount_paid)), 0);
  const paidTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.amount_paid), 0);
  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <MiniStat icon={CircleDollarSign} label="Invoiced" value={money(invoices.reduce((sum, invoice) => sum + Number(invoice.amount_total), 0))} />
        <MiniStat icon={ArrowDownRight} label="Payments received" value={money(paidTotal)} />
        <MiniStat icon={Clock3} label="Outstanding" value={money(totalOutstanding)} tone={totalOutstanding ? "warning" : "default"} />
      </div>
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><h2 className="text-sm font-semibold">Invoices</h2><p className="mt-1 text-xs text-muted">Create invoices, print customer copies, and track balances</p></div>{canManage && <button className="button-secondary !py-2 text-xs" onClick={onPayment}><Plus size={14} />Record payment</button>}</div>
        <div className="max-h-[72vh] overflow-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="table-head"><tr><th className="px-5 py-3">Invoice</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Job</th><th className="px-4 py-3">Issued</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {invoices.map((invoice) => <tr key={invoice.id} className="transition-colors hover:bg-slate-50/70"><td className="px-5 py-3.5 font-semibold">{invoice.invoice_number}</td><td className="px-4 py-3.5">{invoice.customer?.full_name || "—"}</td><td className="px-4 py-3.5 text-slate-500">{invoice.job?.job_number || "—"}</td><td className="px-4 py-3.5 text-slate-500">{shortDate(invoice.created_at)}</td><td className="px-4 py-3.5 font-medium">{money(invoice.amount_total)}</td><td className="px-4 py-3.5">{money(Number(invoice.amount_total) - Number(invoice.amount_paid))}</td><td className="px-4 py-3.5"><StatusPill value={invoice.status} label={invoice.status.replace("_", " ")} /></td><td className="px-4 py-3.5"><button onClick={() => onPreview(invoice)} className="text-[10px] font-semibold text-accent hover:underline">Print</button></td></tr>)}
              {!invoices.length && !loading && <tr><td colSpan={8}><EmptyState icon={CircleDollarSign} title="No invoices yet" description="Create an invoice from a repair job when work is ready to bill." /></td></tr>}
              {loading && !invoices.length && <TableSkeleton columns={8} />}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ReportsPage({
  reportDays,
  setReportDays,
  reportPayments,
  revenue,
  chart,
  invoices,
  jobs,
  parts,
}: {
  reportDays: number;
  setReportDays: (days: number) => void;
  reportPayments: Payment[];
  revenue: number;
  chart: { date: string; label: string; amount: number }[];
  invoices: Invoice[];
  jobs: JobCard[];
  parts: SparePart[];
}) {
  const unpaid = invoices.reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount_total) - Number(invoice.amount_paid)), 0);
  const completed = jobs.filter((job) => job.status === "completed" || job.status === "collected").length;
  const exportCsv = () => {
    const rows = [
      ["Date", "Invoice", "Customer", "Payment method", "Reference", "Amount (KES)"],
      ...reportPayments.map((payment) => [
        payment.paid_at,
        payment.invoice?.invoice_number || "",
        payment.invoice?.customer?.full_name || "",
        payment.method,
        payment.reference || "",
        String(payment.amount),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `garageos-payments-${localDateKey()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">A live summary of recorded workshop activity.</p>
        <div className="flex items-center gap-2">
          <select value={reportDays} onChange={(event) => setReportDays(Number(event.target.value))} aria-label="Report date range" className="rounded-lg border-line py-2 pl-3 pr-8 text-xs"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
          <button className="button-secondary !py-2 text-xs" onClick={exportCsv}><Download size={14} />Export CSV</button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat icon={ArrowUpRight} label={`Revenue · ${reportDays} days`} value={money(revenue)} />
        <MiniStat icon={ClipboardList} label="Jobs completed" value={completed} />
        <MiniStat icon={CircleDollarSign} label="Outstanding balance" value={money(unpaid)} tone={unpaid ? "warning" : "default"} />
        <MiniStat icon={Package} label="Parts in inventory" value={parts.length} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="card p-5 md:p-6">
          <h2 className="text-sm font-semibold">Payments received</h2>
          <p className="mt-1 text-xs text-muted">Daily totals for the selected period</p>
          <div className="mt-5 h-[290px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                <defs><linearGradient id="reportFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#91bd4b" stopOpacity={0.25} /><stop offset="95%" stopColor="#91bd4b" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#eef0f2" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#87919b" }} dy={8} interval={reportDays > 30 ? 6 : "preserveStartEnd"} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#87919b" }} width={52} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)} />
                <Tooltip formatter={(value) => money(Number(value))} contentStyle={{ borderRadius: 10, border: "1px solid #e8ebee", fontSize: 12 }} />
                <Area type="monotone" dataKey="amount" stroke="#719a32" strokeWidth={2.5} fill="url(#reportFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card p-5 md:p-6">
          <h2 className="text-sm font-semibold">Repair job breakdown</h2>
          <p className="mt-1 text-xs text-muted">Current status across all jobs</p>
          <div className="mt-5 space-y-3">
            {jobStatuses.map((status) => {
              const count = jobs.filter((job) => job.status === status).length;
              const percent = jobs.length ? Math.round((count / jobs.length) * 100) : 0;
              return <div key={status}><div className="mb-1.5 flex justify-between text-[11px]"><span className="text-slate-600">{statusNames[status]}</span><span className="font-semibold">{count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} /></div></div>;
            })}
          </div>
          <div className="mt-5 border-t border-line pt-4 text-xs"><div className="flex justify-between"><span className="text-muted">Labour / parts breakdown</span><span className="text-slate-500">Not itemized yet</span></div><p className="mt-2 leading-relaxed text-[10px] text-muted">Detailed profit and mechanic reports depend on itemized quotations and staff time entries, which are planned for a later stage.</p></div>
        </div>
      </div>
      <div className="mt-4 card overflow-hidden">
        <div className="border-b border-line px-5 py-4"><h2 className="text-sm font-semibold">Payments in selected period</h2><p className="mt-1 text-xs text-muted">{reportPayments.length} recorded transactions</p></div>
        <div className="max-h-[72vh] overflow-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="table-head"><tr><th className="px-5 py-3">Date</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-line">{reportPayments.slice(0, 100).map((payment) => <tr key={payment.id}><td className="px-5 py-3">{shortDate(payment.paid_at)}</td><td className="px-4 py-3">{payment.invoice?.invoice_number || "—"}</td><td className="px-4 py-3">{payment.invoice?.customer?.full_name || "—"}</td><td className="px-4 py-3 capitalize">{payment.method.replace("_", " ")}</td><td className="px-4 py-3 text-slate-500">{payment.reference || "—"}</td><td className="px-4 py-3 text-right font-semibold">{money(payment.amount)}</td></tr>)}{!reportPayments.length && <tr><td colSpan={6}><EmptyInline text="No payments in this date range." /></td></tr>}</tbody></table></div>
      </div>
    </>
  );
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function MiniStat({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Package;
  label: string;
  value: string | number;
  tone?: "default" | "warning";
}) {
  return <div className="card flex items-center gap-4 p-4"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${tone === "warning" ? "bg-amber-50 text-amber-700 ring-amber-600/10" : "bg-accent-soft text-accent ring-line-soft"}`}><Icon size={17} /></div><div className="min-w-0"><div className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-muted">{label}</div><div className="mt-1 truncate font-display text-lg font-bold tracking-tight">{value}</div></div></div>;
}

function StatusPill({ value, label }: { value: string; label: string }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize ring-1 ring-inset ${statusClass(value)}`}><span className={`h-1.5 w-1.5 rounded-full ${statusDot(value)}`} />{label}</span>;
}

function EmptyInline({ text }: { text: string }) {
  return <div className="py-7 text-center text-xs text-muted">{text}</div>;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

function TableSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  const widths = ["w-32", "w-24", "w-20", "w-16", "w-14", "w-12", "w-10", "w-8"];
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => (
            <td key={column} className="px-4 py-4 first:pl-5 last:pr-5">
              {column === 0 ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              ) : (
                <Skeleton className={`h-3 ${widths[column % widths.length]}`} />
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} aria-hidden="true" className="flex items-center gap-3 py-3.5">
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Package;
  title: string;
  description: string;
}) {
  return <div className="flex flex-col items-center px-5 py-14 text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent ring-1 ring-inset ring-line-soft"><Icon size={20} /></div><h3 className="mt-3.5 text-sm font-semibold">{title}</h3><p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">{description}</p></div>;
}

function Modal({
  title,
  onClose,
  children,
  print = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  print?: boolean;
}) {
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px] ${print ? "print-root" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full ${print ? "max-w-[780px] print-modal" : "max-w-[560px]"} overflow-y-auto rounded-[20px] border border-line bg-white p-5 shadow-float md:p-6`}>
        <div className={`mb-5 flex items-center justify-between ${print ? "print:hidden" : ""}`}>
          <h2 className="text-base font-semibold">{title}</h2>
          <button aria-label="Close dialog" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  as = "input",
  children,
  error,
  ...props
}: {
  label: string;
  name: string;
  as?: "input" | "textarea" | "select";
  children?: ReactNode;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement> & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const inputProps = props as React.InputHTMLAttributes<HTMLInputElement>;
  const textareaProps = props as React.TextareaHTMLAttributes<HTMLTextAreaElement>;
  const selectProps = props as React.SelectHTMLAttributes<HTMLSelectElement>;
  const fieldClass = error
    ? "field !border-rose-300 bg-rose-50/40 focus:!border-rose-400 focus:!ring-rose-200"
    : "field";
  const shared = {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${name}-error` : undefined,
  };
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}{props.required && <span className="ml-0.5 text-rose-600">*</span>}
      {as === "textarea" ? (
        <textarea name={name} rows={3} className={`${fieldClass} resize-y`} {...shared} {...textareaProps} />
      ) : as === "select" ? (
        <select name={name} className={fieldClass} {...shared} {...selectProps}>{children}</select>
      ) : (
        <input name={name} className={fieldClass} {...shared} {...inputProps} />
      )}
      {error && (
        <span id={`${name}-error`} className="mt-1.5 block text-[10px] font-medium leading-relaxed text-rose-600">
          {error}
        </span>
      )}
    </label>
  );
}

function ModalActions({
  onCancel,
  submitLabel,
  disabled = false,
}: {
  onCancel: () => void;
  submitLabel: string;
  disabled?: boolean;
}) {
  return <div className="flex justify-end gap-2 border-t border-line pt-4"><button type="button" className="button-secondary" onClick={onCancel}>Cancel</button><button type="submit" className="button-primary" disabled={disabled}>{submitLabel}</button></div>;
}

function InlineNotice({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-600">{children}</div>;
}

type PaletteItem = {
  key: string;
  group: "Quick actions" | "Pages" | "Customers" | "Vehicles" | "Jobs" | "Invoices";
  label: string;
  hint?: string;
  icon: typeof Package;
  run: () => void;
};

function CommandPalette({
  data,
  theme,
  shortcutLabel,
  pages,
  permissions,
  onClose,
  onNavigate,
  onCreate,
  onOpenInvoice,
  onAssistant,
  onToggleTheme,
}: {
  data: GarageData;
  theme: Theme;
  shortcutLabel: string;
  pages: Page[];
  permissions: {
    job: boolean;
    customer: boolean;
    inventory: boolean;
    invoices: boolean;
    team: boolean;
    usage: boolean;
  };
  onClose: () => void;
  onNavigate: (page: Page, search?: string) => void;
  onCreate: (modal: Exclude<Modal, null>) => void;
  onOpenInvoice: (invoice: Invoice) => void;
  onAssistant: () => void;
  onToggleTheme: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const actions: PaletteItem[] = [];
  actions.push({ key: "assistant", group: "Quick actions", label: "Open workshop assistant", hint: "Reminders, activity log and quick answers · Ctrl J", icon: Sparkles, run: onAssistant });
  if (permissions.job) {
    actions.push({ key: "new-job", group: "Quick actions", label: "New job card", hint: "Check in a vehicle and open a repair", icon: ClipboardList, run: () => onCreate("job") });
  }
  if (permissions.customer) {
    actions.push({ key: "new-customer", group: "Quick actions", label: "Add customer", hint: "Create a customer record", icon: UsersRound, run: () => onCreate("customer") });
    actions.push({ key: "new-vehicle", group: "Quick actions", label: "Register vehicle", hint: "Add a vehicle to a customer", icon: CarFront, run: () => onCreate("vehicle") });
    actions.push({ key: "new-appointment", group: "Quick actions", label: "Book appointment", hint: "Schedule a customer visit", icon: CalendarDays, run: () => onCreate("appointment") });
  }
  if (permissions.usage) {
    actions.push({ key: "record-usage", group: "Quick actions", label: "Record parts used", hint: "Deduct stock against an active job", icon: Package, run: () => onCreate("usage") });
  }
  if (permissions.inventory) {
    actions.push({ key: "new-part", group: "Quick actions", label: "Add spare part", hint: "New inventory item", icon: Plus, run: () => onCreate("part") });
  }
  if (permissions.invoices) {
    actions.push({ key: "new-invoice", group: "Quick actions", label: "Create invoice", hint: "Bill a completed repair job", icon: FileText, run: () => onCreate("invoice") });
    actions.push({ key: "record-payment", group: "Quick actions", label: "Record payment", hint: "Apply a payment to an invoice", icon: CircleDollarSign, run: () => onCreate("payment") });
  }
  if (permissions.team) {
    actions.push({ key: "invite", group: "Quick actions", label: "Invite staff", hint: "Create a staff invitation link", icon: UsersRound, run: () => onCreate("invite") });
  }
  actions.push({
    key: "toggle-theme",
    group: "Quick actions",
    label: `Switch to ${theme === "dark" ? "light" : "dark"} mode`,
    hint: "Change the workspace appearance",
    icon: theme === "dark" ? Sun : Moon,
    run: onToggleTheme,
  });

  pages.forEach((page) => {
    const icon = navItems.find((item) => item.name === page)?.icon || LayoutDashboard;
    actions.push({ key: `page-${page}`, group: "Pages", label: page, hint: "Go to page", icon, run: () => onNavigate(page) });
  });

  data.customers.forEach((customer) => {
    actions.push({
      key: `customer-${customer.id}`,
      group: "Customers",
      label: customer.full_name,
      hint: [customer.phone, customer.email].filter(Boolean).join(" · "),
      icon: UsersRound,
      run: () => onNavigate("Customers", customer.full_name),
    });
  });

  data.vehicles.forEach((vehicle) => {
    actions.push({
      key: `vehicle-${vehicle.id}`,
      group: "Vehicles",
      label: vehicle.registration_number,
      hint: [vehicle.make, vehicle.model, vehicle.customer?.full_name].filter(Boolean).join(" · "),
      icon: CarFront,
      run: () => onNavigate("Vehicles", vehicle.registration_number),
    });
  });

  data.jobs.forEach((job) => {
    actions.push({
      key: `job-${job.id}`,
      group: "Jobs",
      label: job.job_number,
      hint: [statusNames[job.status], job.vehicle?.registration_number, job.customer?.full_name].filter(Boolean).join(" · "),
      icon: ClipboardList,
      run: () => onNavigate("Jobs", job.job_number),
    });
  });

  if (permissions.invoices) {
    data.invoices.forEach((invoice) => {
      const balance = Math.max(0, Number(invoice.amount_total) - Number(invoice.amount_paid));
      actions.push({
        key: `invoice-${invoice.id}`,
        group: "Invoices",
        label: invoice.invoice_number,
        hint: [invoice.customer?.full_name, `${money(balance)} balance`, invoice.status.replace("_", " ")].filter(Boolean).join(" · "),
        icon: FileText,
        run: () => onOpenInvoice(invoice),
      });
    });
  }

  const normalised = query.trim().toLowerCase();
  const scoped = normalised
    ? actions.filter((item) =>
        `${item.label} ${item.hint || ""} ${item.group}`.toLowerCase().includes(normalised),
      )
    : actions.filter((item) => item.group === "Quick actions" || item.group === "Pages");

  const grouped = new Map<string, PaletteItem[]>();
  const perGroupLimit = normalised ? 6 : 50;
  scoped.forEach((item) => {
    const list = grouped.get(item.group);
    if (!list) grouped.set(item.group, [item]);
    else if (list.length < perGroupLimit) list.push(item);
  });
  const results = Array.from(grouped.values()).flat();

  const runItem = (item: PaletteItem) => {
    onClose();
    item.run();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (results.length ? (current + 1) % results.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = results[active];
      if (item) runItem(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  let offset = 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/50 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-[620px] overflow-hidden rounded-2xl border border-line bg-surface shadow-float"
      >
        <div className="flex items-center gap-3 border-b border-line-soft px-4">
          <Search size={17} className="shrink-0 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search jobs, customers, vehicles, invoices or jump to a page…"
            className="h-14 min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-ink shadow-none placeholder:text-slate-400 focus:border-0 focus:ring-0"
          />
          <kbd className="shrink-0 rounded-md border border-line bg-surface-muted px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
            Esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {results.length ? (
            Array.from(grouped.entries()).map(([group, items]) => {
              const start = offset;
              offset += items.length;
              return (
                <div key={group} className="pb-1">
                  <div className="px-3 pb-1.5 pt-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">
                    {group}
                  </div>
                  {items.map((item, index) => {
                    const itemIndex = start + index;
                    const isActive = itemIndex === active;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        data-index={itemIndex}
                        onMouseMove={() => {
                          if (!isActive) setActive(itemIndex);
                        }}
                        onClick={() => runItem(item)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          isActive
                            ? "bg-accent-soft ring-1 ring-inset ring-accent-line"
                            : "hover:bg-surface-muted"
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                            isActive
                              ? "bg-surface text-accent ring-accent-line"
                              : "bg-surface-muted text-muted ring-line-soft"
                          }`}
                        >
                          <Icon size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-ink">{item.label}</span>
                          {item.hint && (
                            <span className="mt-0.5 block truncate text-[10px] text-muted">{item.hint}</span>
                          )}
                        </span>
                        {isActive && <CornerDownLeft size={13} className="shrink-0 text-slate-400" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          ) : (
            <div className="px-5 py-10 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-inset ring-line-soft">
                <Search size={17} />
              </div>
              <div className="mt-3 text-sm font-semibold">No matches for “{query.trim()}”</div>
              <p className="mt-1 text-xs text-muted">Try a job number, plate, customer or invoice.</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line-soft bg-surface-muted px-4 py-2.5 text-[10px] text-muted">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line bg-surface px-1 py-0.5 text-[9px] font-semibold">↑</kbd>
              <kbd className="rounded border border-line bg-surface px-1 py-0.5 text-[9px] font-semibold">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-[9px] font-semibold">↵</kbd>
              open
            </span>
          </div>
          <span className="hidden items-center gap-1.5 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {shortcutLabel} to toggle
          </span>
        </div>
      </div>
    </div>
  );
}

function InvoiceDocument({
  workshopName,
  invoice,
  payments,
}: {
  workshopName: string;
  invoice: Invoice;
  payments: Payment[];
}) {
  const total = Number(invoice.amount_total);
  const paid = Number(invoice.amount_paid);
  const balance = Math.max(0, total - paid);
  const statusMeta = {
    paid: { label: "Paid in full", bg: "#ecfdf5", text: "#047857", dot: "#10b981" },
    partially_paid: { label: "Partially paid", bg: "#fffbeb", text: "#b45309", dot: "#f59e0b" },
    unpaid: { label: "Payment due", bg: "#fff1f2", text: "#be123c", dot: "#f43f5e" },
  }[invoice.status];
  return (
    <div className="invoice-sheet print-area rounded-xl border border-[#e6e9ed] p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-[#e7eae3] pb-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#16211c] text-[#c5f467]">
            <Wrench size={20} strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-display text-[19px] font-extrabold leading-tight tracking-[-0.02em] text-[#17211c]">{workshopName}</div>
            <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#7a857d]">Workshop &amp; repair services</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#7a857d]">Invoice</div>
          <div className="mt-1 font-display text-xl font-extrabold tracking-[-0.02em] text-[#17211c]">{invoice.invoice_number}</div>
          <span
            className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={{ backgroundColor: statusMeta.bg, color: statusMeta.text }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusMeta.dot }} />
            {statusMeta.label}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8b958e]">Billed to</div>
          <div className="mt-1.5 text-sm font-semibold text-[#17211c]">{invoice.customer?.full_name || "Customer"}</div>
          <div className="mt-1 text-[11px] text-[#6b7570]">Vehicle service customer</div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-1">
          <div className="flex items-baseline justify-between gap-4 sm:justify-end">
            <span className="text-[10px] uppercase tracking-[0.1em] text-[#8b958e]">Issued</span>
            <span className="text-[11px] font-semibold text-[#17211c]">{shortDate(invoice.created_at)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4 sm:justify-end">
            <span className="text-[10px] uppercase tracking-[0.1em] text-[#8b958e]">Due</span>
            <span className="text-[11px] font-semibold text-[#17211c]">{invoice.due_date ? shortDate(invoice.due_date) : "On receipt"}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4 sm:justify-end">
            <span className="text-[10px] uppercase tracking-[0.1em] text-[#8b958e]">Job ref</span>
            <span className="text-[11px] font-semibold text-[#17211c]">{invoice.job?.job_number || "—"}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-[#e2e7df]">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-[#f3f5f0] text-[9px] font-semibold uppercase tracking-[0.14em] text-[#6b7570]">
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-center">Qty</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-[#edf0e9]">
              <td className="px-4 py-4">
                <div className="font-semibold text-[#17211c]">Repair services</div>
                <div className="mt-1 text-[10px] text-[#7a857d]">Service, labour and workshop consumables{invoice.job?.job_number ? ` · Job ${invoice.job.job_number}` : ""}</div>
              </td>
              <td className="px-4 py-4 text-center text-[#4f5a53]">1</td>
              <td className="px-4 py-4 text-right font-semibold text-[#17211c]">{money(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-[1.25fr_1fr]">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#8b958e]">Payment history</div>
          {payments.length ? (
            <ul className="mt-2 divide-y divide-[#eef1ea]">
              {payments.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 py-2 text-[11px]">
                  <span className="min-w-0 truncate text-[#6b7570]">
                    {shortDate(payment.paid_at)} · <span className="capitalize">{payment.method.replace("_", " ")}</span>
                    {payment.reference ? ` · ${payment.reference}` : ""}
                  </span>
                  <span className="shrink-0 font-semibold text-[#17211c]">{money(payment.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-[#8b958e]">No payments recorded yet.</p>
          )}
          <p className="mt-4 text-[10px] leading-relaxed text-[#8b958e]">
            Please quote {invoice.invoice_number} on any transfer. Accepted methods: cash, bank transfer or M-Pesa.
          </p>
        </div>
        <div className="rounded-xl bg-[#f3f5f0] p-4">
          <div className="flex justify-between text-[11px] text-[#6b7570]">
            <span>Subtotal</span>
            <span className="font-medium text-[#17211c]">{money(total)}</span>
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-[#6b7570]">
            <span>Paid</span>
            <span className="font-medium text-[#17211c]">− {money(paid)}</span>
          </div>
          <div className="mt-3 flex items-end justify-between border-t border-[#dfe4d9] pt-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#4f5a53]">Balance due</span>
            <span className="font-display text-lg font-extrabold tracking-tight text-[#17211c]">{money(balance)}</span>
          </div>
          <div className="mt-1 text-right text-[9px] uppercase tracking-[0.12em] text-[#8b958e]">All amounts in KES</div>
        </div>
      </div>

      <footer className="mt-7 flex flex-wrap items-end justify-between gap-3 border-t border-[#e7eae3] pt-4">
        <div>
          <div className="text-xs font-semibold text-[#17211c]">Thank you for choosing {workshopName}.</div>
          <div className="mt-1 text-[10px] text-[#8b958e]">
            Keep this invoice for your service records{invoice.due_date ? ` · Payment due ${shortDate(invoice.due_date)}` : ""}.
          </div>
        </div>
        <div className="text-right text-[9px] uppercase tracking-[0.14em] text-[#a3aca5]">Generated with GarageOS</div>
      </footer>
    </div>
  );
}

function modalTitle(modal: Exclude<Modal, null>) {
  const titles: Record<Exclude<Modal, null>, string> = {
    customer: "Add customer",
    vehicle: "Register vehicle",
    appointment: "Book appointment",
    invite: "Invite staff",
    job: "Create job card",
    part: "Add spare part",
    usage: "Record parts used",
    invoice: "Create invoice",
    payment: "Record payment",
    workshop: "Workshop settings",
  };
  return titles[modal];
}

function SetupScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,#161f27_0%,#10171d_100%)] px-5 py-10">
      <div className="w-full max-w-lg rounded-[20px] border border-line bg-white p-7 shadow-float md:p-9">
        <div className="mb-6 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-ink shadow-[0_8px_20px_-8px_rgba(197,244,103,0.7)]"><Wrench size={21} /></div><div><div className="font-display text-lg font-extrabold tracking-tight">Garage<span className="text-accent">OS</span></div><div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted">Workshop suite</div></div></div>
        <h1 className="font-display text-xl font-extrabold">Connect your workshop</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">Connect your Neon Auth branch and server-side Postgres API to enable secure sign-in and live workshop data.</p>
        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <div className="text-xs font-semibold">1. Configure your environment</div>
          <code className="mt-2 block whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">Keep DATABASE_URL server-only. Set VITE_NEON_AUTH_URL from NEON_AUTH_BASE_URL.</code>
          <div className="mt-4 text-xs font-semibold">2. Set up the database</div>
          <code className="mt-2 block text-[11px] leading-relaxed text-slate-600">Apply the tracked schema with npm run db:migrate (uses DATABASE_URL_UNPOOLED).</code>
          <div className="mt-4 text-xs font-semibold">3. Start GarageOS</div>
          <code className="mt-2 block text-[11px] leading-relaxed text-slate-600">npm install && npm run dev</code>
        </div>
        <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-muted"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" />Database credentials stay on the server. Neon Auth tokens are verified by the API, with workshop-scoped PostgreSQL Row Level Security.</p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center bg-canvas"><div className="flex items-center gap-3 text-sm text-muted"><span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-accent" />Loading your workshop…</div></div>;
}

function ProfileError({ error, onSignOut }: { error: string; onSignOut: () => void }) {
  return <div className="flex min-h-screen items-center justify-center bg-canvas p-5"><div className="card max-w-md p-7"><ShieldCheck size={22} className="text-amber-600" /><h1 className="mt-4 text-lg font-semibold">Workshop profile unavailable</h1><p className="mt-2 text-sm leading-relaxed text-muted">{error}</p><button className="button-secondary mt-5" onClick={onSignOut}><LogOut size={15} />Sign out</button></div></div>;
}

function AuthScreen({
  mode,
  setMode,
  values,
  setValues,
  error,
  busy,
  submit,
  verificationPending,
  verificationCode,
  setVerificationCode,
  verify,
  theme,
  toggleTheme,
}: {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  values: { email: string; password: string; name: string };
  setValues: (values: { email: string; password: string; name: string }) => void;
  error: string;
  busy: boolean;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  verificationPending: boolean;
  verificationCode: string;
  setVerificationCode: (code: string) => void;
  verify: (event: FormEvent<HTMLFormElement>) => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[linear-gradient(160deg,#161f27_0%,#10171d_100%)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-36 -top-32 h-[500px] w-[500px] rounded-full border border-white/[0.06]" />
        <div className="absolute -right-16 -top-12 h-[340px] w-[340px] rounded-full border border-white/[0.06]" />
        <div className="relative flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-ink shadow-[0_8px_20px_-8px_rgba(197,244,103,0.7)]"><Wrench size={21} /></div><div><div className="font-display text-lg font-extrabold tracking-tight">Garage<span className="text-lime">OS</span></div><div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">Workshop suite</div></div></div>
        <div className="relative max-w-lg pb-8">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-medium text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-lime" />A clearer view of your workshop</div>
          <h1 className="font-display text-[40px] font-extrabold leading-[1.14] tracking-[-0.03em]">Great work deserves a <span className="text-lime">better workflow.</span></h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-400">Keep repair jobs, customers, parts and payments moving together — from the first check-in to the final handover.</p>
          <div className="mt-9 grid max-w-md grid-cols-3 gap-3">
            {[["Job cards", ClipboardList], ["Inventory", Package], ["Payments", CircleDollarSign]].map(([label, Icon]) => {
              const FeatureIcon = Icon as typeof Package;
              return <div key={label as string} className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><FeatureIcon size={17} className="text-lime" /><div className="mt-3 text-[10px] font-medium text-slate-300">{label as string}</div></div>;
            })}
          </div>
        </div>
        <div className="relative text-[10px] text-slate-500">GarageOS · Workshop management, made practical.</div>
      </div>
      <div className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="relative w-full max-w-[390px]">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <div className="mb-8 flex items-center gap-3 lg:hidden"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-ink shadow-[0_8px_20px_-8px_rgba(197,244,103,0.7)]"><Wrench size={21} /></div><div><div className="font-display text-lg font-extrabold tracking-tight">Garage<span className="text-accent">OS</span></div><div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted">Workshop suite</div></div></div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">{verificationPending ? "Email verification" : mode === "sign_in" ? "Welcome back" : "Get started"}</div>
          <h2 className="mt-2 font-display text-[28px] font-extrabold tracking-[-0.02em]">{verificationPending ? "Verify your email" : mode === "sign_in" ? "Sign in to your account" : "Create your workshop account"}</h2>
          <p className="mt-2 text-sm text-muted">{verificationPending ? `Enter the verification code sent to ${values.email}.` : mode === "sign_in" ? "Enter your details to access your workspace." : "Your owner account will start a new, private workshop."}</p>
          {error && <div role="alert" className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs leading-relaxed text-rose-800">{error}</div>}
          {verificationPending ? (
            <form onSubmit={verify} className="mt-6 space-y-4">
              <Field label="Verification code" name="verification_code" inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} required />
              <button type="submit" className="button-primary w-full !py-3" disabled={busy}>{busy ? "Please wait…" : "Verify email"}</button>
            </form>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              {mode === "sign_up" && <Field label="Your name" name="name" autoComplete="name" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} required />}
              <Field label="Email address" name="email" type="email" autoComplete="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} required />
              <Field label="Password" name="password" type="password" autoComplete={mode === "sign_in" ? "current-password" : "new-password"} value={values.password} onChange={(event) => setValues({ ...values, password: event.target.value })} minLength={8} required />
              {mode === "sign_up" && <p className="text-[10px] text-muted">Use at least 8 characters. Neon Auth may require email verification.</p>}
              <button type="submit" className="button-primary mt-2 w-full !py-3" disabled={busy}>{busy ? "Please wait…" : mode === "sign_in" ? "Sign in" : "Create owner account"}</button>
            </form>
          )}
          {!verificationPending && <div className="mt-6 text-center text-xs text-muted">{mode === "sign_in" ? "New to GarageOS?" : "Already have an account?"}{" "}<button className="font-semibold text-accent hover:underline" onClick={() => setMode(mode === "sign_in" ? "sign_up" : "sign_in")}>{mode === "sign_in" ? "Create an account" : "Sign in"}</button></div>}
          <div className="mt-8 flex items-center justify-center gap-1.5 text-[10px] text-slate-400"><ShieldCheck size={13} />Secure sign-in powered by Neon Auth</div>
        </div>
      </div>
    </div>
  );
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="absolute -right-1 -top-2 rounded-lg p-2 text-slate-500 transition hover:bg-slate-50 hover:text-ink sm:right-0"
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export default App;
