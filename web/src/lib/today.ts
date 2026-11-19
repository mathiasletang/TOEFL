/** Types and helpers shared by the Today page, the session runner and Progress. Data comes from the existing endpoints. */
import { api } from "./api";

export interface SectionEst {
  section: string;
  band: number | null;
  range: [number, number] | null;
  confidence: string;
  evidence: string;
  n: number;
  min_n?: number;
}
export interface ProjectionView {
  target_band: number;
  sections: Record<string, SectionEst>;
  overall: { band: number | null; mean: number | null; range: [number, number] | null; cefr: string | null; confidence: string };
  threshold: { target: number; minimum_mean: number; minimum_sum: number; current_sum: number | null; gap_sum: number | null };
  disclaimer: string;
}

export type Launch =
  | { kind: "drill"; exercise_id: string; mode: "strict" | "practice"; origin: "focus" | null }
  | { kind: "simulation"; scope: string; length: "full" | "short" }
  | { kind: "vocab" }
  | { kind: "shadowing" }
  | null;

export interface PlanBlock {
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

export interface Plan {
  date: string;
  status: "no_exam_date" | "exam_day" | "past" | "active";
  exam_date: string | null;
  target_band: number;
  days_left: number | null;
  streak: number;
  phase: { id: string; label: string; goal: string; from_days: number | null; to_days: number } | null;
  blocks: PlanBlock[];
  optional?: PlanBlock | null;
  checkpoint: { days_before: number; label: string; task: string; date: string; in_days: number } | null;
  base_done?: boolean;
  week_days: { start: string; today: string; done: string[] };
  road?: {
    start: string;
    exam_date: string;
    done: string[];
    phases: Array<{ id: string; label: string; from: string; to: string }>;
    checkpoints: Array<{ date: string; label: string; days_before: number }>;
  };
}

export interface OfficialScore {
  id: string;
  taken_on: string;
  reading: number;
  listening: number;
  writing: number;
  speaking: number;
  overall: number;
  created_at: string;
}

/** Calendar helpers on YYYY-MM-DD strings (local days, noon to avoid DST edges). */
export const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const localToday = () => addDays(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`, 0);
export const daysFrom = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86400000);
export const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", opts);

/** Steps of the day: the base blocks, then the bonus round (unlocked once the base is done). */
export function sessionSteps(p: Plan) {
  const base = p.blocks;
  const bonus = p.optional ?? null;
  const baseDone = base.length > 0 && base.every((b) => b.done);
  const current = base.find((b) => !b.done) ?? (bonus && !bonus.done ? bonus : null);
  return { base, bonus, baseDone, current, doneCount: base.filter((b) => b.done).length };
}

/** Opens what a plan block launches. Returns an error message, or null. */
export async function launchBlock(user: string, l: Launch, navigate: (to: string) => void): Promise<string | null> {
  if (!l) return null;
  if (l.kind === "vocab") return navigate(`/u/${user}/vocab/session`), null;
  if (l.kind === "shadowing") return navigate(`/u/${user}/shadowing`), null;
  if (l.kind === "drill") return navigate(`/u/${user}/drill/${l.exercise_id}?mode=${l.mode}${l.origin === "focus" ? "&from=focus" : ""}`), null;
  try {
    const v = await api.post<{ simulation: { id: string } }>("/api/simulations", { userId: user, scope: l.scope, length: l.length });
    navigate(`/u/${user}/sim/${v.simulation.id}`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Could not start the simulation";
  }
}

export const setStepDone = (user: string, date: string, block: string, done: boolean) => api.put<Plan>(`/api/users/${user}/plan/checks`, { date, block, done });
