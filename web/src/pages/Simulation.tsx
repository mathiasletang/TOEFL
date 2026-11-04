import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useRouter, Link } from "../lib/router";
import { useConfig } from "../lib/config";
import { useCountdown, clockOffset } from "../lib/timer";
import { band, pct, SECTION_LABEL } from "../lib/format";
import { Spinner, ErrorBox, TimerBadge, Notice, PageTitle, ConfidenceTag } from "../components/ui";
import { TaskView, cleanResponse, isSpeaking } from "../tasks";
import { TASK_LABEL } from "../../../shared/schema";
import type { PublicExercise } from "../../../shared/publicView";

type Scope = "full" | "reading" | "listening" | "writing" | "speaking";

const SCOPES: Array<{ id: Scope; label: string; desc: string }> = [
  { id: "full", label: "Full test", desc: "Reading → Listening → Writing → Speaking" },
  { id: "reading", label: "Reading", desc: "Adaptive: Module 1 → Module 2" },
  { id: "listening", label: "Listening", desc: "Adaptive: Module 1 → Module 2" },
  { id: "writing", label: "Writing", desc: "Build a Sentence · Email · Discussion" },
  { id: "speaking", label: "Speaking", desc: "Listen and Repeat · Interview" },
];

export function SimulationLauncher({ user }: { user: string }) {
  const cfg = useConfig();
  const suff = useApi<Record<string, { forms: number; blocker: string | null }>>("/api/simulations/sufficiency");
  const history = useApi<Array<{ id: string; scope: string; length: string; status: string; started_at: string; completed_at: string | null }>>(`/api/users/${user}/simulations`);
  const { navigate } = useRouter();
  const [scope, setScope] = useState<Scope>("reading");
  const [length, setLength] = useState<"full" | "short">("full");
  const [threshold, setThreshold] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const thr = threshold ?? cfg?.routing.training_threshold ?? 0.8;
  const key = `${scope}:${length}`;
  const s = suff.data?.[key];
  const active = history.data?.find((h) => h.status === "active");

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await api.post<{ simulation: { id: string } }>("/api/simulations", { userId: user, scope, length, threshold: thr });
      navigate(`/u/${user}/sim/${v.simulation.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageTitle title="TOEFL simulation" sub="Timed, strict, no answers until the end. Reading and Listening use a two-stage adaptive design (Module 1 routes you to Module 2)." />
      {active && (
        <Notice tone="warn">
          You have an unfinished {active.scope} simulation.{" "}
          <Link to={`/u/${user}/sim/${active.id}`} className="font-medium underline">
            Resume it
          </Link>{" "}
          or abandon it from its page before starting another.
        </Notice>
      )}
      <div className="grid gap-5 md:grid-cols-[1.4fr_1fr]">
        <div className="card space-y-5 p-5">
          <div>
            <div className="label mb-2">Scope</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCOPES.map((o) => (
                <button key={o.id} onClick={() => setScope(o.id)} className={`rounded-md border p-3 text-left ${scope === o.id ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 hover:border-zinc-400"}`}>
                  <div className="text-sm font-medium">{o.label}</div>
                  <div className="text-xs text-zinc-500">{o.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label mb-2">Length</div>
            <div className="flex gap-2">
              {(["full", "short"] as const).map((l) => (
                <button key={l} onClick={() => setLength(l)} className={`rounded-md border px-3 py-2 text-sm ${length === l ? "border-zinc-900 bg-zinc-50 font-medium" : "border-zinc-200"}`}>
                  {l === "full" ? "Official format" : "Short (internal)"}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              {length === "full"
                ? "Module composition and timing follow the published ETS blueprint (e.g. Reading Module 1 = 10 Complete the Words + 5 Daily Life + 5 Academic)."
                : "A reduced composition for a 15–25 minute session. Not an official-format test."}
            </p>
          </div>
          {(scope === "full" || scope === "reading" || scope === "listening") && (
            <div>
              <div className="label mb-2">Internal routing threshold</div>
              <div className="flex items-center gap-3">
                <input type="range" min={0.5} max={0.95} step={0.05} value={thr} onChange={(e) => setThreshold(Number(e.target.value))} className="w-48" aria-label="Routing threshold" />
                <span className="font-mono text-sm">{pct(thr)}</span>
              </div>
              <p className="mt-1 text-xs text-amber-800">{cfg?.routing.ui_warning ?? "Internal training threshold. ETS does not publish its routing cut-off."} Module 1 accuracy ≥ this value routes to the harder Module 2.</p>
            </div>
          )}
          {error != null && <ErrorBox error={error} />}
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" disabled={busy || !!active || (s != null && s.forms === 0)} onClick={start}>
              {busy ? "Preparing…" : "Start simulation"}
            </button>
            {s && <span className="text-xs text-zinc-500">{s.forms === 0 ? `Not enough content: ${s.blocker}` : `Content bank supports ${s.forms} distinct form(s) of this type.`}</span>}
          </div>
        </div>
        <div className="card p-5">
          <div className="label mb-2">History</div>
          {!history.data?.length ? (
            <p className="text-sm text-zinc-500">No simulations yet.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {history.data.slice(0, 12).map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2 text-[13px]">
                  <span>
                    {h.scope} <span className="text-zinc-400">({h.length})</span>
                  </span>
                  {h.status === "completed" ? (
                    <Link to={`/u/${user}/sim/${h.id}/results`} className="text-accent underline">
                      results
                    </Link>
                  ) : h.status === "active" ? (
                    <Link to={`/u/${user}/sim/${h.id}`} className="text-amber-700 underline">
                      resume
                    </Link>
                  ) : (
                    <span className="text-xs text-zinc-400">{h.status}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Current {
  simulation: {
    id: string;
    scope: string;
    length: string;
    status: string;
    step_index: number;
    steps: Array<{ index: number; section: string; stage: string; label: string; minutes: number | null; status: string; items: number }>;
    notices: string[];
    router: { trainingThreshold: number; warning: string };
  };
  step: { index: number; section: string; stage: string; label: string; minutes: number | null; allowBack: boolean; started: boolean } | null;
  session: { deadline_at: string | null; started_at: string; state: ModuleState } | null;
  exercises: PublicExercise[];
  server_now: string;
}

interface ModuleState {
  responses?: Record<string, unknown>;
  elapsedMs?: Record<string, number>;
  pos?: number;
}

const RULES: Record<string, string> = {
  router: "",
  module2: "",
  build: "Build a Sentence: shared timer for all items. You may move back and forth within this part.",
  email: "Write an Email: 7 minutes. Spell-check is off.",
  discussion: "Academic Discussion: 10 minutes. Spell-check is off.",
  repeat: "Listen and Repeat: each sentence plays once; recording starts automatically; no preparation time.",
  interview: "Interview: 4 questions, recording starts immediately after each question, 45 seconds each.",
};

export function SimulationRunner({ user, simId }: { user: string; simId: string }) {
  const { navigate } = useRouter();
  const [cur, setCur] = useState<Current | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [state, setState] = useState<ModuleState>({});
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const entered = useRef<number>(performance.now());
  const submitting = useRef(false);

  const apply = useCallback(
    (v: Current) => {
      if (v.simulation.status !== "active") {
        navigate(`/u/${user}/sim/${simId}/results`, true);
        return;
      }
      setOffset(clockOffset(v.server_now));
      setCur(v);
      setState(v.session?.state ?? {});
      entered.current = performance.now();
      submitting.current = false;
      setBusy(false);
    },
    [navigate, user, simId],
  );

  useEffect(() => {
    api.get<Current>(`/api/simulations/${simId}/current`).then(apply).catch(setError);
  }, [simId, apply]);

  const exercises = cur?.exercises ?? [];
  const pos = Math.min(state.pos ?? 0, Math.max(0, exercises.length - 1));
  const ex = exercises[pos];

  // Autosave module state.
  useEffect(() => {
    if (!cur?.step?.started || submitting.current) return;
    const id = window.setTimeout(() => api.put(`/api/simulations/${simId}/state`, { state }).catch(() => {}), 600);
    return () => window.clearTimeout(id);
  }, [state, cur, simId]);

  const accountTime = (s: ModuleState): ModuleState => {
    if (!ex) return s;
    const elapsedMs = { ...(s.elapsedMs ?? {}) };
    elapsedMs[ex.id] = (elapsedMs[ex.id] ?? 0) + (performance.now() - entered.current);
    entered.current = performance.now();
    return { ...s, elapsedMs };
  };

  const submitStep = useCallback(
    async (timedOut: boolean) => {
      if (submitting.current) return;
      submitting.current = true;
      setBusy(true);
      const s = accountTime(stateRef.current);
      const responses = Object.fromEntries(Object.entries(s.responses ?? {}).map(([k, v]) => [k, cleanResponse(v)]));
      try {
        apply(await api.post<Current>(`/api/simulations/${simId}/submit-step`, { responses, elapsedMs: s.elapsedMs ?? {}, timedOut }));
      } catch (e) {
        // The server may already have auto-submitted (deadline passed): reload the current view.
        try {
          apply(await api.get<Current>(`/api/simulations/${simId}/current`));
        } catch {
          setError(e);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simId, apply, ex],
  );

  const timer = useCountdown(cur?.session?.deadline_at, offset, () => void submitStep(true), busy);

  if (error) return <ErrorBox error={error} />;
  if (!cur) return <Spinner />;
  const step = cur.step!;
  const steps = cur.simulation.steps;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((s) => (
          <span key={s.index} className={`rounded px-2 py-0.5 text-[11px] ${s.index === step.index ? "bg-zinc-900 text-white" : s.status === "submitted" ? "bg-zinc-200 text-zinc-600" : "bg-zinc-100 text-zinc-400"}`}>
            {SECTION_LABEL[s.section]} · {s.label}
          </span>
        ))}
      </div>
      {step.started && cur.session?.deadline_at && <TimerBadge remaining={timer.remaining} total={(step.minutes ?? 0) * 60000} />}
    </div>
  );

  if (!step.started) {
    const back = step.allowBack;
    return (
      <div className="space-y-5">
        {header}
        <div className="card mx-auto max-w-xl space-y-4 p-8 text-center">
          <div className="label">{SECTION_LABEL[step.section]}</div>
          <h2 className="text-2xl font-semibold">{step.label}</h2>
          <p className="text-sm text-zinc-600">
            {step.minutes != null ? `${step.minutes} minutes · ` : ""}
            {RULES[step.stage] ||
              (back
                ? "You may return to earlier questions within this module, but not to a previous module."
                : "You cannot return to earlier questions. Each audio plays once.")}
          </p>
          {step.stage === "router" && <p className="text-xs text-zinc-500">Your Module 1 performance selects your Module 2. {cur.simulation.router.warning}</p>}
          {cur.simulation.notices.map((n) => (
            <p key={n} className="text-xs text-amber-800">
              {n}
            </p>
          ))}
          <div className="flex justify-center gap-2">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                apply(await api.post<Current>(`/api/simulations/${simId}/start-step`));
              }}
            >
              Begin {step.label}
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (!window.confirm("Abandon this simulation? Answers already submitted are kept.")) return;
                await api.post(`/api/simulations/${simId}/abandon`);
                navigate(`/u/${user}/simulate`);
              }}
            >
              Abandon
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ex) return <Spinner />;
  const speaking = isSpeaking(ex.task_type);
  const locked = timer.status === "expired" || busy;
  const isLast = pos === exercises.length - 1;
  const setResp = (v: unknown) => setState((s) => ({ ...s, responses: { ...(s.responses ?? {}), [ex.id]: v } }));
  const go = (p: number) => setState((s) => ({ ...accountTime(s), pos: p }));

  return (
    <div className="space-y-5">
      {header}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {TASK_LABEL[ex.task_type]} · {pos + 1} of {exercises.length}
        </span>
        <span>{step.allowBack ? "You can go back within this module." : "No going back."}</span>
      </div>
      <TaskView
        key={ex.id}
        ex={ex}
        value={state.responses?.[ex.id]}
        onChange={setResp}
        ctx={{
          userId: user,
          sessionId: null,
          strict: true,
          locked,
          onComplete: () => {
            if (isLast) void submitStep(false);
            else go(pos + 1);
          },
        }}
      />
      {!speaking && (
        <div className="flex items-center justify-between border-t border-zinc-200 pt-4">
          <button className="btn" disabled={!step.allowBack || pos === 0 || locked} onClick={() => go(pos - 1)}>
            ← Back
          </button>
          {isLast ? (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Submit ${step.label}? You will not be able to return to it.`)) void submitStep(false);
              }}
            >
              {busy ? "Submitting…" : `Submit ${step.label}`}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={locked} onClick={() => go(pos + 1)}>
              Next →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface Results {
  simulation: { id: string; scope: string; length: string; status: string; completed_at: string | null; router: { trainingThreshold: number; model: string }; steps: Array<{ section: string; stage: string; label: string; route: { route: string; correct: number; total: number; proportion: number; threshold: number } | null }> };
  results: {
    sections: Record<string, { band: number | null; range: [number, number] | null; confidence: string; evidence: string }>;
    overall: { band: number | null; range: [number, number] | null; mean: number | null; confidence: string } | null;
    pending_attempts: number;
    notices: string[];
    disclaimer: string;
  } | null;
  attempts: Array<{ id: string; exercise_id: string; task_type: string; section: string; module_stage: string; raw_score: number | null; max_score: number; accuracy: number | null; pending: number; timed_out: number }>;
}

export function SimulationResults({ user, simId }: { user: string; simId: string }) {
  const { data, error, loading, reload } = useApi<Results>(`/api/simulations/${simId}/results`);
  const cfg = useConfig();
  const [evalState, setEvalState] = useState<string | null>(null);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const r = data.results;
  const pendingProductive = data.attempts.filter((a) => a.pending && ["write_an_email", "academic_discussion", "take_an_interview"].includes(a.task_type));
  const evaluateAll = async () => {
    for (let i = 0; i < pendingProductive.length; i++) {
      setEvalState(`Evaluating ${i + 1}/${pendingProductive.length}…`);
      try {
        await api.post(`/api/attempts/${pendingProductive[i]!.id}/evaluate`);
      } catch (e) {
        setEvalState(`Error: ${(e as Error).message}`);
        return;
      }
    }
    setEvalState(null);
    await reload();
  };
  return (
    <div className="space-y-5">
      <PageTitle title={`Simulation results — ${data.simulation.scope} (${data.simulation.length === "full" ? "official format" : "short"})`} sub={r?.disclaimer} />
      {r?.overall && (
        <div className="card p-5">
          <div className="label">Internal projected overall</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-4xl font-semibold tabular-nums">{band(r.overall.band)}</span>
            {r.overall.range && <span className="text-sm text-zinc-500">range {band(r.overall.range[0])}–{band(r.overall.range[1])}</span>}
            <ConfidenceTag c={r.overall.confidence} />
          </div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(r?.sections ?? {}).map(([s, e]) => {
          const route = data.simulation.steps.find((x) => x.section === s && x.route)?.route;
          return (
            <div key={s} className="card p-5">
              <div className="label">{SECTION_LABEL[s]}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums">{band(e.band)}</span>
                {e.range && <span className="text-xs text-zinc-500">{band(e.range[0])}–{band(e.range[1])}</span>}
                <ConfidenceTag c={e.confidence} />
              </div>
              <p className="mt-1 text-xs text-zinc-500">{e.evidence}</p>
              {route && (
                <p className="mt-2 text-xs text-zinc-600">
                  Module 1: {route.correct}/{route.total} ({pct(route.proportion)}) → Module 2 <b>{route.route}</b> · internal threshold {pct(route.threshold)} (not an ETS value)
                </p>
              )}
            </div>
          );
        })}
      </div>
      {pendingProductive.length > 0 && (
        <Notice tone="warn">
          {pendingProductive.length} productive response(s) are not scored yet, so Writing/Speaking estimates are incomplete.{" "}
          {cfg?.providers.llm.configured ? (
            <button className="btn ml-2 py-1" disabled={!!evalState} onClick={evaluateAll}>
              {evalState ?? "Evaluate now"}
            </button>
          ) : (
            "Configure ANTHROPIC_API_KEY to evaluate them, or self-rate speaking items from their review pages."
          )}
        </Notice>
      )}
      <div className="card divide-y divide-zinc-100">
        {data.attempts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
            <span className="w-40 text-zinc-500">{a.module_stage?.replace(":", " · ")}</span>
            <span className="flex-1">{TASK_LABEL[a.task_type as keyof typeof TASK_LABEL]}</span>
            <span className="w-28 text-right tabular-nums">
              {a.raw_score == null ? "pending" : `${+a.raw_score.toFixed(2)}/${a.max_score}`}
              {a.timed_out ? " ⏱" : ""}
            </span>
            <Link to={`/u/${user}/review/${a.id}`} className="text-accent underline">
              review
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
