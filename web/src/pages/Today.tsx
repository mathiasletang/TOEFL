import { useState, type ReactNode } from "react";
import { useApi } from "../lib/useApi";
import { api } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { band, SECTION_ORDER, SECTION_LABEL } from "../lib/format";
import { Spinner, ErrorBox, Notice, ConfidenceTag } from "../components/ui";
import { IconCheck, IconLock, IconPlus } from "../components/icons";
import { inflectionsOf } from "../../../shared/vocab";
import { OfficialScoreForm } from "../components/OfficialScoreForm";
import { SectionBoundary } from "../components/SectionBoundary";
import { addDays, dayLabel, daysFrom, launchBlock, sessionSteps, setStepDone, type OfficialScore, type Plan, type PlanBlock, type ProjectionView } from "../lib/today";

interface DashboardData {
  projection: ProjectionView;
  last_full_simulation: { id: string } | null;
  active_simulation: { id: string; scope: string; length: string } | null;
  active_drill: { session?: { exercise_id: string; mode: string } } | { expired_attempt_id: string } | null;
}
interface TriageData {
  remaining: number;
  entries: Array<{ id: string; headword: string; pos: string; cefr: string; tier: string; definition: string; translation_fr: string; example: string }>;
}

const greeting = (h: number) => (h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");

export function Today({ user }: { user: string }) {
  const plan = useApi<Plan>(`/api/users/${user}/plan`);
  const dash = useApi<DashboardData>(`/api/users/${user}/dashboard`);
  const official = useApi<{ scores: OfficialScore[] }>(`/api/users/${user}/official-scores`);
  const p = plan.data;
  const d = dash.data;
  const activeDrill = d?.active_drill && "session" in d.active_drill ? d.active_drill.session : null;
  const noDiagnostic = d != null && official.data != null && !d.last_full_simulation && (official.data.scores ?? []).length === 0;
  const active = p?.status === "active";

  return (
    <div className="space-y-6">
      <SectionBoundary name="Header" onRetry={plan.reload}>
        {plan.error ? <ErrorBox error={plan.error} onRetry={plan.reload} /> : p ? <Header user={user} plan={p} /> : <Spinner />}
      </SectionBoundary>

      {d && (d.active_simulation || activeDrill) && (
        <Notice tone="warn">
          {d.active_simulation && (
            <>
              Unfinished {d.active_simulation.scope} simulation.{" "}
              <Link to={`/u/${user}/sim/${d.active_simulation.id}`} className="font-bold underline underline-offset-4">
                Resume
              </Link>{" "}
            </>
          )}
          {activeDrill && (
            <>
              Unfinished {activeDrill.mode} drill.{" "}
              <Link to={`/u/${user}/drill/${activeDrill.exercise_id}?mode=${activeDrill.mode}`} className="font-bold underline underline-offset-4">
                Resume
              </Link>
            </>
          )}
        </Notice>
      )}

      {p && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <SectionBoundary name="Today's session" onRetry={plan.reload}>
            {active ? <SessionCard user={user} plan={p} onPlan={plan.setData} /> : <ExamDateCard user={user} plan={p} />}
          </SectionBoundary>
          <div className="grid content-start gap-5 sm:grid-cols-2 lg:grid-cols-1">
            {active && (
              <SectionBoundary name="Steps today" onRetry={plan.reload}>
                <StepsRing plan={p} />
              </SectionBoundary>
            )}
            <SectionBoundary name="Streak" onRetry={plan.reload}>
              <StreakCard plan={p} />
            </SectionBoundary>
          </div>
        </div>
      )}

      <SectionBoundary name="Projected bands" onRetry={dash.reload}>
        {dash.error ? <ErrorBox error={dash.error} onRetry={dash.reload} /> : d ? <Unlock projection={d.projection} /> : <Spinner />}
      </SectionBoundary>

      {p?.road && (
        <SectionBoundary name="The road to the exam" onRetry={plan.reload}>
          <Road plan={p} road={p.road} />
        </SectionBoundary>
      )}

      <div className={`grid gap-5 ${noDiagnostic ? "lg:grid-cols-2" : ""}`}>
        <SectionBoundary name="Word of the moment">
          <WordOfTheMoment user={user} />
        </SectionBoundary>
        {noDiagnostic && (
          <SectionBoundary name="Before anything else" onRetry={official.reload}>
            <BeforeAnything user={user} onSaved={official.reload} />
          </SectionBoundary>
        )}
      </div>
    </div>
  );
}

/** Instead of the plan when there is no (future) exam date. */
function ExamDateCard({ user, plan }: { user: string; plan: Plan }) {
  const title = plan.status === "exam_day" ? "Exam day" : plan.status === "past" ? "Set your next exam date" : "Set your exam date";
  const text =
    plan.status === "exam_day"
      ? "No training today — good luck. Set the next date afterwards if you plan another sitting."
      : plan.status === "past"
        ? `Your exam date (${plan.exam_date}) has passed. The daily session, the steps and the road to the exam are built backwards from the next one.`
        : "The daily session, the steps and the road to the exam are built backwards from your exam date.";
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="examdate-title">
      <h2 id="examdate-title" className="text-xl font-black">
        {title}
      </h2>
      <p className="mt-2 text-sm text-muted">{text}</p>
      {plan.status !== "exam_day" && (
        <Link to={`/u/${user}/settings`} className="btn btn-primary mt-5 h-14 w-full rounded-[20px] text-base sm:w-auto sm:px-8">
          Set your exam date in Settings
        </Link>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- 1. header

function Header({ user, plan }: { user: string; plan: Plan }) {
  const exam = plan.exam_date ? dayLabel(plan.exam_date, { day: "numeric", month: "long" }) : null;
  return (
    <header>
      <div className="text-[13px] font-extrabold tracking-wide text-dim [font-variant:small-caps]">
        {dayLabel(plan.date, { weekday: "long", day: "numeric", month: "long" }).toLowerCase()}
        {plan.phase && <> · {plan.phase.label.toLowerCase()} phase</>}
      </div>
      <h1 className="mt-1 text-3xl font-black tracking-tight text-text sm:text-4xl">
        {greeting(new Date().getHours())}, {user}.
      </h1>
      <p className="mt-1 text-[15px] font-semibold text-muted">
        {plan.status === "active" && exam ? (
          <>
            {plan.days_left} {plan.days_left === 1 ? "day" : "days"} to {exam}
          </>
        ) : plan.status === "exam_day" ? (
          "Exam day. No training today — good luck."
        ) : plan.status === "past" ? (
          <>
            Your exam date ({exam}) has passed.{" "}
            <Link to={`/u/${user}/settings`} className="font-bold text-text underline underline-offset-4">
              Set the next one
            </Link>
          </>
        ) : (
          <>
            No exam date yet.{" "}
            <Link to={`/u/${user}/settings`} className="font-bold text-text underline underline-offset-4">
              Set it in Settings
            </Link>{" "}
            to get a daily plan built backwards from it.
          </>
        )}
      </p>
    </header>
  );
}

// ---------------------------------------------------------------- 2. today's session

function stepMeta(b: PlanBlock) {
  const parts: string[] = [];
  if (b.detail) parts.push(b.detail);
  if (b.items != null && b.launch?.kind !== "simulation") parts.push(`${b.items} ${b.items === 1 ? "exercise" : "exercises"}`);
  if (b.minutes?.total != null) parts.push(`≈ ${b.minutes.total} min`);
  if (b.correction) parts.push(`then ${b.correction.label.toLowerCase()}`);
  return parts.join(" · ");
}

function SessionCard({ user, plan, onPlan }: { user: string; plan: Plan; onPlan: (p: Plan) => void }) {
  const { navigate } = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (plan.status !== "active") {
    return (
      <section className="card p-6 sm:p-8" aria-labelledby="session-title">
        <h2 id="session-title" className="text-xl font-black">
          Today's session
        </h2>
        <p className="mt-2 text-sm text-muted">
          {plan.status === "exam_day" ? "Rest today. The plan resumes after the exam if you set a new date." : "The daily session is built backwards from your exam date."}
        </p>
        {plan.status !== "exam_day" && (
          <Link to={`/u/${user}/settings`} className="btn mt-4">
            Set exam date
          </Link>
        )}
      </section>
    );
  }
  const { base, bonus, baseDone, current } = sessionSteps(plan);
  const steps = bonus ? [...base, bonus] : base;
  const toggle = async (b: PlanBlock) => {
    setBusy(b.id);
    setErr(null);
    try {
      onPlan(await setStepDone(user, plan.date, b.id, !b.done));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="session-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="session-title" className="text-xl font-black">
          Today's session
        </h2>
        {plan.phase && <span className="text-xs font-bold text-dim">{plan.phase.goal}</span>}
      </div>

      <ol className="mt-5">
        {steps.map((b, i) => {
          const isBonus = b === bonus;
          const locked = isBonus && !baseDone;
          const isCurrent = b === current;
          const last = i === steps.length - 1;
          return (
            <li key={b.id} className="relative flex gap-4 pb-5 last:pb-0">
              {!last && <span className={`absolute left-[21px] top-11 bottom-0 w-0.5 ${b.done ? "bg-accent" : "bg-line"} ${steps[i + 1] === bonus ? "border-l-2 border-dashed border-ring bg-transparent" : ""}`} aria-hidden />}
              <button
                type="button"
                onClick={() => !locked && toggle(b)}
                disabled={locked || busy != null}
                aria-pressed={b.done}
                aria-label={locked ? `${b.label}: locked until the base is done` : `${b.done ? "Unmark" : "Mark"} “${b.label}” as done`}
                title={locked ? "Unlocks when the three base steps are done" : b.done ? "Done — click to undo" : "Mark as done"}
                className={`relative z-10 flex h-11 shrink-0 items-center justify-center rounded-full text-sm font-black transition-colors ${
                  b.done
                    ? "w-11 bg-accent text-on-accent"
                    : isCurrent
                      ? "min-w-11 bg-accent px-3 text-on-accent"
                      : isBonus
                        ? "w-11 border-2 border-dashed border-ring bg-bg text-dim"
                        : "w-11 border-2 border-ring bg-bg text-dim hover:border-accent hover:text-text"
                }`}
              >
                {b.done ? <IconCheck size={18} /> : locked ? <IconLock size={16} /> : isBonus ? <IconPlus size={16} /> : i + 1}
              </button>
              <div className="min-w-0 flex-1 pt-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  {isBonus && <span className="label">Bonus round</span>}
                  <span className={`text-[15px] font-extrabold ${b.done ? "text-dim line-through" : "text-text"}`}>{b.label}</span>
                  {isCurrent && <span className="chip border-accent bg-accent text-on-accent">now</span>}
                  {b.mode === "practice" && <span className="chip">Clock hidden</span>}
                  {b.mode === "strict" && <span className="chip">timed</span>}
                </div>
                <div className="mt-0.5 text-[13px] text-dim">{locked ? "Unlocks when the three base steps are done." : stepMeta(b)}</div>
                {b.diagnostic && !b.done && <p className="mt-2 text-[13px] text-muted">{b.diagnostic.note}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-6">
        <div className="flex gap-1.5" role="img" aria-label={`${steps.filter((s) => s.done).length} of ${steps.length} steps done`}>
          {steps.map((b) => (
            <span key={b.id} className={`h-2.5 flex-1 rounded-full ${b.done ? "bg-accent" : b === current ? "bg-ring" : "bg-line"} ${b === bonus && !b.done ? "border border-dashed border-ring bg-transparent" : ""}`} />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs font-bold text-dim">
          <span>
            {steps.filter((s) => s.done).length} of {steps.length} steps
          </span>
        </div>
      </div>

      <button className="btn btn-primary mt-5 h-14 w-full rounded-[20px] text-base" onClick={() => navigate(`/u/${user}/session`)}>
        {baseDone && !current ? "Review today's session" : "Start session"}
      </button>
      {err && <p className="mt-2 text-sm font-semibold text-bad">{err}</p>}
      <p className="mt-3 text-xs text-dim">Internal training schedule (config → internal.plan), not an ETS recommendation.</p>
    </section>
  );
}

// ---------------------------------------------------------------- 3. ring and streak

function StepsRing({ plan }: { plan: Plan }) {
  const n = plan.blocks.length || 3;
  const done = plan.blocks.filter((b) => b.done).length;
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <section className="card flex items-center gap-5 p-6" aria-label={`${done} of ${n} steps done today`}>
      <svg width="108" height="108" viewBox="0 0 108 108" aria-hidden className="shrink-0 -rotate-90">
        <circle cx="54" cy="54" r={r} fill="none" strokeWidth="10" className="stroke-line" />
        {done > 0 && <circle cx="54" cy="54" r={r} fill="none" strokeWidth="10" strokeLinecap="round" className="stroke-accent" strokeDasharray={`${(done / n) * c} ${c}`} />}
      </svg>
      <div>
        <div className="text-3xl font-black tabular-nums">
          {done}/{n}
        </div>
        <div className="text-sm font-bold text-dim">steps today</div>
        {plan.base_done && <div className="mt-1 flex items-center gap-1 text-xs font-extrabold text-ok"><IconCheck size={14} /> base done</div>}
      </div>
    </section>
  );
}

function StreakCard({ plan }: { plan: Plan }) {
  const w = plan.week_days;
  if (!w)
    return (
      <section className="card p-6" aria-labelledby="streak-title">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-black tabular-nums">{plan.streak ?? 0}</span>
          <span id="streak-title" className="text-sm font-bold text-dim">
            {plan.streak === 1 ? "day" : "days"} in a row
          </span>
        </div>
        <p className="mt-3 text-xs text-dim">The days of this week are not available from the server yet.</p>
      </section>
    );
  const done = new Set(w.done ?? []);
  const days = Array.from({ length: 7 }, (_, i) => addDays(w.start, i));
  return (
    <section className="card p-6" aria-labelledby="streak-title">
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-black tabular-nums">{plan.streak ?? 0}</span>
        <span id="streak-title" className="text-sm font-bold text-dim">
          {plan.streak === 1 ? "day" : "days"} in a row
        </span>
      </div>
      <ul className="mt-4 grid grid-cols-7 gap-1 text-center" aria-label="This week">
        {days.map((d) => {
          const isToday = d === w.today;
          const isDone = done.has(d);
          const past = d < w.today;
          const state = isDone ? "done" : isToday ? "today" : past ? "missed" : "upcoming";
          return (
            <li key={d} className="flex flex-col items-center gap-1.5">
              <span className="text-[11px] font-bold text-dim">{dayLabel(d, { weekday: "narrow" })}</span>
              <span
                title={`${dayLabel(d, { weekday: "long", day: "numeric", month: "short" })}: ${state}`}
                className={`h-6 w-6 rounded-full ${
                  isDone ? `bg-accent ${isToday ? "ring-2 ring-accent ring-offset-2 ring-offset-card" : ""}` : isToday ? "border-[3px] border-accent" : past ? "bg-line" : "border-2 border-line"
                }`}
              />
              <span className="sr-only">{`${dayLabel(d, { weekday: "long" })}: ${state}`}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-dim">Filled = base done · ring = today · grey = missed</p>
    </section>
  );
}

// ---------------------------------------------------------------- 4. projected bands

function Unlock({ projection }: { projection: ProjectionView | undefined }) {
  if (!projection?.sections)
    return (
      <section className="card p-6 sm:p-8">
        <h2 className="text-xl font-black">Unlock your projected band</h2>
        <p className="mt-2 text-sm text-muted">No projection is available from the server yet.</p>
      </section>
    );
  const unlocked = SECTION_ORDER.filter((s) => projection.sections[s]?.band != null).length;
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="unlock-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="unlock-title" className="text-xl font-black">
          Unlock your projected band
        </h2>
        <span className="text-sm font-bold text-dim">
          {projection.overall.band != null ? (
            <>
              Overall <span className="text-text">{band(projection.overall.band)}</span> · target {band(projection.target_band)}
            </>
          ) : (
            `${unlocked}/4 sections unlocked · target ${band(projection.target_band)}`
          )}
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SECTION_ORDER.map((s) => {
          const e = projection.sections[s];
          if (!e)
            return (
              <div key={s} className="tile p-5">
                <span className="label">{SECTION_LABEL[s]}</span>
                <div className="mt-2 text-3xl font-black text-dim">—</div>
                <p className="mt-2 text-xs text-muted">No data for this section.</p>
              </div>
            );
          const locked = e.band == null;
          const min = e.min_n ?? 0;
          const unit = s === "reading" || s === "listening" ? "scored item" : "scored response";
          const left = Math.max(0, min - e.n);
          return (
            <div key={s} className="tile p-5">
              <div className="flex items-center justify-between">
                <span className="label">{SECTION_LABEL[s]}</span>
                {locked && <IconLock size={16} title="locked" className="text-dim" />}
              </div>
              {locked ? (
                <>
                  <div className="mt-2 text-3xl font-black text-dim" aria-label="no projection yet">
                    ?.?
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={min} aria-valuenow={Math.min(e.n, min)} aria-label={`${SECTION_LABEL[s]} data`}>
                    <div className="h-full rounded-full bg-accent" style={{ width: `${min ? Math.min(1, e.n / min) * 100 : 0}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {e.n}/{min} · {left > 0 ? `${left} more ${unit}${left === 1 ? "" : "s"} needed` : `needs more ${unit}s`}
                    {left > 0 && unit === "scored response" && <span className="block text-dim">AI evaluation, transcripts or self-ratings</span>}
                  </p>
                </>
              ) : (
                <>
                  <div className={`mt-2 text-3xl font-black tabular-nums ${e.band! < projection.target_band ? "" : "text-ok"}`}>{band(e.band)}</div>
                  <div className="mt-1 text-xs font-bold text-dim">{e.range && e.range[0] !== e.range[1] ? `range ${band(e.range[0])}–${band(e.range[1])}` : "narrow range"}</div>
                  <ConfidenceTag c={e.confidence} />
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-dim">{projection.disclaimer}</p>
    </section>
  );
}

// ---------------------------------------------------------------- 5. road to the exam

/** `celebrate` (session end screen): today's dot lights up. */
export function Road({ plan, road, celebrate }: { plan: Plan; road: NonNullable<Plan["road"]>; celebrate?: boolean }) {
  const n = daysFrom(road.start, road.exam_date) + 1;
  const days = Array.from({ length: n }, (_, i) => addDays(road.start, i));
  const done = new Set(road.done);
  const checkpoints = new Map(road.checkpoints.map((c) => [c.date, c.label]));
  const today = plan.date;
  const examLabel = dayLabel(road.exam_date, { day: "numeric", month: "long" });
  const doneCount = days.filter((d) => done.has(d)).length;
  const dot = (d: string) => {
    if (d === road.exam_date) return { cls: "h-4 w-4 bg-accent ring-2 ring-accent ring-offset-2 ring-offset-card", state: "exam day" };
    if (done.has(d)) return { cls: `h-3.5 w-3.5 bg-accent ${d === today ? `ring-4 ring-ring ${celebrate ? "motion-safe:animate-light" : ""}` : ""}`, state: "base done" };
    if (d === today) return { cls: "h-4 w-4 border-[3px] border-accent ring-4 ring-ring", state: "today" };
    if (checkpoints.has(d)) return { cls: "h-3.5 w-3.5 border-2 border-dashed border-text", state: `checkpoint: ${checkpoints.get(d)}` };
    if (d < today) return { cls: "h-3 w-3 bg-line", state: "missed" };
    return { cls: "h-3 w-3 border-2 border-ring", state: "upcoming" };
  };
  const span = (from: string, to: string) => daysFrom(from, to) + 1;
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="road-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="road-title" className="text-xl font-black">
          The road to {examLabel}
        </h2>
        <span className="text-sm font-bold text-dim">
          {doneCount} of {days.filter((d) => d <= today).length} days with the base done
        </span>
      </div>
      <div className="mt-5 overflow-x-auto pb-2">
        <div style={{ minWidth: n * 18 }}>
          <div className="grid items-center" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} role="img" aria-label={`${n} days from ${dayLabel(road.start, { day: "numeric", month: "long" })} to the exam; ${doneCount} with the base done`}>
            {days.map((d) => {
              const s = dot(d);
              return (
                <span key={d} className="flex h-7 items-center justify-center" title={`${dayLabel(d, { weekday: "short", day: "numeric", month: "short" })}: ${s.state}`}>
                  <span className={`block rounded-full ${s.cls}`} />
                </span>
              );
            })}
          </div>
          <div className="mt-3 flex gap-0.5" aria-label="Phases">
            {road.phases.map((ph) => {
              const current = plan.phase?.id === ph.id;
              const lastPhase = ph === road.phases[road.phases.length - 1];
              return (
                <div
                  key={ph.id}
                  style={{ flexGrow: span(ph.from, ph.to) + (lastPhase ? 1 : 0), flexBasis: 0 }}
                  className={`min-w-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold ${current ? "bg-accent text-on-accent" : "bg-pill text-muted"}`}
                  title={`${ph.label}: ${dayLabel(ph.from, { day: "numeric", month: "short" })} – ${dayLabel(ph.to, { day: "numeric", month: "short" })}`}
                >
                  <span className="block truncate">
                    {ph.label}
                    {current && <span className="sr-only"> (current phase)</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-dim" aria-label="Legend">
        <Legend dot="h-3.5 w-3.5 bg-accent">Base done</Legend>
        <Legend dot="h-4 w-4 border-[3px] border-accent ring-4 ring-ring">Today</Legend>
        <Legend dot="h-3.5 w-3.5 border-2 border-dashed border-text">Checkpoint (full test)</Legend>
        <Legend dot="h-3 w-3 bg-line">Missed</Legend>
        <Legend dot="h-3 w-3 border-2 border-ring">Upcoming</Legend>
        <Legend dot="h-4 w-4 bg-accent ring-2 ring-accent ring-offset-2 ring-offset-card">Exam</Legend>
        <li className="flex items-center gap-2">
          <span className="inline-block h-3 w-6 rounded-full bg-accent" /> Current phase
        </li>
      </ul>
    </section>
  );
}

function Legend({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center">
        <span className={`block rounded-full ${dot}`} />
      </span>
      {children}
    </li>
  );
}

// ---------------------------------------------------------------- 6. word of the moment

const SKIP = new Set(["a", "an", "the", "sth", "sb", "someone", "something", "one's", "x", "y"]);

/** Splits an example and bolds the words of the entry (any regular or listed irregular form, in order). */
export function boldEntry(example: string, headword: string): ReactNode[] {
  const parts = example.split(/([A-Za-z][A-Za-z'’-]*)/);
  const sets = headword
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && !SKIP.has(w))
    .map((w) => inflectionsOf(w));
  const words = parts.map((_, i) => i).filter((i) => i % 2 === 1);
  const norm = (i: number) => parts[i]!.toLowerCase().replace(/’/g, "'");
  let hit = new Set<number>();
  for (let s = 0; s < words.length && sets.length && !hit.size; s++) {
    if (!sets[0]!.has(norm(words[s]!))) continue;
    const chosen = [words[s]!];
    let pos = s;
    for (let k = 1; k < sets.length; k++) {
      let found = -1;
      for (let j = pos + 1; j < Math.min(words.length, pos + 6); j++) if (sets[k]!.has(norm(words[j]!))) { found = j; break; }
      if (found < 0) break;
      chosen.push(words[found]!);
      pos = found;
    }
    if (chosen.length === sets.length) hit = new Set(chosen);
  }
  return parts.map((t, i) => (hit.has(i) ? <strong key={i} className="font-black text-text">{t}</strong> : <span key={i}>{t}</span>));
}

function WordOfTheMoment({ user }: { user: string }) {
  const { data, error, reload } = useApi<TriageData>(`/api/users/${user}/vocab/triage?limit=1`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const e = data?.entries[0];
  const act = async (kind: "known" | "deck") => {
    if (!e) return;
    setBusy(true);
    setErr(null);
    try {
      if (kind === "known") await api.post(`/api/users/${user}/vocab/triage`, { entryId: e.id, decision: "known" });
      else await api.post(`/api/users/${user}/vocab/cards`, { entryId: e.id });
      setMsg(kind === "known" ? `“${e.headword}” marked as known — it will not come as a new card.` : `“${e.headword}” added to your deck.`);
      await reload();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="word-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="word-title" className="text-xl font-black">
          Word of the moment
        </h2>
        <Link to={`/u/${user}/vocab/triage`} className="text-xs font-bold text-dim underline underline-offset-4 hover:text-text">
          Triage
        </Link>
      </div>
      {error ? (
        <div className="mt-4">
          <ErrorBox error={error} onRetry={reload} />
        </div>
      ) : !data ? (
        <Spinner />
      ) : !e ? (
        <p className="mt-4 text-sm text-muted">Every word of your introduction order is sorted or already in your deck.</p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link to={`/u/${user}/vocab/entry/${e.id}`} className="text-3xl font-black tracking-tight text-text hover:underline">
              {e.headword}
            </Link>
            <span className="text-sm font-bold text-dim">
              {e.pos} · {e.cefr}
            </span>
          </div>
          <div className="mt-1 text-[15px] font-semibold text-muted">{e.translation_fr}</div>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">{boldEntry(e.example, e.headword)}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn" disabled={busy} onClick={() => act("known")}>
              I'd use it already
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => act("deck")}>
              <IconPlus size={16} /> Add to my deck
            </button>
          </div>
          <p className="mt-3 text-xs text-dim">
            Next new word in your introduction order ({data.remaining} left) — an internal selection, not an official list. "I'd use it already" works like the Triage: known words never come as new cards, and one in ten is checked later.
          </p>
        </>
      )}
      {msg && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-bold text-ok" role="status">
          <IconCheck size={16} /> {msg}
        </p>
      )}
      {err && <p className="mt-3 text-sm font-semibold text-bad">{err}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- 7. before anything else

function BeforeAnything({ user, onSaved }: { user: string; onSaved: () => void }) {
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const startSim = async () => {
    setBusy(true);
    setErr(await launchBlock(user, { kind: "simulation", scope: "full", length: "full" }, navigate));
    setBusy(false);
  };
  return (
    <section className="card p-6 sm:p-8" aria-labelledby="before-title">
      <h2 id="before-title" className="text-xl font-black">
        Before anything else
      </h2>
      <p className="mt-2 text-sm text-muted">The plan needs a starting point. Take a full simulation, or enter the four section bands of an official ETS test you have already taken.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={startSim}>
          Start a full simulation
        </button>
        <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          I have official ETS scores
        </button>
      </div>
      {open && <OfficialScoreForm user={user} onSaved={onSaved} />}
      {err && <p className="mt-3 text-sm font-semibold text-bad">{err}</p>}
    </section>
  );
}
