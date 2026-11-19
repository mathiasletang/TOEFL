import { useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Link, useRouter } from "../lib/router";
import { ErrorBox, Notice } from "./ui";

type Launch =
  | { kind: "drill"; exercise_id: string; mode: "strict" | "practice"; origin: "focus" | null }
  | { kind: "simulation"; scope: string; length: "full" | "short" }
  | { kind: "vocab" }
  | { kind: "shadowing" }
  | null;
interface Block {
  id: "vocab" | "shadowing" | "main" | "optional";
  label: string;
  detail?: string;
  task?: string;
  items?: number;
  mode?: "strict" | "practice";
  minutes?: { work: number | null; correction: number; total: number | null };
  correction?: { kind: string; label: string; instruction: string; minutes: number; review_path: string | null } | null;
  diagnostic?: { note: string; replaces: string } | null;
  progress?: number | null;
  launch: Launch;
  done: boolean;
}
interface Week {
  from: string;
  to: string;
  total_minutes: number;
  by_section: Record<string, number>;
  categories: Array<{ id: string; label: string; minutes: number; share: number | null; target: number }>;
  tolerance: number;
}
interface Plan {
  date: string;
  status: "no_exam_date" | "exam_day" | "past" | "active";
  exam_date: string | null;
  target_band: number;
  days_left: number | null;
  streak: number;
  phase: { id: string; label: string; goal: string; from_days: number | null; to_days: number } | null;
  blocks: Block[];
  optional?: Block | null;
  checkpoint: { days_before: number; label: string; task: string; date: string; in_days: number } | null;
  base_done?: boolean;
  week: Week;
}

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)} %`);

export function DailyPlan({ user }: { user: string }) {
  const { data, error, setData } = useApi<Plan>(`/api/users/${user}/plan`);
  const { navigate } = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const toggle = async (b: Block) => {
    setBusy(b.id);
    // Optimistic update: the box changes at once; the server answer then replaces the whole plan (streak included).
    const flip = (x: Block) => (x.id === b.id ? { ...x, done: !b.done } : x);
    setData({ ...data, blocks: data.blocks.map(flip), optional: data.optional ? flip(data.optional) : data.optional });
    try {
      setData(await api.put<Plan>(`/api/users/${user}/plan/checks`, { date: data.date, block: b.id, done: !b.done }));
    } catch {
      setData(data);
    } finally {
      setBusy(null);
    }
  };
  const launch = async (l: Launch) => {
    setLaunchError(null);
    if (!l) return;
    if (l.kind === "vocab") return navigate(`/u/${user}/vocab/session`);
    if (l.kind === "shadowing") return navigate(`/u/${user}/shadowing`);
    if (l.kind === "drill") return navigate(`/u/${user}/drill/${l.exercise_id}?mode=${l.mode}${l.origin === "focus" ? "&from=focus" : ""}`);
    try {
      const v = await api.post<{ simulation: { id: string } }>("/api/simulations", { userId: user, scope: l.scope, length: l.length });
      navigate(`/u/${user}/sim/${v.simulation.id}`);
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Could not start the simulation");
    }
  };

  if (data.status !== "active") {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <div className="label">Today's plan</div>
          <p className="mt-1 text-sm text-muted">
            {data.status === "no_exam_date"
              ? "Set your exam date to get a daily plan built backwards from it."
              : data.status === "exam_day"
                ? "Exam day. No training today — good luck."
                : `Your exam date (${data.exam_date}) has passed. Set the next one to restart the plan.`}
          </p>
        </div>
        {data.status !== "exam_day" && (
          <Link to={`/u/${user}/settings`} className="btn">
            Set exam date
          </Link>
        )}
      </div>
    );
  }

  const row = (b: Block, primary: boolean) => {
    const sim = b.launch?.kind === "simulation";
    const button = b.launch ? (b.launch.kind === "vocab" ? "Open session" : sim ? "Start simulation" : b.id === "shadowing" ? "Start" : "Start drill") : null;
    return (
      <li key={b.id} className="py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="-m-2.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-pill">
            <input type="checkbox" className="h-5 w-5 cursor-pointer" checked={b.done} disabled={busy != null} onChange={() => toggle(b)} aria-label={`Mark “${b.label}” as done`} />
          </label>
          <div className={`min-w-0 flex-1 ${b.done ? "text-dim line-through" : ""}`}>
            <div className="text-sm font-medium">
              {b.label}
              {b.items != null && !sim && <span className="font-normal text-dim"> · {b.items} {b.items === 1 ? "exercise" : "exercises"}</span>}
              {b.mode && <span className={`chip ml-2 ${b.mode === "strict" ? "border-accent bg-accent text-on-accent" : ""}`}>{b.mode}</span>}
              {b.minutes?.total != null && <span className="ml-2 text-xs font-normal text-dim">≈ {b.minutes.total} min</span>}
            </div>
            <div className="text-xs text-dim">
              {b.detail}
              {b.progress != null && b.items != null && `${b.progress}/${b.items} done today`}
            </div>
          </div>
          {button && (
            <button className={`btn py-1.5 text-xs ${primary && !b.done ? "btn-primary" : ""}`} onClick={() => launch(b.launch)}>
              {button}
            </button>
          )}
          {!b.launch && <span className="text-xs text-dim">no exercise available</span>}
        </div>
        {b.diagnostic && (
          <div className="ml-7 mt-2">
            <Notice tone="warn">
              {b.diagnostic.note} Today's planned block ({b.diagnostic.replaces}) starts once it is done.
            </Notice>
          </div>
        )}
        {b.correction && (
          <ol className="ml-7 mt-2 space-y-1 border-l-2 border-line pl-3 text-xs text-muted">
            <li>
              <span className="font-medium text-text">1. Exercises</span> — ≈ {b.minutes?.work ?? "?"} min
            </li>
            <li>
              <span className="font-medium text-text">
                2. {b.correction.label}
              </span>{" "}
              — {b.correction.minutes} min. {b.correction.instruction}{" "}
              {b.correction.review_path ? (
                <Link to={`/u/${user}/${b.correction.review_path}`} className="font-bold text-text underline underline-offset-4">
                  Open today's correction
                </Link>
              ) : (
                <span className="text-dim">(the link appears after your first exercise)</span>
              )}
            </li>
          </ol>
        )}
      </li>
    );
  };

  const cp = data.checkpoint;
  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label">Today's plan · {fmtDate(data.date)}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
            <span className="text-lg font-semibold">{data.phase!.label}</span>
            <span className="text-sm text-muted">
              J-{data.days_left} · exam {fmtDate(data.exam_date!)}
            </span>
          </div>
          <div className="text-xs text-dim">{data.phase!.goal}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{data.streak}</div>
          <div className="text-xs text-dim">day{data.streak === 1 ? "" : "s"} in a row</div>
        </div>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-[1fr_300px]">
        <div>
          <div className="label">Daily base {data.base_done && <span className="ml-1 normal-case text-ok">· done</span>}</div>
          <ul className="divide-y divide-line">{data.blocks.map((b) => row(b, b.id === "main"))}</ul>
          {data.optional && (
            <>
              <div className="label mt-3">Optional</div>
              <ul>{row(data.optional, false)}</ul>
            </>
          )}
          {launchError && <p className="mt-2 text-sm text-bad">{launchError}</p>}
        </div>
        <div className="space-y-3">
          <div className="rounded-btn border border-line bg-pill p-3 text-[13px]">
            <div className="label">Next checkpoint</div>
            {cp ? (
              <>
                <div className="mt-1 font-medium">{cp.label}</div>
                <div className="text-muted">
                  {cp.in_days === 0 ? "Today" : `In ${cp.in_days} day${cp.in_days === 1 ? "" : "s"}`} · {fmtDate(cp.date)} (J-{cp.days_before})
                </div>
                {cp.in_days === 0 && (
                  <button className="btn btn-primary mt-2 py-1.5 text-xs" onClick={() => launch(cpLaunch(cp.task))}>
                    Start now
                  </button>
                )}
              </>
            ) : (
              <div className="mt-1 text-dim">No checkpoint left before the exam.</div>
            )}
          </div>
          <WeekMix week={data.week} />
          <p className="text-xs text-dim">Internal training schedule (config → internal.plan), not an ETS recommendation.</p>
        </div>
      </div>
    </div>
  );
}

/** Real share of practice time over the last 7 days, compared with the plan's weekly targets. */
function WeekMix({ week }: { week: Week }) {
  return (
    <div className="rounded-btn border border-line p-3 text-[13px]">
      <div className="label">Last 7 days vs plan</div>
      {week.total_minutes === 0 ? (
        <p className="mt-1 text-dim">No practice recorded since {fmtDate(week.from)}.</p>
      ) : (
        <>
          <div className="mt-1 text-xs text-dim">{week.total_minutes} min of exercises since {fmtDate(week.from)}</div>
          <ul className="mt-2 space-y-2">
            {week.categories.map((c) => {
              const off = c.share != null && Math.abs(c.share - c.target) > week.tolerance;
              return (
                <li key={c.id}>
                  <div className="flex justify-between gap-2">
                    <span>{c.label}</span>
                    <span className={`whitespace-nowrap tabular-nums ${off ? "font-extrabold text-text" : "text-muted"}`}>
                      {off && <span className="mr-1 text-[11px] uppercase tracking-wide">off target ·</span>}
                      {pct(c.share)} <span className="text-dim">/ {pct(c.target)}</span>
                    </span>
                  </div>
                  <div className="relative mt-1.5 h-2 rounded-full bg-line" aria-hidden>
                    <div className={`h-full rounded-full ${off ? "bg-muted" : "bg-accent"}`} style={{ width: `${Math.min(100, (c.share ?? 0) * 100)}%` }} />
                    <div className="absolute -top-1 h-4 w-1 rounded-full border border-bg bg-text" style={{ left: `${c.target * 100}%` }} title={`Target ${pct(c.target)}`} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-dim">
            Reading {week.by_section.reading} min · Listening {week.by_section.listening} min. Drills opened from Focus weaknesses count as focus. The tall mark is the target.
          </p>
        </>
      )}
    </div>
  );
}

function cpLaunch(task: string): Launch {
  const m = /^simulation:(\w+)(?::(full|short))?$/.exec(task);
  return m ? { kind: "simulation", scope: m[1]!, length: (m[2] as "short" | undefined) ?? "full" } : null;
}
