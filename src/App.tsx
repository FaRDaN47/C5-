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
  Download,
  Gauge,
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
  useState,
} from "react";
import { garageApi } from "./lib/api";
import { authClient, isNeonAuthConfigured, type AuthSessionData } from "./lib/auth";
import { whatsappNotificationsEnabled } from "./lib/config";
import type {
  Appointment,
  Customer,
  GarageData,
  Invoice,
  JobCard,
  JobStatus,
  Payment,
  Profile,
  SparePart,
  Vehicle,
} from "./lib/types";

type Page =
  | "Overview"
  | "Jobs"
  | "Customers"
  | "Vehicles"
  | "Appointments"
  | "Inventory"
  | "Invoices"
  | "Reports"
  | "Team";
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

function initials(name: string | null | undefined) {
  return (name || "Garage").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function statusClass(status: string) {
  const classes: Record<string, string> = {
    received: "bg-slate-100 text-slate-600",
    diagnosing: "bg-blue-50 text-blue-700",
    awaiting_approval: "bg-amber-50 text-amber-700",
    in_progress: "bg-lime-50 text-lime-800",
    awaiting_parts: "bg-orange-50 text-orange-700",
    completed: "bg-emerald-50 text-emerald-700",
    collected: "bg-slate-100 text-slate-500",
    unpaid: "bg-rose-50 text-rose-700",
    partially_paid: "bg-amber-50 text-amber-700",
    paid: "bg-emerald-50 text-emerald-700",
    scheduled: "bg-blue-50 text-blue-700",
  };
  return classes[status] || "bg-slate-100 text-slate-600";
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
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [data, setData] = useState<GarageData>(emptyData);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState("");
  const [page, setPage] = useState<Page>("Overview");
  const [modal, setModal] = useState<Modal>(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workshopName, setWorkshopName] = useState("");
  const [reportDays, setReportDays] = useState(30);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [authForm, setAuthForm] = useState({ email: "", password: "", name: "" });
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteToken] = useState(
    () => new URLSearchParams(window.location.search).get("invite"),
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("garageos-theme", theme);
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

  const runAction = async (
    action: () => Promise<void>,
    successText = "Changes saved",
  ) => {
    try {
      await action();
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
    await runAction(async () => {
      await garageApi("saveCustomer", {
        customerId: customerToEdit?.id,
        fullName: String(form.get("full_name") || "").trim(),
        phone: String(form.get("phone") || "").trim(),
        email: String(form.get("email") || "").trim() || null,
        notes: String(form.get("notes") || "").trim() || null,
      });
      await refresh();
      setCustomerToEdit(null);
      setModal(null);
    }, customerToEdit ? "Customer updated" : "Customer added");
  };

  const archiveCustomer = async (customer: Customer) => {
    if (!window.confirm(`Archive ${customer.full_name}?`)) return;
    await runAction(async () => {
      await garageApi("archiveCustomer", { customerId: customer.id });
      await refresh();
    }, "Customer archived");
  };

  const saveVehicle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction(async () => {
      await garageApi("saveVehicle", {
        customerId: String(form.get("customer_id")),
        registrationNumber: String(form.get("registration_number") || "").trim(),
        make: String(form.get("make") || "").trim(),
        model: String(form.get("model") || "").trim(),
        manufacturingYear: form.get("manufacturing_year")
          ? Number(form.get("manufacturing_year"))
          : null,
        mileage: form.get("mileage") ? Number(form.get("mileage")) : null,
        engineType: String(form.get("engine_type") || "").trim() || null,
      });
      await refresh();
      setModal(null);
    }, "Vehicle registered");
  };

  const saveAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scheduledAt = String(form.get("scheduled_at") || "");
    if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) {
      setToast({ text: "Choose a valid appointment date and time.", kind: "error" });
      return;
    }
    await runAction(async () => {
      await garageApi("saveAppointment", {
        customerId: String(form.get("customer_id")),
        vehicleId: String(form.get("vehicle_id") || "") || null,
        scheduledAt: new Date(scheduledAt).toISOString(),
        reason: String(form.get("reason") || "").trim(),
      });
      await refresh();
      setModal(null);
    }, "Appointment booked");
  };

  const cancelAppointment = async (appointment: Appointment) => {
    if (!window.confirm("Cancel this appointment?")) return;
    await runAction(async () => {
      await garageApi("cancelAppointment", { appointmentId: appointment.id });
      await refresh();
    }, "Appointment cancelled");
  };

  const inviteStaff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction(async () => {
      const result = await garageApi<{ token: string }>("inviteStaff", {
        email: String(form.get("email") || "").trim(),
        fullName: String(form.get("full_name") || "").trim(),
        role: String(form.get("role") || ""),
      });
      setInviteUrl(
        `${window.location.origin}/?invite=${encodeURIComponent(result.token)}`,
      );
    }, "Invitation link created");
  };

  const saveJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let notificationToast: Toast | null = null;
    await runAction(async () => {
      const created = await garageApi<{ id: string }>("saveJob", {
        customerId: String(form.get("customer_id")),
        vehicleId: String(form.get("vehicle_id")),
        reportedProblem: String(form.get("reported_problem") || "").trim(),
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
    }, "Job card created");
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
    await runAction(async () => {
      await garageApi("savePart", {
        name: String(form.get("name") || "").trim(),
        sku: String(form.get("sku") || "").trim(),
        quantityOnHand: Number(form.get("quantity_on_hand")),
        minimumStock: Number(form.get("minimum_stock")),
        purchasePrice: Number(form.get("purchase_price")),
        sellingPrice: Number(form.get("selling_price")),
      });
      await refresh();
      setModal(null);
    }, "Part added to inventory");
  };

  const recordPartUsage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction(async () => {
      await garageApi("recordPartUsage", {
        jobId: String(form.get("job_id")),
        partId: String(form.get("part_id")),
        quantity: Number(form.get("quantity")),
      });
      await refresh();
      setModal(null);
    }, "Part usage recorded and stock updated");
  };

  const saveInvoice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const job = data.jobs.find((item) => item.id === String(form.get("job_id")));
    if (!job) {
      setToast({ text: "Select a valid repair job.", kind: "error" });
      return;
    }
    await runAction(async () => {
      await garageApi("saveInvoice", {
        jobId: job.id,
        amountTotal: Number(form.get("amount_total")),
        dueDate: String(form.get("due_date") || "") || null,
      });
      await refresh();
      setModal(null);
    }, "Invoice created");
  };

  const recordPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction(async () => {
      await garageApi("recordPayment", {
        invoiceId: String(form.get("invoice_id")),
        amount: Number(form.get("amount")),
        method: String(form.get("method")),
        reference: String(form.get("reference") || "").trim() || null,
      });
      await refresh();
      setModal(null);
    }, "Payment recorded");
  };

  const saveWorkshop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    await runAction(async () => {
      await garageApi("saveWorkshop", { name });
      setWorkshopName(name);
      setModal(null);
    }, "Workshop details updated");
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
  const todayKey = new Date().toISOString().slice(0, 10);
  const monthKey = todayKey.slice(0, 7);
  const todayRevenue = data.payments
    .filter((payment) => payment.paid_at.slice(0, 10) === todayKey)
    .reduce((total, payment) => total + Number(payment.amount), 0);
  const monthRevenue = data.payments
    .filter((payment) => payment.paid_at.slice(0, 7) === monthKey)
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
    if (next) setModal(next);
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
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-[#151d24] text-white transition-transform duration-200 lg:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lime text-ink">
            <Wrench size={20} strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-[17px] font-bold tracking-tight">Garage<span className="text-lime">OS</span></div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Workshop suite</div>
          </div>
        </div>
        <div className="px-4 pt-6">
          <div className="px-3 pb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Workspace
          </div>
          <nav className="space-y-1">
            {visibleNavItems.map(({ name, icon: Icon }) => (
              <button
                key={name}
                onClick={() => {
                  setPage(name);
                  setSearch("");
                  setMobileNavOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition ${
                  page === name
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span className="flex-1">{name}</span>
                {name === "Jobs" && activeJobs.length > 0 && (
                  <span className="rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-semibold text-lime">
                    {activeJobs.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="mt-auto border-t border-white/10 p-4">
          <button
            onClick={() => setModal("workshop")}
            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-white/5"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-semibold text-lime">
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
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-line bg-white/95 px-5 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            >
              <Menu size={20} />
            </button>
            <div className="hidden items-center gap-2 text-xs text-muted md:flex">
              <span>Workspace</span>
              <span className="text-slate-300">/</span>
              <span className="font-medium text-ink">{page}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="relative hidden w-[240px] sm:block">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${page.toLowerCase()}...`}
                className="h-9 w-full rounded-lg border-line bg-slate-50 pl-9 pr-3 text-xs focus:bg-white"
              />
            </label>
            <span className="hidden h-6 w-px bg-line sm:block" />
            <button
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() =>
                setTheme((current) => (current === "dark" ? "light" : "dark"))
              }
              className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-50 hover:text-ink"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              title="Notifications"
              onClick={() =>
                setToast({
                  text: lowStock.length
                    ? `${lowStock.length} part${lowStock.length === 1 ? "" : "s"} at or below minimum stock.`
                    : "You're all caught up.",
                  kind: "info",
                })
              }
              className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-50"
            >
              <Bell size={18} />
              {lowStock.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white" />}
            </button>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e8f3d9] text-[11px] font-bold text-[#55752b]">
              {initials(profile.full_name || session.user.email)}
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-5 py-7 md:px-8 md:py-9">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[25px] font-semibold tracking-tight text-ink">
                  {page === "Overview" ? `Welcome back, ${profile.full_name.split(" ")[0] || "there"}` : pageTitles[page]}
                </h1>
                {page === "Overview" && <span className="text-2xl">👋</span>}
              </div>
              <p className="mt-1.5 text-[13px] text-muted">{pageDescriptions[page]}</p>
            </div>
            {page !== "Overview" && page !== "Reports" && (
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
              canCreateJobs={canManageJobs}
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
              onNewJob={() => setModal("job")}
            />
          )}
          {page === "Jobs" && (
            <JobsPage
              jobs={filteredJobs}
              loading={dataLoading}
              canUpdate={canUpdateJobs}
              canRecordParts={canRecordParts}
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
            setCustomerToEdit(null);
            setInviteUrl("");
          }}
        >
          {modal === "customer" && (
            <form onSubmit={saveCustomer} className="space-y-4">
              <Field label="Full name" name="full_name" defaultValue={customerToEdit?.full_name} required autoFocus />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Phone number" name="phone" type="tel" defaultValue={customerToEdit?.phone} required placeholder="+254 7..." />
                <Field label="Email address" name="email" type="email" defaultValue={customerToEdit?.email || ""} />
              </div>
              <Field label="Customer notes" name="notes" as="textarea" defaultValue={customerToEdit?.notes || ""} placeholder="Anything your team should know..." />
              <ModalActions onCancel={() => { setModal(null); setCustomerToEdit(null); }} submitLabel={customerToEdit ? "Save changes" : "Save customer"} />
            </form>
          )}
          {modal === "vehicle" && (
            <form onSubmit={saveVehicle} className="space-y-4">
              <Field label="Customer" name="customer_id" as="select" required>
                <option value="">Select a customer</option>
                {data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Registration number" name="registration_number" required placeholder="KDA 123A" />
                <Field label="Make" name="make" required placeholder="Toyota" />
                <Field label="Model" name="model" required placeholder="Corolla" />
                <Field label="Manufacturing year" name="manufacturing_year" type="number" min="1900" max={new Date().getFullYear() + 1} />
                <Field label="Current mileage (km)" name="mileage" type="number" min="0" />
                <Field label="Engine type" name="engine_type" placeholder="Petrol, diesel, hybrid..." />
              </div>
              {data.customers.length === 0 && <InlineNotice>Create a customer before registering a vehicle.</InlineNotice>}
              <ModalActions onCancel={() => setModal(null)} submitLabel="Register vehicle" disabled={!data.customers.length} />
            </form>
          )}
          {modal === "appointment" && (
            <form onSubmit={saveAppointment} className="space-y-4">
              <Field label="Customer" name="customer_id" as="select" required>
                <option value="">Select a customer</option>
                {data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
              </Field>
              <Field label="Vehicle (optional)" name="vehicle_id" as="select">
                <option value="">No vehicle selected</option>
                {data.vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.registration_number} · {vehicle.make} {vehicle.model}</option>)}
              </Field>
              <Field label="Date and time" name="scheduled_at" type="datetime-local" required />
              <Field label="Reason for visit" name="reason" required placeholder="Routine service, inspection..." />
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
              <form onSubmit={inviteStaff} className="space-y-4">
                <Field label="Staff member name" name="full_name" required autoFocus />
                <Field label="Email address" name="email" type="email" required />
                <Field label="Workshop role" name="role" as="select" required>
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
            <form onSubmit={saveJob} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Customer" name="customer_id" as="select" required>
                  <option value="">Select a customer</option>
                  {data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}</option>)}
                </Field>
                <Field label="Vehicle" name="vehicle_id" as="select" required>
                  <option value="">Select a vehicle</option>
                  {data.vehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.registration_number} · {vehicle.make} {vehicle.model}
                    </option>
                  ))}
                </Field>
              </div>
              <Field label="Reported problem" name="reported_problem" as="textarea" required placeholder="Describe the issue reported by the customer..." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Estimated completion" name="estimated_completion_date" type="date" />
                <Field label="Assign mechanic" name="assigned_mechanic_id" as="select">
                  <option value="">Unassigned</option>
                  {data.staff.filter((member) => member.role === "mechanic").map((member) => (
                    <option key={member.id} value={member.id}>{member.full_name}</option>
                  ))}
                </Field>
              </div>
              {(data.customers.length === 0 || data.vehicles.length === 0) && (
                <InlineNotice>Add a customer and register their vehicle before opening a job card.</InlineNotice>
              )}
              <ModalActions onCancel={() => setModal(null)} submitLabel="Create job card" disabled={!data.customers.length || !data.vehicles.length} />
            </form>
          )}
          {modal === "part" && (
            <form onSubmit={savePart} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Part name" name="name" required />
                <Field label="SKU / part number" name="sku" required />
                <Field label="Opening quantity" name="quantity_on_hand" type="number" min="0" step="1" required />
                <Field label="Low-stock threshold" name="minimum_stock" type="number" min="0" step="1" required />
                <Field label="Purchase price (KES)" name="purchase_price" type="number" min="0" step="0.01" required />
                <Field label="Selling price (KES)" name="selling_price" type="number" min="0" step="0.01" required />
              </div>
              <ModalActions onCancel={() => setModal(null)} submitLabel="Add part" />
            </form>
          )}
          {modal === "usage" && (
            <form onSubmit={recordPartUsage} className="space-y-4">
              <Field label="Repair job" name="job_id" as="select" required>
                <option value="">Select an active job</option>
                {activeJobs.map((job) => <option key={job.id} value={job.id}>{job.job_number} · {job.vehicle?.registration_number || "Vehicle"}</option>)}
              </Field>
              <Field label="Spare part" name="part_id" as="select" required>
                <option value="">Select a part</option>
                {data.parts.map((part) => <option key={part.id} value={part.id}>{part.name} · {part.quantity_on_hand} in stock</option>)}
              </Field>
              <Field label="Quantity used" name="quantity" type="number" min="1" step="1" required />
              <InlineNotice>Stock is deducted atomically. Quantities that exceed available stock are rejected.</InlineNotice>
              <ModalActions onCancel={() => setModal(null)} submitLabel="Record part usage" disabled={!activeJobs.length || !data.parts.length} />
            </form>
          )}
          {modal === "invoice" && (
            <form onSubmit={saveInvoice} className="space-y-4">
              <Field label="Repair job" name="job_id" as="select" required>
                <option value="">Select a job</option>
                {data.jobs.map((job) => <option key={job.id} value={job.id}>{job.job_number} · {job.customer?.full_name || "Customer"}</option>)}
              </Field>
              <Field label="Invoice total (KES)" name="amount_total" type="number" min="0.01" step="0.01" required />
              <Field label="Due date" name="due_date" type="date" />
              <InlineNotice>Invoice totals are recorded in KES. Itemized quotations and tax configuration are not part of this MVP.</InlineNotice>
              <ModalActions onCancel={() => setModal(null)} submitLabel="Create invoice" disabled={!data.jobs.length} />
            </form>
          )}
          {modal === "payment" && (
            <form onSubmit={recordPayment} className="space-y-4">
              <Field label="Invoice" name="invoice_id" as="select" required>
                <option value="">Select an outstanding invoice</option>
                {data.invoices.filter((invoice) => invoice.status !== "paid").map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoice_number} · {invoice.customer?.full_name || "Customer"} · due {money(Number(invoice.amount_total) - Number(invoice.amount_paid))}
                  </option>
                ))}
              </Field>
              <Field label="Amount received (KES)" name="amount" type="number" min="0.01" step="0.01" required />
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
            <form onSubmit={saveWorkshop} className="space-y-4">
              <Field label="Workshop name" name="name" defaultValue={workshopName} required autoFocus />
              <InlineNotice>Your workshop data is isolated from other GarageOS workspaces.</InlineNotice>
              <ModalActions onCancel={() => setModal(null)} submitLabel="Save workshop" />
            </form>
          )}
        </Modal>
      )}

      {selectedInvoice && (
        <Modal title="Invoice preview" onClose={() => setSelectedInvoice(null)} print>
          <div className="print-area">
            <div className="flex items-start justify-between border-b border-line pb-5">
              <div>
                <div className="text-lg font-bold">{workshopName}</div>
                <div className="mt-1 text-xs text-muted">Repair service invoice</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wider text-muted">Invoice</div>
                <div className="mt-1 text-lg font-bold">{selectedInvoice.invoice_number}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6 py-5 text-sm">
              <div><div className="text-xs text-muted">Bill to</div><div className="mt-1 font-semibold">{selectedInvoice.customer?.full_name}</div></div>
              <div><div className="text-xs text-muted">Issued</div><div className="mt-1 font-semibold">{shortDate(selectedInvoice.created_at)}</div></div>
              <div><div className="text-xs text-muted">Job reference</div><div className="mt-1 font-semibold">{selectedInvoice.job?.job_number || "—"}</div></div>
              <div><div className="text-xs text-muted">Due date</div><div className="mt-1 font-semibold">{shortDate(selectedInvoice.due_date)}</div></div>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <div className="flex justify-between text-sm"><span>Repair services</span><span>{money(selectedInvoice.amount_total)}</span></div>
              <div className="mt-3 flex justify-between border-t border-line pt-3 font-semibold"><span>Total (KES)</span><span>{money(selectedInvoice.amount_total)}</span></div>
              <div className="mt-2 flex justify-between text-sm text-muted"><span>Paid</span><span>{money(selectedInvoice.amount_paid)}</span></div>
              <div className="mt-2 flex justify-between text-sm font-semibold"><span>Balance due</span><span>{money(Number(selectedInvoice.amount_total) - Number(selectedInvoice.amount_paid))}</span></div>
            </div>
            <div className="mt-5 text-center text-xs text-muted">Thank you for choosing {workshopName}.</div>
          </div>
          <div className="mt-6 flex justify-end gap-2 print:hidden">
            <button className="button-secondary" onClick={() => setSelectedInvoice(null)}>Close</button>
            <button className="button-primary" onClick={() => window.print()}>Print invoice</button>
          </div>
        </Modal>
      )}

      {toast && (
        <div
          role={toast.kind === "error" ? "alert" : "status"}
          className={`fixed bottom-5 right-5 z-[60] flex max-w-[calc(100vw-40px)] items-start gap-3 rounded-xl px-4 py-3 text-sm text-white shadow-xl ${
            toast.kind === "error" ? "bg-rose-700" : toast.kind === "info" ? "bg-slate-700" : "bg-[#23332a]"
          }`}
        >
          {toast.kind === "success" ? <Check size={17} className="mt-0.5 shrink-0 text-lime" /> : <Activity size={17} className="mt-0.5 shrink-0" />}
          <span>{toast.text}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast(null)} className="ml-1 shrink-0 opacity-70 hover:opacity-100"><X size={15} /></button>
        </div>
      )}
    </div>
  );
}

function buildRevenueChart(payments: Payment[], days: number) {
  const entries = new Map<string, number>();
  const date = new Date();
  date.setDate(date.getDate() - days + 1);
  date.setHours(0, 0, 0, 0);
  for (let index = 0; index < days; index += 1) {
    const key = date.toISOString().slice(0, 10);
    entries.set(key, 0);
    date.setDate(date.getDate() + 1);
  }
  payments.forEach((payment) => {
    const key = payment.paid_at.slice(0, 10);
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
  canCreateJobs,
  vehiclesInWorkshop,
  activeJobs,
  pendingApprovals,
  outstanding,
  todayRevenue,
  monthRevenue,
  lowStock,
  appointments,
  onNavigate,
  onNewJob,
}: {
  data: GarageData;
  loading: boolean;
  showFinance: boolean;
  showAppointments: boolean;
  showInventory: boolean;
  canCreateJobs: boolean;
  vehiclesInWorkshop: number;
  activeJobs: JobCard[];
  pendingApprovals: JobCard[];
  outstanding: number;
  todayRevenue: number;
  monthRevenue: number;
  lowStock: SparePart[];
  appointments: Appointment[];
  onNavigate: (page: Page) => void;
  onNewJob: () => void;
}) {
  const completedThisMonth = data.jobs.filter(
    (job) =>
      (job.status === "completed" || job.status === "collected") &&
      (job.actual_completion_date || job.date_received).slice(0, 7) ===
        new Date().toISOString().slice(0, 7),
  ).length;
  const chartData = buildRevenueChart(data.payments, 7);
  const metrics = [
    { label: "Vehicles in workshop", value: vehiclesInWorkshop, icon: CarFront, color: "bg-blue-50 text-blue-700", detail: "Currently being repaired" },
    { label: "Active repair jobs", value: activeJobs.length, icon: Wrench, color: "bg-lime-50 text-lime-800", detail: "Across all repair stages" },
    { label: "Pending approvals", value: pendingApprovals.length, icon: Clock3, color: "bg-amber-50 text-amber-700", detail: "Waiting on customer" },
    { label: "Completed this month", value: completedThisMonth, icon: Check, color: "bg-emerald-50 text-emerald-700", detail: "Completed or collected" },
    ...(showFinance ? [
      { label: "Outstanding balance", value: money(outstanding), icon: CircleDollarSign, color: "bg-rose-50 text-rose-700", detail: `${data.invoices.filter((invoice) => invoice.status !== "paid").length} open invoices` },
      { label: "Today's revenue", value: money(todayRevenue), icon: ArrowDownRight, color: "bg-emerald-50 text-emerald-700", detail: "Payments received today" },
      { label: "Monthly revenue", value: money(monthRevenue), icon: ArrowUpRight, color: "bg-blue-50 text-blue-700", detail: "Payments received this month" },
    ] : []),
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, color, detail }) => (
          <div key={label} className="card p-5">
            <div className="flex items-start justify-between">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${color}`}><Icon size={18} /></div>
              <span className="text-[11px] text-muted">{label}</span>
            </div>
            <div className="mt-4 text-[24px] font-semibold tracking-tight text-ink">{loading ? "—" : value}</div>
            <div className="mt-1 text-[11px] text-muted">{detail}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        {showFinance ? (
        <div className="card p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Workshop revenue</h2>
              <p className="mt-1 text-xs text-muted">Payments received · last 7 days</p>
            </div>
            <button onClick={() => onNavigate("Reports")} className="text-xs font-semibold text-[#607d35] hover:underline">View reports →</button>
          </div>
          <div className="mt-5 flex items-end gap-2">
            <span className="text-2xl font-semibold tracking-tight">{money(todayRevenue)}</span>
            <span className="mb-1 text-xs text-muted">today</span>
          </div>
          <div className="mt-4 h-[205px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ left: 0, right: 4, top: 8, bottom: 0 }}>
                <defs><linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#91bd4b" stopOpacity={0.25} /><stop offset="95%" stopColor="#91bd4b" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#eef0f2" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#87919b" }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#87919b" }} width={48} tickFormatter={(value: number) => value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)} />
                <Tooltip formatter={(value) => money(Number(value))} contentStyle={{ borderRadius: 10, border: "1px solid #e8ebee", fontSize: 12 }} />
                <Area type="monotone" dataKey="amount" stroke="#719a32" strokeWidth={2.5} fill="url(#revenueFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-4 text-xs">
            <span className="text-muted">Revenue this month</span>
            <span className="font-semibold">{money(monthRevenue)}</span>
          </div>
        </div>
        ) : (
          <div className="card flex min-h-[330px] items-center justify-center p-8 text-center">
            <div className="max-w-xs"><ShieldCheck size={24} className="mx-auto text-slate-400" /><h2 className="mt-3 text-sm font-semibold">Financial overview is restricted</h2><p className="mt-1.5 text-xs leading-relaxed text-muted">Revenue and payment reports are available to workshop owners, managers and accountants.</p></div>
          </div>
        )}

        <div className="card p-5 md:p-6">
          <div className="flex items-center justify-between">
            <div><h2 className="text-sm font-semibold">Upcoming appointments</h2><p className="mt-1 text-xs text-muted">Your next workshop bookings</p></div>
            <div className="rounded-lg bg-slate-50 p-2 text-slate-500"><CalendarDays size={17} /></div>
          </div>
          <div className="mt-4 divide-y divide-line">
            {appointments.slice(0, 5).map((appointment) => (
              <div key={appointment.id} className="flex items-center gap-3 py-3">
                <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-[#f3f7ed] text-[10px] font-semibold leading-tight text-[#607d35]">
                  <span>{new Date(appointment.scheduled_at).toLocaleDateString("en-KE", { day: "2-digit" })}</span>
                  <span>{new Date(appointment.scheduled_at).toLocaleDateString("en-KE", { month: "short" })}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{appointment.customer?.full_name || "Customer"}</div>
                  <div className="mt-1 truncate text-[11px] text-muted">{appointment.vehicle?.registration_number || "Vehicle"} · {appointment.reason}</div>
                </div>
                <div className="whitespace-nowrap text-[10px] text-muted">{new Date(appointment.scheduled_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            ))}
            {!showAppointments && <InlineNotice>Appointment details are restricted to the front desk and workshop managers.</InlineNotice>}
            {showAppointments && !appointments.length && !loading && <EmptyInline text="No upcoming appointments." />}
            {loading && <div className="py-8 text-center text-xs text-muted">Loading appointments…</div>}
          </div>
          <div className="mt-2 border-t border-line pt-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted">Parts at or below minimum</span>
              {showInventory
                ? <button onClick={() => onNavigate("Inventory")} className="font-semibold text-[#607d35] hover:underline">{lowStock.length} items →</button>
                : <span className="font-semibold">{lowStock.length} items</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 md:px-6">
            <div><h2 className="text-sm font-semibold">Recent repair jobs</h2><p className="mt-1 text-xs text-muted">Latest activity from the workshop floor</p></div>
            <button onClick={() => onNavigate("Jobs")} className="text-xs font-semibold text-[#607d35] hover:underline">All jobs →</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-5 py-3">Job / vehicle</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-line">
                {data.jobs.slice(0, 5).map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3.5"><div className="font-semibold">{job.job_number}</div><div className="mt-1 text-[10px] text-muted">{job.vehicle?.registration_number} · {job.vehicle?.make} {job.vehicle?.model}</div></td>
                    <td className="px-4 py-3.5 text-slate-600">{job.customer?.full_name || "—"}</td>
                    <td className="px-4 py-3.5 text-slate-500">{shortDate(job.date_received)}</td>
                    <td className="px-4 py-3.5"><StatusPill value={job.status} label={statusNames[job.status]} /></td>
                  </tr>
                ))}
                {!data.jobs.length && !loading && <tr><td colSpan={4}><EmptyInline text="No repair jobs yet. Start with a new job card." /></td></tr>}
                {loading && <tr><td colSpan={4} className="py-8 text-center text-xs text-muted">Loading workshop data…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div><h2 className="text-sm font-semibold">Recent payments</h2><p className="mt-1 text-xs text-muted">Latest received transactions</p></div>
            {showFinance && <button onClick={() => onNavigate("Invoices")} className="text-xs font-semibold text-[#607d35] hover:underline">View all →</button>}
          </div>
          {showFinance ? (
          <>
          <div className="divide-y divide-line px-5">
            {data.payments.slice(0, 5).map((payment) => (
              <div key={payment.id} className="flex items-center gap-3 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><ArrowDownRight size={17} /></div>
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{payment.invoice?.customer?.full_name || "Customer"}</div><div className="mt-1 text-[10px] capitalize text-muted">{payment.method.replace("_", " ")} · {shortDate(payment.paid_at)}</div></div>
                <div className="whitespace-nowrap text-xs font-semibold text-emerald-700">+{money(payment.amount)}</div>
              </div>
            ))}
            {!data.payments.length && !loading && <EmptyInline text="No payments recorded yet." />}
            {loading && <div className="py-8 text-center text-xs text-muted">Loading payments…</div>}
          </div>
          <div className="border-t border-line bg-slate-50/70 px-5 py-3 text-[11px]">
            <div className="flex justify-between"><span className="text-muted">Outstanding invoices</span><span className="font-semibold text-ink">{money(outstanding)}</span></div>
          </div>
          </>
          ) : (
            <div className="p-5"><InlineNotice>Payment and balance information is restricted to workshop owners, managers and accountants.</InlineNotice></div>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#dce8c9] bg-[#f4f8ed] px-5 py-4">
        <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[#67873e]"><Gauge size={18} /></div><div><div className="text-xs font-semibold">Ready to get started?</div><div className="mt-1 text-[11px] text-slate-600">Open a repair job and keep the whole team in sync.</div></div></div>
        <button onClick={onNewJob} disabled={!canCreateJobs} className="button-primary !bg-[#314329] !py-2"><Plus size={15} />New job card</button>
      </div>
    </>
  );
}

function JobsPage({
  jobs,
  loading,
  canUpdate,
  canRecordParts,
  onStatus,
  onAddUsage,
}: {
  jobs: JobCard[];
  loading: boolean;
  canUpdate: boolean;
  canRecordParts: boolean;
  onStatus: (job: JobCard, status: JobStatus) => void;
  onAddUsage: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const visible = jobs.filter((job) => filter === "all" || job.status === filter);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div><h2 className="text-sm font-semibold">Job cards <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{visible.length}</span></h2><p className="mt-1 text-xs text-muted">Repair status and assigned vehicle</p></div>
        <div className="flex items-center gap-2">
          <select aria-label="Filter jobs by status" value={filter} onChange={(event) => setFilter(event.target.value)} className="rounded-lg border-line py-2 pl-3 pr-8 text-xs">
            <option value="all">All statuses</option>
            {jobStatuses.map((status) => <option key={status} value={status}>{statusNames[status]}</option>)}
          </select>
          {canRecordParts && <button className="button-secondary !py-2 text-xs" onClick={onAddUsage}><Package size={14} />Record parts used</button>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[830px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-5 py-3">Job card</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Reported issue</th><th className="px-4 py-3">Mechanic</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Update</th></tr></thead>
          <tbody className="divide-y divide-line">
            {visible.map((job) => (
              <tr key={job.id} className="align-top hover:bg-slate-50/60">
                <td className="px-5 py-4"><div className="font-semibold">{job.job_number}</div><div className="mt-1 text-[10px] text-muted">{job.vehicle?.registration_number} · {job.vehicle?.make} {job.vehicle?.model}</div><div className="mt-1 text-[10px] text-muted">Due {shortDate(job.estimated_completion_date)}</div></td>
                <td className="px-4 py-4"><div className="font-medium">{job.customer?.full_name || "—"}</div><div className="mt-1 text-[10px] text-muted">{job.customer?.phone}</div></td>
                <td className="max-w-[200px] px-4 py-4 text-slate-600">{job.reported_problem}</td>
                <td className="px-4 py-4 text-slate-600">{job.mechanic?.full_name || "Unassigned"}</td>
                <td className="px-4 py-4"><StatusPill value={job.status} label={statusNames[job.status]} /></td>
                <td className="px-4 py-4">
                  {canUpdate ? (
                    <select aria-label={`Update ${job.job_number} status`} value={job.status} onChange={(event) => onStatus(job, event.target.value as JobStatus)} className="max-w-[145px] rounded-lg border-line py-1.5 pl-2 pr-7 text-[10px]">
                      {jobStatuses.map((status) => <option key={status} value={status}>{statusNames[status]}</option>)}
                    </select>
                  ) : <span className="text-[10px] text-muted">Read only</span>}
                </td>
              </tr>
            ))}
            {!visible.length && !loading && <tr><td colSpan={6}><EmptyState icon={ClipboardList} title="No jobs found" description="Create a job card to start tracking a repair." /></td></tr>}
            {loading && <tr><td colSpan={6} className="py-12 text-center text-xs text-muted">Loading repair jobs…</td></tr>}
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-5 py-3">Customer</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Vehicles</th><th className="px-4 py-3">Repair history</th><th className="px-4 py-3">Balance due</th><th className="px-4 py-3">Added</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-line">
            {customers.map((customer) => {
              const ownedVehicles = vehicles.filter((vehicle) => vehicle.customer_id === customer.id);
              const repairCount = jobs.filter((job) => job.customer_id === customer.id).length;
              const balance = invoices
                .filter((invoice) => invoice.customer_id === customer.id)
                .reduce((sum, invoice) => sum + Math.max(0, Number(invoice.amount_total) - Number(invoice.amount_paid)), 0);
              return (
                <tr key={customer.id} className="hover:bg-slate-50/60">
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
            {loading && <tr><td colSpan={7} className="py-12 text-center text-xs text-muted">Loading customers…</td></tr>}
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-5 py-3">Vehicle</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Year</th><th className="px-4 py-3">Mileage</th><th className="px-4 py-3">Engine</th></tr></thead>
          <tbody className="divide-y divide-line">
            {vehicles.map((vehicle) => <tr key={vehicle.id} className="hover:bg-slate-50/60"><td className="px-5 py-4"><div className="font-semibold">{vehicle.registration_number}</div><div className="mt-1 text-[10px] text-muted">{vehicle.make} {vehicle.model}</div></td><td className="px-4 py-4">{vehicle.customer?.full_name || "—"}</td><td className="px-4 py-4 text-slate-600">{vehicle.manufacturing_year || "—"}</td><td className="px-4 py-4 text-slate-600">{vehicle.mileage != null ? `${Number(vehicle.mileage).toLocaleString()} km` : "—"}</td><td className="px-4 py-4 text-slate-600">{vehicle.engine_type || "—"}</td></tr>)}
            {!vehicles.length && !loading && <tr><td colSpan={5}><EmptyState icon={CarFront} title="No vehicles registered" description="Register a customer vehicle to make it available for repair jobs." /></td></tr>}
            {loading && <tr><td colSpan={5} className="py-12 text-center text-xs text-muted">Loading vehicles…</td></tr>}
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-5 py-3">Date / time</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Vehicle</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-line">
            {appointments.map((appointment) => (
              <tr key={appointment.id} className="hover:bg-slate-50/60">
                <td className="px-5 py-3.5"><div className="font-semibold">{shortDate(appointment.scheduled_at)}</div><div className="mt-1 text-[10px] text-muted">{new Date(appointment.scheduled_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</div></td>
                <td className="px-4 py-3.5">{appointment.customer?.full_name || "—"}</td>
                <td className="px-4 py-3.5 text-slate-600">{appointment.vehicle?.registration_number || "—"}</td>
                <td className="max-w-[220px] px-4 py-3.5 text-slate-600">{appointment.reason}</td>
                <td className="px-4 py-3.5"><StatusPill value={appointment.status} label={appointment.status} /></td>
                <td className="px-4 py-3.5">{canManage && appointment.status === "scheduled" && <button onClick={() => onCancel(appointment)} className="text-[10px] font-medium text-slate-400 hover:text-rose-700">Cancel</button>}</td>
              </tr>
            ))}
            {!appointments.length && !loading && <tr><td colSpan={6}><EmptyState icon={CalendarDays} title="No appointments" description="Book a customer visit to see it in this schedule." /></td></tr>}
            {loading && <tr><td colSpan={6} className="py-12 text-center text-xs text-muted">Loading appointments…</td></tr>}
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
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#edf3e4] text-[10px] font-semibold text-[#607d35]">{initials(member.full_name)}</div>
            <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{member.full_name}</div><div className="mt-1 text-[10px] text-muted">{roleNames[member.role] || member.role}</div></div>
            {member.role === "owner" && <StatusPill value="completed" label="Owner" />}
          </div>
        ))}
        {!staff.length && !loading && <EmptyState icon={UsersRound} title="No staff profiles" description="Workshop staff will appear here after they accept their Neon Auth invitation." />}
        {loading && <div className="py-12 text-center text-xs text-muted">Loading workshop staff…</div>}
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-5 py-3">Part</th><th className="px-4 py-3">SKU</th><th className="px-4 py-3">In stock</th><th className="px-4 py-3">Min. level</th><th className="px-4 py-3">Cost</th><th className="px-4 py-3">Selling price</th><th className="px-4 py-3">Stock status</th></tr></thead>
            <tbody className="divide-y divide-line">
              {parts.map((part) => {
                const isLow = Number(part.quantity_on_hand) <= Number(part.minimum_stock);
                return <tr key={part.id} className="hover:bg-slate-50/60"><td className="px-5 py-3.5"><div className="font-semibold">{part.name}</div></td><td className="px-4 py-3.5 font-mono text-[10px] text-slate-500">{part.sku}</td><td className={`px-4 py-3.5 font-semibold ${isLow ? "text-amber-700" : ""}`}>{part.quantity_on_hand}</td><td className="px-4 py-3.5 text-slate-500">{part.minimum_stock}</td><td className="px-4 py-3.5">{money(part.purchase_price)}</td><td className="px-4 py-3.5">{money(part.selling_price)}</td><td className="px-4 py-3.5"><StatusPill value={isLow ? "awaiting_parts" : "completed"} label={isLow ? "Reorder" : "In stock"} /></td></tr>;
              })}
              {!parts.length && !loading && <tr><td colSpan={7}><EmptyState icon={Package} title="Inventory is empty" description="Add spare parts to track quantities, prices and stock alerts." /></td></tr>}
              {loading && <tr><td colSpan={7} className="py-12 text-center text-xs text-muted">Loading inventory…</td></tr>}
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-5 py-3">Invoice</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Job</th><th className="px-4 py-3">Issued</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {invoices.map((invoice) => <tr key={invoice.id} className="hover:bg-slate-50/60"><td className="px-5 py-3.5 font-semibold">{invoice.invoice_number}</td><td className="px-4 py-3.5">{invoice.customer?.full_name || "—"}</td><td className="px-4 py-3.5 text-slate-500">{invoice.job?.job_number || "—"}</td><td className="px-4 py-3.5 text-slate-500">{shortDate(invoice.created_at)}</td><td className="px-4 py-3.5 font-medium">{money(invoice.amount_total)}</td><td className="px-4 py-3.5">{money(Number(invoice.amount_total) - Number(invoice.amount_paid))}</td><td className="px-4 py-3.5"><StatusPill value={invoice.status} label={invoice.status.replace("_", " ")} /></td><td className="px-4 py-3.5"><button onClick={() => onPreview(invoice)} className="text-[10px] font-semibold text-[#607d35] hover:underline">Print</button></td></tr>)}
              {!invoices.length && !loading && <tr><td colSpan={8}><EmptyState icon={CircleDollarSign} title="No invoices yet" description="Create an invoice from a repair job when work is ready to bill." /></td></tr>}
              {loading && <tr><td colSpan={8} className="py-12 text-center text-xs text-muted">Loading invoices…</td></tr>}
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
    anchor.download = `garageos-payments-${new Date().toISOString().slice(0, 10)}.csv`;
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
              return <div key={status}><div className="mb-1.5 flex justify-between text-[11px]"><span className="text-slate-600">{statusNames[status]}</span><span className="font-semibold">{count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#9cbe65]" style={{ width: `${percent}%` }} /></div></div>;
            })}
          </div>
          <div className="mt-5 border-t border-line pt-4 text-xs"><div className="flex justify-between"><span className="text-muted">Labour / parts breakdown</span><span className="text-slate-500">Not itemized yet</span></div><p className="mt-2 leading-relaxed text-[10px] text-muted">Detailed profit and mechanic reports depend on itemized quotations and staff time entries, which are planned for a later stage.</p></div>
        </div>
      </div>
      <div className="mt-4 card overflow-hidden">
        <div className="border-b border-line px-5 py-4"><h2 className="text-sm font-semibold">Payments in selected period</h2><p className="mt-1 text-xs text-muted">{reportPayments.length} recorded transactions</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-muted"><tr><th className="px-5 py-3">Date</th><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Method</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-line">{reportPayments.slice(0, 100).map((payment) => <tr key={payment.id}><td className="px-5 py-3">{shortDate(payment.paid_at)}</td><td className="px-4 py-3">{payment.invoice?.invoice_number || "—"}</td><td className="px-4 py-3">{payment.invoice?.customer?.full_name || "—"}</td><td className="px-4 py-3 capitalize">{payment.method.replace("_", " ")}</td><td className="px-4 py-3 text-slate-500">{payment.reference || "—"}</td><td className="px-4 py-3 text-right font-semibold">{money(payment.amount)}</td></tr>)}{!reportPayments.length && <tr><td colSpan={6}><EmptyInline text="No payments in this date range." /></td></tr>}</tbody></table></div>
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
  return <div className="card flex items-center gap-3.5 p-4"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone === "warning" ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-600"}`}><Icon size={17} /></div><div className="min-w-0"><div className="truncate text-[10px] text-muted">{label}</div><div className="mt-1 truncate text-sm font-semibold">{value}</div></div></div>;
}

function StatusPill({ value, label }: { value: string; label: string }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[9px] font-semibold capitalize ${statusClass(value)}`}>{label}</span>;
}

function EmptyInline({ text }: { text: string }) {
  return <div className="py-7 text-center text-xs text-muted">{text}</div>;
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
  return <div className="flex flex-col items-center px-5 py-14 text-center"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-400"><Icon size={20} /></div><h3 className="mt-3 text-sm font-semibold">{title}</h3><p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">{description}</p></div>;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl md:p-6 ${print ? "print-modal" : ""}`}>
        <div className="mb-5 flex items-center justify-between">
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
  ...props
}: {
  label: string;
  name: string;
  as?: "input" | "textarea" | "select";
  children?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement> & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const inputProps = props as React.InputHTMLAttributes<HTMLInputElement>;
  const textareaProps = props as React.TextareaHTMLAttributes<HTMLTextAreaElement>;
  const selectProps = props as React.SelectHTMLAttributes<HTMLSelectElement>;
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}{props.required && <span className="ml-0.5 text-rose-600">*</span>}
      {as === "textarea" ? (
        <textarea name={name} rows={3} className="field resize-y" {...textareaProps} />
      ) : as === "select" ? (
        <select name={name} className="field" {...selectProps}>{children}</select>
      ) : (
        <input name={name} className="field" {...inputProps} />
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
    <div className="flex min-h-screen items-center justify-center bg-[#151d24] px-5 py-10">
      <div className="w-full max-w-lg rounded-2xl bg-white p-7 shadow-2xl md:p-9">
        <div className="mb-6 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-ink"><Wrench size={21} /></div><div><div className="text-lg font-bold">Garage<span className="text-[#66863b]">OS</span></div><div className="text-[10px] uppercase tracking-[0.16em] text-muted">Workshop suite</div></div></div>
        <h1 className="text-xl font-semibold">Connect your workshop</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">Connect your Neon Auth branch and server-side Postgres API to enable secure sign-in and live workshop data.</p>
        <div className="mt-5 rounded-xl bg-slate-50 p-4">
          <div className="text-xs font-semibold">1. Configure your environment</div>
          <code className="mt-2 block whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600">Keep DATABASE_URL server-only. Set VITE_NEON_AUTH_URL from NEON_AUTH_BASE_URL.</code>
          <div className="mt-4 text-xs font-semibold">2. Set up the database</div>
          <code className="mt-2 block text-[11px] leading-relaxed text-slate-600">Apply the tracked schema with npm run db:migrate (uses DATABASE_URL_UNPOOLED).</code>
          <div className="mt-4 text-xs font-semibold">3. Start GarageOS</div>
          <code className="mt-2 block text-[11px] leading-relaxed text-slate-600">npm install && npm run dev</code>
        </div>
        <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-muted"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#65833b]" />Database credentials stay on the server. Neon Auth tokens are verified by the API, with workshop-scoped PostgreSQL Row Level Security.</p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center bg-canvas"><div className="flex items-center gap-3 text-sm text-muted"><span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-[#799b42]" />Loading your workshop…</div></div>;
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
      <div className="relative hidden overflow-hidden bg-[#151d24] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-36 -top-32 h-[500px] w-[500px] rounded-full border border-white/[0.06]" />
        <div className="absolute -right-16 -top-12 h-[340px] w-[340px] rounded-full border border-white/[0.06]" />
        <div className="relative flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-ink"><Wrench size={21} /></div><div><div className="text-lg font-bold">Garage<span className="text-lime">OS</span></div><div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Workshop suite</div></div></div>
        <div className="relative max-w-lg pb-8">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-medium text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-lime" />A clearer view of your workshop</div>
          <h1 className="text-[40px] font-semibold leading-[1.16] tracking-tight">Great work deserves a <span className="text-lime">better workflow.</span></h1>
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
          <div className="mb-8 flex items-center gap-3 lg:hidden"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-ink"><Wrench size={21} /></div><div><div className="text-lg font-bold">Garage<span className="text-[#66863b]">OS</span></div><div className="text-[10px] uppercase tracking-[0.16em] text-muted">Workshop suite</div></div></div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#66863b]">{verificationPending ? "Email verification" : mode === "sign_in" ? "Welcome back" : "Get started"}</div>
          <h2 className="mt-2 text-[27px] font-semibold tracking-tight">{verificationPending ? "Verify your email" : mode === "sign_in" ? "Sign in to your account" : "Create your workshop account"}</h2>
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
          {!verificationPending && <div className="mt-6 text-center text-xs text-muted">{mode === "sign_in" ? "New to GarageOS?" : "Already have an account?"}{" "}<button className="font-semibold text-[#607d35] hover:underline" onClick={() => setMode(mode === "sign_in" ? "sign_up" : "sign_in")}>{mode === "sign_in" ? "Create an account" : "Sign in"}</button></div>}
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
