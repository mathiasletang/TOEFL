import type { ReactNode } from "react";
import { formatClock } from "../lib/timer";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-zinc-500" role="status">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      {msg}
      {onRetry && (
        <button className="btn ml-3 py-1" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) {
  const cls =
    tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : tone === "ok" ? "border-green-200 bg-green-50 text-green-900" : "border-zinc-200 bg-zinc-50 text-zinc-700";
  return <div className={`rounded-md border px-3 py-2 text-[13px] leading-relaxed ${cls}`}>{children}</div>;
}

export function TimerBadge({ remaining, total, label }: { remaining: number | null; total?: number | null; label?: string }) {
  const low = remaining != null && remaining <= 30000;
  const frac = remaining != null && total ? Math.max(0, Math.min(1, remaining / total)) : null;
  return (
    <div className="flex items-center gap-3" aria-live="off">
      {label && <span className="label">{label}</span>}
      <div className={`min-w-[64px] rounded-md px-2 py-1 text-center font-mono text-lg font-semibold tabular-nums ${low ? "bg-red-50 text-red-700" : "bg-zinc-100 text-zinc-800"}`} role="timer">
        {formatClock(remaining)}
      </div>
      {frac != null && (
        <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-zinc-200 sm:block">
          <div className={`h-full ${low ? "bg-red-500" : "bg-zinc-700"}`} style={{ width: `${frac * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function ConfidenceTag({ c }: { c: string }) {
  const map: Record<string, string> = { insufficient: "text-zinc-400", low: "text-amber-700", medium: "text-zinc-600" };
  return <span className={`text-[11px] font-medium ${map[c] ?? ""}`}>{c === "insufficient" ? "not enough data" : `${c} confidence`}</span>;
}

export function Bar({ value, max = 1, tone = "dark" }: { value: number | null; max?: number; tone?: "dark" | "ok" | "warn" | "bad" }) {
  const color = { dark: "bg-zinc-700", ok: "bg-green-600", warn: "bg-amber-500", bad: "bg-red-500" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
      {value != null && <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function PageTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {sub && <div className="mt-1 text-sm text-zinc-500">{sub}</div>}
      </div>
      {right}
    </div>
  );
}
