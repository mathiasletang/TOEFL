import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useRouter, Link } from "../lib/router";
import { useCountdown, clockOffset } from "../lib/timer";
import { Spinner, ErrorBox, TimerBadge, Notice } from "../components/ui";
import { TaskView, cleanResponse, isSpeaking } from "../tasks";
import { TASK_LABEL } from "../../../shared/schema";
import type { PublicExercise } from "../../../shared/publicView";
import type { ReviewData } from "../tasks/Review";

interface SessionView {
  session: { id: string; mode: "strict" | "practice"; status: string; exercise_id: string; time_limit_ms: number | null; started_at: string; deadline_at: string | null; state: { response?: unknown } };
  exercise: PublicExercise;
  timer_starts_after_audio: boolean;
  server_now: string;
}

export function Drill({ user, exerciseId }: { user: string; exerciseId: string }) {
  const { search, navigate } = useRouter();
  const mode = (search.get("mode") === "practice" ? "practice" : "strict") as "strict" | "practice";
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [response, setResponse] = useState<unknown>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [overtime, setOvertime] = useState(false);
  const [offset, setOffset] = useState(0);
  const respRef = useRef<unknown>(undefined);
  respRef.current = response;
  const submitted = useRef(false);

  // Create or resume the session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const act = await api.get<{ active: (SessionView & { expired_attempt_id?: undefined }) | { expired_attempt_id: string } | null }>(`/api/users/${user}/active-session`);
        if (cancelled) return;
        if (act.active && "expired_attempt_id" in act.active && act.active.expired_attempt_id) {
          navigate(`/u/${user}/review/${act.active.expired_attempt_id}?expired=1`, true);
          return;
        }
        let v: SessionView;
        if (act.active && "session" in act.active && act.active.session.exercise_id === exerciseId && act.active.session.mode === mode) v = act.active;
        else v = await api.post<SessionView>("/api/sessions", { userId: user, exerciseId, mode });
        if (cancelled) return;
        setOffset(clockOffset(v.server_now));
        setView(v);
        setResponse(v.session.state?.response);
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, exerciseId, mode, navigate]);

  const elapsed = useCallback(() => (view ? Date.now() + offset - Date.parse(view.session.started_at) : 0), [view, offset]);

  // Autosave (debounced) — survives refresh.
  useEffect(() => {
    if (!view || response === undefined || submitted.current) return;
    const id = window.setTimeout(() => {
      api.put(`/api/sessions/${view.session.id}/state`, { state: { response, elapsedMs: elapsed() } }).catch(() => {});
    }, 700);
    return () => window.clearTimeout(id);
  }, [response, view, elapsed]);

  const submit = useCallback(
    async (timedOut = false) => {
      if (!view || submitted.current) return;
      submitted.current = true;
      setSubmitting(true);
      try {
        const r = await api.post<ReviewData>(`/api/sessions/${view.session.id}/submit`, { response: cleanResponse(respRef.current ?? null), elapsedMs: Math.max(0, elapsed()), timedOut });
        navigate(`/u/${user}/review/${r.attempt.id}`, true);
      } catch (e) {
        submitted.current = false;
        setSubmitting(false);
        setError(e);
      }
    },
    [view, elapsed, navigate, user],
  );

  const onExpire = useCallback(() => {
    if (view?.session.mode === "strict") void submit(true);
    else setOvertime(true);
  }, [view, submit]);

  const timer = useCountdown(view?.session.deadline_at, offset, onExpire, submitting);

  const onAudioDone = useCallback(async () => {
    if (!view || view.session.deadline_at || !view.timer_starts_after_audio) return;
    const v = await api.post<SessionView>(`/api/sessions/${view.session.id}/start-timer`);
    setOffset(clockOffset(v.server_now));
    setView((cur) => (cur ? { ...cur, session: { ...cur.session, deadline_at: v.session.deadline_at }, server_now: v.server_now } : cur));
  }, [view]);

  if (error) return <ErrorBox error={error} />;
  if (!view) return <Spinner label="Preparing exercise…" />;
  const ex = view.exercise;
  const strict = view.session.mode === "strict";
  const speaking = isSpeaking(ex.task_type);
  const locked = strict && timer.status === "expired";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{TASK_LABEL[ex.task_type]}</h1>
            <span className={`chip ${strict ? "border-zinc-800 bg-zinc-900 text-white" : ""}`}>{strict ? "strict" : "practice"}</span>
            <span className="chip">{ex.difficulty}</span>
          </div>
          <div className="text-xs text-zinc-400">{ex.id}</div>
        </div>
        <div className="flex items-center gap-3">
          {view.session.time_limit_ms != null &&
            (view.session.deadline_at ? (
              <TimerBadge remaining={timer.remaining} total={view.session.time_limit_ms} label={strict ? "" : "soft"} />
            ) : (
              <span className="text-xs text-zinc-400">Timer starts after the audio</span>
            ))}
          {!speaking && (
            <button className="btn btn-primary" disabled={submitting} onClick={() => void submit(false)}>
              {submitting ? "Submitting…" : "Submit"}
            </button>
          )}
          <Link
            to={`/u/${user}/practice/${ex.task_type}`}
            className="btn btn-ghost text-zinc-500"
            title="Leave without submitting"
          >
            Leave
          </Link>
        </div>
      </div>
      {overtime && !strict && <Notice tone="warn">Time is up (practice mode — no auto-submit). In the real test your answer would have been submitted now.</Notice>}
      <TaskView ex={ex} value={response} onChange={setResponse} ctx={{ userId: user, sessionId: view.session.id, strict, locked, onAudioDone, onComplete: () => void submit(false) }} />
      {submitting && <Spinner label="Scoring…" />}
    </div>
  );
}
