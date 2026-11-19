import type { ReactNode } from "react";
import { formatClock } from "../lib/timer";
import { IconAlert, IconCheck, IconInfo } from "./icons";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-dim" role="status">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ring border-t-text" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-tile border border-bad/40 bg-bad-soft px-4 py-3 text-sm font-semibold text-bad" role="alert">
      <IconAlert />
      <span className="min-w-0 flex-1">{msg}</span>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) {
  // Black and white: a warning is told apart by its icon, its weight and a stronger border; "ok" is green with a check.
  const cls = tone === "warn" ? "border-ring bg-pill text-text font-semibold" : tone === "ok" ? "border-ok/40 bg-ok-soft text-ok font-semibold" : "border-line bg-pill text-muted";
  const Icon = tone === "warn" ? IconAlert : tone === "ok" ? IconCheck : IconInfo;
  return (
    <div className={`flex gap-2.5 rounded-tile border px-4 py-3 text-[13px] leading-relaxed ${cls}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function TimerBadge({ remaining, total, label }: { remaining: number | null; total?: number | null; label?: string }) {
  const low = remaining != null && remaining <= 30000;
  const frac = remaining != null && total ? Math.max(0, Math.min(1, remaining / total)) : null;
  return (
    <div className="flex items-center gap-3" aria-live="off">
      {label && <span className="label">{label}</span>}
      <div className={`flex min-w-[72px] items-center justify-center gap-1.5 rounded-full px-3 py-1 text-center text-lg font-extrabold tabular-nums ${low ? "bg-bad-soft text-bad" : "bg-pill text-text"}`} role="timer">
        {low && <IconAlert size={15} title="Less than 30 seconds left" />}
        {formatClock(remaining)}
      </div>
      {frac != null && (
        <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-line sm:block">
          <div className={`h-full rounded-full ${low ? "bg-bad" : "bg-accent"}`} style={{ width: `${frac * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function ConfidenceTag({ c }: { c: string }) {
  const map: Record<string, string> = { insufficient: "text-dim", low: "text-text", medium: "text-muted" };
  return <span className={`text-[11px] font-bold ${map[c] ?? ""}`}>{c === "insufficient" ? "not enough data" : `${c} confidence`}</span>;
}

export function Bar({ value, max = 1, tone = "dark" }: { value: number | null; max?: number; tone?: "dark" | "ok" | "warn" | "bad" }) {
  // The value is always printed next to the bar; the tone only reinforces it.
  const color = { dark: "bg-accent", ok: "bg-ok", warn: "bg-muted", bad: "bg-bad" }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line">
      {value != null && <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-text">{title}</h1>
        {sub && <div className="mt-1 text-sm text-dim">{sub}</div>}
      </div>
      {right}
    </div>
  );
}
