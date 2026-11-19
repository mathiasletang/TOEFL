import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useRouter } from "../lib/router";
import { Spinner, ErrorBox, Notice } from "../components/ui";
import { IconCheck, IconPlay, IconX } from "../components/icons";
import { Drill } from "./Drill";
import { VocabSession } from "./Vocabulary";
import { Shadowing } from "./Shadowing";
import { SimulationRunner } from "./Simulation";
import { Road } from "./Today";
import { ReviewView, type ReviewData } from "../tasks/Review";
import { setStepDone, type Plan, type PlanBlock } from "../lib/today";
import { blocksToCheck, bonusAvailable, progressSegments, reachedCount, resumeScreen, saveFor, type SavedSession, type SessionScreen, type SessionStepId } from "../../../shared/session";

const AUTOSTART_SECONDS = 5;
const key = (user: string) => `toefl.session.${user}`;
const readSaved = (user: string): SavedSession | null => {
  try {
    const v = localStorage.getItem(key(user));
    return v ? (JSON.parse(v) as SavedSession) : null;
  } catch {
    return null;
  }
};
const writeSaved = (user: string, s: SavedSession) => {
  try {
    localStorage.setItem(key(user), JSON.stringify(s));
  } catch {
    /* storage unavailable: the server-side progress still resumes the right step */
  }
};

const stepOf = (p: Plan, id: string): PlanBlock | undefined => (id === "optional" ? (p.optional ?? undefined) : p.blocks.find((b) => b.id === id));

/** Session mode: today's plan chained full screen (no navigation), resumable after leaving. */
export function Session({ user }: { user: string }) {
  const { navigate } = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [screen, setScreen] = useState<SessionScreen | null>(null);
  const [bonus, setBonus] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [justFinished, setJustFinished] = useState(false);

  /** Fetch the plan, tick blocks already reached (left before ticking), and pick the screen. */
  const refresh = useCallback(
    async (state: SavedSession | null) => {
      try {
        let p = await api.get<Plan>(`/api/users/${user}/plan`);
        for (const id of blocksToCheck(p)) p = await setStepDone(user, p.date, id, true);
        setPlan(p);
        setBonus(state?.date === p.date && !!state.bonus);
        setScreen(resumeScreen(p, state));
      } catch (e) {
        setError(e);
      }
    },
    [user],
  );
  useEffect(() => {
    void refresh(readSaved(user));
  }, [refresh, user]);
  useEffect(() => {
    if (plan && screen && screen.screen !== "unavailable") writeSaved(user, saveFor(plan, screen, bonus));
  }, [plan, screen, bonus, user]);

  /** Tick the step in the plan and move to "Up next" (or the end screen). */
  const completeStep = useCallback(
    async (id: string) => {
      if (!plan) return;
      try {
        const p = await setStepDone(user, plan.date, id, true);
        setPlan(p);
        const next = resumeScreen(p, { date: p.date, step: null, screen: "upnext", bonus });
        if (next.screen === "end") setJustFinished(true);
        setScreen(next);
      } catch (e) {
        setError(e);
      }
    },
    [plan, user, bonus],
  );

  const exit = () => navigate(`/u/${user}`);
  if (error) return <Frame user={user} plan={plan} bonus={bonus} current={null} onExit={exit}><ErrorBox error={error} onRetry={() => { setError(null); void refresh(readSaved(user)); }} /></Frame>;
  if (!plan || !screen) return <Frame user={user} plan={null} bonus={false} current={null} onExit={exit}><Spinner label="Preparing today's session…" /></Frame>;

  const current = screen.screen === "upnext" || screen.screen === "run" ? screen.step.id : null;
  return (
    <Frame user={user} plan={plan} bonus={bonus} current={current} onExit={exit} onFinishStep={screen.screen === "run" && stepOf(plan, screen.step.id)?.launch?.kind !== "simulation" ? () => completeStep(screen.step.id) : undefined}>
      {screen.screen === "unavailable" && (
        <Centered>
          <Notice>There is no session today: {plan.status === "exam_day" ? "it is exam day." : plan.status === "past" ? "your exam date has passed." : "set your exam date in Settings first."}</Notice>
          <button className="btn mt-4" onClick={exit}>
            Back to Today
          </button>
        </Centered>
      )}
      {screen.screen === "upnext" && <UpNext key={screen.step.id} plan={plan} step={stepOf(plan, screen.step.id)!} onStart={() => setScreen({ screen: "run", step: screen.step })} />}
      {screen.screen === "run" && (
        <div key={screen.step.id} className="motion-safe:animate-rise">
          <RunStep user={user} plan={plan} step={stepOf(plan, screen.step.id)!} onPlan={setPlan} onDone={() => completeStep(screen.step.id)} onExit={exit} />
        </div>
      )}
      {screen.screen === "end" && (
        <EndScreen
          plan={plan}
          celebrate={justFinished}
          onBonus={() => {
            setBonus(true);
            setJustFinished(false);
            setScreen(resumeScreen(plan, { date: plan.date, step: null, screen: "upnext", bonus: true }));
          }}
          onDone={exit}
        />
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------- frame: thin bar, no navigation

function Frame({ plan, bonus, current, onExit, onFinishStep, children }: { user: string; plan: Plan | null; bonus: boolean; current: string | null; onExit: () => void; onFinishStep?: () => void; children: React.ReactNode }) {
  const segs = plan ? progressSegments(plan, bonus, current as SessionStepId | null) : [];
  const done = segs.filter((s) => s.state === "done").length;
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-1.5">
          <span className="w-16 shrink-0 text-xs font-extrabold tabular-nums text-dim">{segs.length ? `${done}/${segs.length}` : ""}</span>
          <div className="flex flex-1 gap-1.5" role="progressbar" aria-label="Today's session" aria-valuemin={0} aria-valuemax={segs.length} aria-valuenow={done}>
            {segs.map((s) => (
              <span
                key={s.id}
                title={`${s.label}: ${s.state === "done" ? "done" : s.state === "current" ? "in progress" : "to do"}`}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${s.state === "done" ? "bg-accent" : s.state === "current" ? "bg-ring" : "bg-line"} ${s.id === "optional" && s.state !== "done" ? "border border-dashed border-ring bg-transparent" : ""}`}
              />
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onFinishStep && (
              <button className="btn btn-ghost text-xs text-dim" onClick={onFinishStep} title="Tick this step in the plan and move on">
                <IconCheck size={15} /> Mark step done
              </button>
            )}
            <button className="btn btn-ghost text-xs text-dim" onClick={onExit} title="Leave the session; it resumes where you left it">
              <IconX size={15} /> Exit
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center motion-safe:animate-rise">{children}</div>;
}

const stepNumber = (plan: Plan, step: PlanBlock) => (step.id === "optional" ? "Bonus round" : `Step ${["vocab", "shadowing", "main"].indexOf(step.id) + 1} of 3`);
function stepMeta(step: PlanBlock) {
  const parts: string[] = [];
  if (step.detail) parts.push(step.detail);
  if (step.items != null && step.launch?.kind === "drill") parts.push(`${step.items} ${step.items === 1 ? "exercise" : "exercises"}${step.progress ? ` (${step.progress} done today)` : ""}`);
  if (step.minutes?.total != null) parts.push(`≈ ${step.minutes.total} min`);
  return parts.join(" · ");
}
const clockLabel = (step: PlanBlock) =>
  step.launch?.kind === "simulation" ? "Timed — the clock stays visible, as in the test" : step.mode === "strict" ? "Timed — the clock stays visible" : step.mode === "practice" ? "Clock hidden" : null;

// ---------------------------------------------------------------- up next: starts by itself after 5 s

function UpNext({ plan, step, onStart }: { plan: Plan; step: PlanBlock; onStart: () => void }) {
  const [left, setLeft] = useState(AUTOSTART_SECONDS * 1000);
  const [paused, setPaused] = useState(false);
  const started = useRef(false);
  const go = useCallback(() => {
    if (started.current) return;
    started.current = true;
    onStart();
  }, [onStart]);
  useEffect(() => {
    if (paused) return;
    const t0 = performance.now() - (AUTOSTART_SECONDS * 1000 - left);
    const id = window.setInterval(() => {
      const l = Math.max(0, AUTOSTART_SECONDS * 1000 - (performance.now() - t0));
      setLeft(l);
      if (l <= 0) {
        window.clearInterval(id);
        go();
      }
    }, 100);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, go]);
  const r = 34;
  const c = 2 * Math.PI * r;
  const secs = Math.ceil(left / 1000);
  const clock = clockLabel(step);
  return (
    <Centered>
      <div className="label">Up next · {stepNumber(plan, step)}</div>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{step.label}</h1>
      <p className="mt-2 text-sm text-muted">{stepMeta(step)}</p>
      {clock && <span className="chip mt-3">{clock}</span>}
      {step.diagnostic && <p className="mt-3 max-w-md text-[13px] text-muted">{step.diagnostic.note}</p>}
      <div className="relative mt-8 h-24 w-24" aria-live="polite">
        <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90" aria-hidden>
          <circle cx="48" cy="48" r={r} fill="none" strokeWidth="6" className="stroke-line" />
          <circle cx="48" cy="48" r={r} fill="none" strokeWidth="6" strokeLinecap="round" className="stroke-accent" strokeDasharray={`${(left / (AUTOSTART_SECONDS * 1000)) * c} ${c}`} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-2xl font-black tabular-nums">{paused ? <span className="text-sm text-dim">paused</span> : secs}</span>
        <span className="sr-only">{paused ? "Paused" : `Starts in ${secs} seconds`}</span>
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button className="btn btn-primary h-14 rounded-[20px] px-8 text-base" onClick={go} autoFocus>
          <IconPlay size={18} /> Start now
        </button>
        <button className="btn h-14 rounded-[20px] px-6 text-base" onClick={() => setPaused(!paused)} aria-pressed={paused}>
          {paused ? "Resume countdown" : "Pause"}
        </button>
      </div>
    </Centered>
  );
}

// ---------------------------------------------------------------- running a step with the existing components

function RunStep({ user, plan, step, onPlan, onDone, onExit }: { user: string; plan: Plan; step: PlanBlock; onPlan: (p: Plan) => void; onDone: () => void; onExit: () => void }) {
  const kind = step.launch?.kind ?? (step.id === "vocab" ? "vocab" : step.id === "shadowing" ? "shadowing" : null);
  if (kind === "vocab") return <VocabSession user={user} onFinished={onDone} />;
  if (kind === "shadowing") return <Shadowing user={user} onFinished={onDone} />;
  if (kind === "drill") return <DrillBlock user={user} plan={plan} step={step} onPlan={onPlan} onDone={onDone} />;
  if (kind === "simulation" && step.launch?.kind === "simulation") return <SimBlock user={user} scope={step.launch.scope} length={step.launch.length} onDone={onDone} onExit={onExit} />;
  return (
    <Centered>
      <Notice tone="warn">No exercise is available for this step.</Notice>
      <button className="btn mt-4" onClick={onDone}>
        Mark it done and continue
      </button>
    </Centered>
  );
}

/** A drill block: drills one after the other (each followed by its correction) until the block's count is reached. */
function DrillBlock({ user, plan, step, onPlan, onDone }: { user: string; plan: Plan; step: PlanBlock; onPlan: (p: Plan) => void; onDone: () => void }) {
  const [review, setReview] = useState<ReviewData | null>(null);
  const [busy, setBusy] = useState(false);
  // A drill left open (same mode) is resumed in place instead of starting the plan's next pick.
  const [resume, setResume] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api
      .get<{ active: { session?: { exercise_id: string; mode: string }; exercise?: { task_type: string } } | null }>(`/api/users/${user}/active-session`)
      .then((r) => {
        const a = r.active;
        const sameTask = step.task === "focus" || a?.exercise?.task_type === step.task;
        setResume(a?.session && step.launch?.kind === "drill" && a.session.mode === step.launch.mode && sameTask ? a.session.exercise_id : null);
      })
      .catch(() => setResume(null));
  }, [user, step.launch]);
  const launch = step.launch?.kind === "drill" ? step.launch : null;
  const next = async () => {
    setBusy(true);
    try {
      const p = await api.get<Plan>(`/api/users/${user}/plan`);
      onPlan(p);
      setReview(null);
      setResume(null);
      const b = step.id === "optional" ? p.optional : p.blocks.find((x) => x.id === step.id);
      if (!b || reachedCount(b) || b.launch?.kind !== "drill") onDone();
    } finally {
      setBusy(false);
    }
  };
  const count = (step.progress ?? 0) + (review ? 1 : 0);
  if (!launch || resume === undefined) return null;
  const exerciseId = resume ?? launch.exercise_id;
  if (review)
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="label">Correction · {step.label}</div>
            <div className="text-sm font-bold text-muted">
              {Math.min(count, step.items ?? count)} of {step.items} exercises done
            </div>
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={next} autoFocus>
            {step.items != null && count >= step.items ? "Finish this step" : "Next exercise"}
          </button>
        </div>
        <ReviewView data={review} onReload={setReview} />
      </div>
    );
  return (
    <div className="space-y-3">
      <div className="text-xs font-bold text-dim">
        {step.label} · exercise {Math.min(count + 1, step.items ?? count + 1)} of {step.items}
      </div>
      <Drill key={exerciseId + plan.date + count} user={user} exerciseId={exerciseId} embedded={{ mode: launch.mode, origin: launch.origin, hideClock: launch.mode === "practice", onSubmitted: setReview }} />
    </div>
  );
}

/** A simulation block: resumes the active simulation of this scope, or starts one. The timer stays visible. */
function SimBlock({ user, scope, length, onDone, onExit }: { user: string; scope: string; length: "full" | "short"; onDone: () => void; onExit: () => void }) {
  const [simId, setSimId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.get<Array<{ id: string; scope: string; length: string; status: string }>>(`/api/users/${user}/simulations`);
        const active = list.find((s) => s.status === "active");
        if (active && (active.scope !== scope || active.length !== length)) {
          if (!cancelled) setBlocked(active.id);
          return;
        }
        const id = active?.id ?? (await api.post<{ simulation: { id: string } }>("/api/simulations", { userId: user, scope, length })).simulation.id;
        if (!cancelled) setSimId(id);
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, scope, length]);
  if (error) return <ErrorBox error={error} />;
  if (blocked)
    return (
      <Centered>
        <Notice tone="warn">Another simulation is unfinished. Finish or abandon it first, then come back: the session resumes here.</Notice>
        <a className="btn mt-4" href={`/u/${user}/sim/${blocked}`}>
          Open the unfinished simulation
        </a>
      </Centered>
    );
  if (!simId) return <Spinner label="Preparing the simulation…" />;
  return <SimulationRunner user={user} simId={simId} onCompleted={onDone} onAbandoned={onExit} />;
}

// ---------------------------------------------------------------- end screen

function EndScreen({ plan, celebrate, onBonus, onDone }: { plan: Plan; celebrate: boolean; onBonus: () => void; onDone: () => void }) {
  const canBonus = bonusAvailable(plan);
  return (
    <div className="mx-auto max-w-3xl space-y-6 text-center">
      <div className="motion-safe:animate-rise">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-on-accent">
          <IconCheck size={30} />
        </div>
        <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">{plan.optional?.done ? "Bonus round done" : "Today's base is done"}</h1>
        <p className="mt-2 text-[15px] font-semibold text-muted">
          <span className="text-2xl font-black text-text tabular-nums">{plan.streak}</span> {plan.streak === 1 ? "day" : "days"} in a row
        </p>
      </div>
      {plan.road && (
        <div className="text-left">
          <Road plan={plan} road={plan.road} celebrate={celebrate} />
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2 motion-safe:animate-rise">
        {canBonus && (
          <button className="btn btn-primary h-14 rounded-[20px] px-8 text-base" onClick={onBonus} autoFocus>
            Bonus round
          </button>
        )}
        <button className={`btn h-14 rounded-[20px] px-8 text-base ${canBonus ? "" : "btn-primary"}`} onClick={onDone} autoFocus={!canBonus}>
          Done for today
        </button>
      </div>
      {canBonus && plan.optional && <p className="text-xs text-dim">Bonus round: {plan.optional.label}{plan.optional.mode === "practice" ? " · clock hidden" : ""}. Optional — the base already counts for your streak.</p>}
    </div>
  );
}
