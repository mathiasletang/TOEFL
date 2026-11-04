/**
 * Shared countdown state machine used by every timed task, drill and module.
 * Deterministic: remaining time is always derived from an absolute deadline
 * (server clock corrected by an offset), never from accumulated ticks.
 */
import { useEffect, useReducer, useRef } from "react";

export type TimerStatus = "idle" | "running" | "expired" | "stopped";

export interface TimerState {
  status: TimerStatus;
  deadline: number | null; // epoch ms, client clock
  now: number;
  expiredFired: boolean;
}

export type TimerAction =
  | { type: "start"; deadline: number; now: number }
  | { type: "tick"; now: number }
  | { type: "stop"; now: number }
  | { type: "ack_expired" };

export const initialTimer: TimerState = { status: "idle", deadline: null, now: 0, expiredFired: false };

export function timerReducer(s: TimerState, a: TimerAction): TimerState {
  switch (a.type) {
    case "start":
      if (s.status === "stopped" && s.deadline === a.deadline) return s;
      return { status: a.now >= a.deadline ? "expired" : "running", deadline: a.deadline, now: a.now, expiredFired: s.deadline === a.deadline ? s.expiredFired : false };
    case "tick":
      if (s.status !== "running" || s.deadline == null) return { ...s, now: a.now };
      return a.now >= s.deadline ? { ...s, status: "expired", now: a.now } : { ...s, now: a.now };
    case "stop":
      return { ...s, status: "stopped", now: a.now };
    case "ack_expired":
      return { ...s, expiredFired: true };
  }
}

export function remainingMs(s: TimerState): number | null {
  if (s.deadline == null) return null;
  return Math.max(0, s.deadline - s.now);
}

export function formatClock(ms: number | null): string {
  if (ms == null) return "--:--";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Server-time correction: pass server_now from any API response. */
export function clockOffset(serverNowIso: string | undefined): number {
  return serverNowIso ? Date.parse(serverNowIso) - Date.now() : 0;
}

/**
 * React hook. `deadlineIso` is a server timestamp; `offset` converts it to client time.
 * `onExpire` fires exactly once per deadline.
 */
export function useCountdown(deadlineIso: string | null | undefined, offset: number, onExpire?: () => void, stopped = false) {
  const [state, dispatch] = useReducer(timerReducer, initialTimer);
  const cb = useRef(onExpire);
  cb.current = onExpire;
  useEffect(() => {
    if (!deadlineIso) return;
    dispatch({ type: "start", deadline: Date.parse(deadlineIso) - offset, now: Date.now() });
    const id = window.setInterval(() => dispatch({ type: "tick", now: Date.now() }), 250);
    return () => window.clearInterval(id);
  }, [deadlineIso, offset]);
  useEffect(() => {
    if (stopped) dispatch({ type: "stop", now: Date.now() });
  }, [stopped]);
  useEffect(() => {
    if (state.status === "expired" && !state.expiredFired) {
      dispatch({ type: "ack_expired" });
      cb.current?.();
    }
  }, [state.status, state.expiredFired]);
  return { ...state, remaining: remainingMs(state) };
}

/** Simple per-window countdown (speaking response windows), same reducer. */
export function windowDeadline(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
