import {
  AlarmClockOff,
  BellRing,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  History,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  answerQuery,
  type ActivityEvent,
  type ActivityKind,
  type AssistantAction,
  type AssistantPermissions,
  type Reminder,
} from "../lib/assistant";
import type { GarageData, Invoice, Page } from "../lib/types";

export type AssistantTab = "chat" | "reminders" | "activity";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions?: AssistantAction[];
};

const kindMeta: Record<ActivityKind, { icon: typeof Plus; className: string }> = {
  create: { icon: Plus, className: "bg-emerald-50 text-emerald-700" },
  update: { icon: Pencil, className: "bg-blue-50 text-blue-700" },
  delete: { icon: Trash2, className: "bg-rose-50 text-rose-700" },
  payment: { icon: CircleDollarSign, className: "bg-lime-50 text-lime-800" },
  status: { icon: RefreshCw, className: "bg-amber-50 text-amber-700" },
  system: { icon: Info, className: "bg-slate-100 text-slate-600" },
};

const severityMeta = {
  urgent: {
    icon: CircleAlert,
    label: "Urgent",
    card: "border-[#fecdd3] bg-[#fff1f2]",
    chip: "bg-[#ffe4e6] text-[#be123c]",
    iconWrap: "bg-[#ffe4e6] text-[#be123c]",
  },
  warning: {
    icon: TriangleAlert,
    label: "Soon",
    card: "border-[#fde68a] bg-[#fffbeb]",
    chip: "bg-[#fef3c7] text-[#b45309]",
    iconWrap: "bg-[#fef3c7] text-[#b45309]",
  },
  info: {
    icon: Info,
    label: "Note",
    card: "border-[#d9ded4] bg-[#f3f5f0]",
    chip: "bg-[#e9ece6] text-[#5b665f]",
    iconWrap: "bg-[#eef3e5] text-[#587530]",
  },
} as const;

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

let messageSeq = 0;
function nextId() {
  messageSeq += 1;
  return `msg-${Date.now()}-${messageSeq}`;
}

export default function AssistantPanel({
  open,
  tab,
  setTab,
  onClose,
  data,
  activity,
  reminders,
  workshopName,
  userName,
  permissions,
  onNavigate,
  onOpenInvoice,
  onSnooze,
  onClearActivity,
}: {
  open: boolean;
  tab: AssistantTab;
  setTab: (tab: AssistantTab) => void;
  onClose: () => void;
  data: GarageData;
  activity: ActivityEvent[];
  reminders: Reminder[];
  workshopName: string;
  userName: string;
  permissions: AssistantPermissions;
  onNavigate: (page: Page, search?: string) => void;
  onOpenInvoice: (invoice: Invoice) => void;
  onSnooze: (reminderId: string) => void;
  onClearActivity: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: nextId(),
      role: "assistant",
      text: `Hi ${userName.split(" ")[0] || "there"} — I'm your workshop assistant. I log every action as it happens and watch deadlines, stock and payments so nothing slips. Ask me anything, or tap a shortcut below.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const latest = useRef({ data, activity, permissions });
  latest.current = { data, activity, permissions };

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, typing, tab]);

  useEffect(() => {
    if (open && tab === "chat") inputRef.current?.focus();
  }, [open, tab]);

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || typing) return;
    setInput("");
    setMessages((current) => [...current, { id: nextId(), role: "user", text }]);
    setTyping(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const { data: liveData, activity: liveActivity, permissions: livePerms } = latest.current;
      const reply = answerQuery(text, liveData, livePerms, liveActivity);
      setMessages((current) => [
        ...current,
        { id: nextId(), role: "assistant", text: reply.text, actions: reply.actions },
      ]);
      setTyping(false);
    }, 420 + Math.random() * 320);
  };

  const runAction = (action: AssistantAction) => {
    if (action.query) {
      setTab("chat");
      send(action.query);
      return;
    }
    if (action.tab) {
      setTab(action.tab);
      return;
    }
    if (action.invoiceId) {
      const invoice = latest.current.data.invoices.find(
        (item) => item.id === action.invoiceId,
      );
      if (invoice) onOpenInvoice(invoice);
      return;
    }
    if (action.page) onNavigate(action.page, action.search);
  };

  const urgentCount = reminders.filter((r) => r.severity === "urgent").length;
  const chips = [
    "What needs attention?",
    "Today's revenue",
    "Overdue jobs",
    "Low stock",
    "Appointments today",
  ];

  return (
    <>
      {open && (
        <button
          aria-label="Close assistant"
          onClick={onClose}
          className="fixed inset-0 z-[44] bg-slate-950/30 backdrop-blur-[1px] lg:hidden"
        />
      )}
      <aside
        inert={!open}
        aria-label="Workshop assistant"
        className={`fixed inset-y-0 right-0 z-[45] flex w-full max-w-[400px] flex-col border-l border-line bg-surface shadow-float transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="hero-panel relative overflow-hidden px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-lime text-ink shadow-[0_8px_20px_-8px_rgba(197,244,103,0.7)]">
                <Sparkles size={19} strokeWidth={2.2} />
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#1a2530]" />
              </div>
              <div>
                <div className="font-display text-[15px] font-extrabold tracking-tight text-white">
                  GarageOS Assistant
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-white/55">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime" />
                  Monitoring {workshopName || "your workshop"}
                </div>
              </div>
            </div>
            <button
              aria-label="Close assistant"
              onClick={onClose}
              className="rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <X size={17} />
            </button>
          </div>
          <div className="mt-4 flex gap-1 rounded-xl bg-white/[0.06] p-1 ring-1 ring-inset ring-white/10">
            {(
              [
                { key: "chat", label: "Chat", icon: Sparkles },
                { key: "reminders", label: "Reminders", icon: BellRing },
                { key: "activity", label: "Activity", icon: History },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition ${
                  tab === key
                    ? "bg-lime text-ink shadow-sm"
                    : "text-white/60 hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <Icon size={13} />
                {label}
                {key === "reminders" && reminders.length > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-px text-[9px] font-bold ${
                      tab === key
                        ? "bg-ink/15 text-ink"
                        : urgentCount
                          ? "bg-rose-500/80 text-white"
                          : "bg-white/15 text-white"
                    }`}
                  >
                    {reminders.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {tab === "chat" && (
          <>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`assistant-msg flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      message.role === "user"
                        ? "rounded-br-md bg-[var(--color-primary)] text-[var(--color-primary-contrast)]"
                        : "rounded-tl-md border border-line-soft bg-surface-muted text-ink"
                    }`}
                  >
                    {message.text.split("\n").map((line, index) => (
                      <p key={index} className={index > 0 ? "mt-1.5" : ""}>
                        {line}
                      </p>
                    ))}
                    {message.actions && message.actions.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {message.actions.map((action, index) => (
                          <button
                            key={`${action.label}-${index}`}
                            onClick={() => runAction(action)}
                            className="inline-flex items-center gap-1 rounded-full border border-accent-line bg-accent-soft px-2.5 py-1 text-[10px] font-semibold text-accent transition hover:brightness-95"
                          >
                            {action.label}
                            <ChevronRight size={11} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {typing && (
                <div className="assistant-msg flex justify-start">
                  <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-line-soft bg-surface-muted px-4 py-3">
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent"
                        style={{ animationDelay: `${dot * 140}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-line-soft px-4 pb-4 pt-3">
              <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1">
                {chips.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => send(chip)}
                    disabled={typing}
                    className="shrink-0 whitespace-nowrap rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-medium text-muted transition hover:border-accent-line hover:bg-accent-soft hover:text-accent disabled:opacity-50"
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  send(input);
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Ask about jobs, stock, payments…"
                  aria-label="Message the assistant"
                  className="h-10 min-w-0 flex-1 rounded-xl border-line bg-surface-muted px-3.5 text-xs focus:border-lime focus:bg-surface"
                />
                <button
                  type="submit"
                  aria-label="Send message"
                  disabled={!input.trim() || typing}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-primary)] text-[var(--color-primary-contrast)] transition hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send size={15} />
                </button>
              </form>
            </div>
          </>
        )}

        {tab === "reminders" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {reminders.length ? (
              <div className="space-y-2.5">
                <p className="px-0.5 text-[10px] leading-relaxed text-muted">
                  Live checks across jobs, stock, invoices and appointments.
                  Snoozed items return after 12 hours; resolved ones disappear on their own.
                </p>
                {reminders.map((reminder) => {
                  const meta = severityMeta[reminder.severity];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={reminder.id}
                      className={`assistant-msg rounded-xl border p-3.5 ${meta.card}`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${meta.iconWrap}`}>
                          <Icon size={14} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.08em] ${meta.chip}`}>
                              {meta.label}
                            </span>
                          </div>
                          <div className="mt-1 text-xs font-semibold leading-snug text-[#1d2624]">
                            {reminder.title}
                          </div>
                          <p className="mt-1 text-[10px] leading-relaxed text-[#5b665f]">
                            {reminder.detail}
                          </p>
                          <div className="mt-2.5 flex gap-1.5">
                            <button
                              onClick={() => onNavigate(reminder.page, reminder.search)}
                              className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-primary)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--color-primary-contrast)] transition hover:bg-[var(--color-primary-hover)]"
                            >
                              View
                              <ChevronRight size={11} />
                            </button>
                            <button
                              onClick={() => onSnooze(reminder.id)}
                              title="Hide for 12 hours"
                              className="inline-flex items-center gap-1 rounded-lg border border-[#d9ded4] bg-[#fafbf8] px-2.5 py-1.5 text-[10px] font-semibold text-[#5b665f] transition hover:text-[#1d2624]"
                            >
                              <AlarmClockOff size={11} />
                              Snooze
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-600/10">
                  <BellRing size={20} />
                </div>
                <div className="mt-3.5 text-sm font-semibold">All caught up</div>
                <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-muted">
                  No overdue jobs, stock alerts or unpaid invoices. I'll raise a reminder here the moment something needs attention.
                </p>
              </div>
            )}
          </div>
        )}

        {tab === "activity" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mb-3 flex items-center justify-between px-0.5">
              <p className="text-[10px] text-muted">
                {activity.length} action{activity.length === 1 ? "" : "s"} monitored
              </p>
              {activity.length > 0 && (
                <button
                  onClick={onClearActivity}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-muted transition hover:bg-rose-50 hover:text-rose-700"
                >
                  <Trash2 size={11} />
                  Clear log
                </button>
              )}
            </div>
            {activity.length ? (
              <ol className="relative space-y-0.5 border-l border-line-soft pl-4">
                {activity.map((event) => {
                  const meta = kindMeta[event.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={event.id} className="assistant-msg relative pb-3">
                      <span className={`absolute -left-[25px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-surface ${meta.className}`}>
                        <Icon size={10} />
                      </span>
                      <div className="rounded-lg px-2 py-1 transition hover:bg-surface-muted">
                        <div className="text-[11px] font-semibold leading-snug text-ink">
                          {event.label}
                        </div>
                        {event.detail && (
                          <div className="mt-0.5 text-[10px] leading-relaxed text-muted">
                            {event.detail}
                          </div>
                        )}
                        <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.06em] text-slate-400">
                          {event.actor} · {relativeTime(event.at)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent ring-1 ring-inset ring-line-soft">
                  <History size={20} />
                </div>
                <div className="mt-3.5 text-sm font-semibold">Nothing logged yet</div>
                <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-muted">
                  Every job, customer, part, invoice and payment change is recorded here automatically as your team works.
                </p>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}