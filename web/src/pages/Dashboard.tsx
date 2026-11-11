import { useApi } from "../lib/useApi";
import { Link } from "../lib/router";
import { band, pct, ago, SECTION_ORDER, SECTION_LABEL } from "../lib/format";
import { Spinner, ErrorBox, ConfidenceTag, Bar, Notice } from "../components/ui";
import { BandChart } from "../components/Charts";
import { cefrForBand, minimumSumFor } from "../../../shared/bands";
import type { TaskType } from "../../../shared/schema";

export interface SectionEst {
  section: string;
  band: number | null;
  range: [number, number] | null;
  confidence: string;
  evidence: string;
  n: number;
}
export interface ProjectionView {
  target_band: number;
  sections: Record<string, SectionEst>;
  overall: { band: number | null; mean: number | null; range: [number, number] | null; cefr: string | null; confidence: string };
  threshold: { target: number; minimum_mean: number; minimum_sum: number; current_sum: number | null; gap_sum: number | null };
  disclaimer: string;
}
interface Rec {
  task_type: TaskType;
  label: string;
  section: string;
  priority: number;
  reason: string;
  exercise_id: string | null;
  focus_tag: string | null;
}
interface Weak {
  tag: string;
  label: string;
  errors: number;
  opportunities: number;
  rate: number;
  last_seen: string;
  task_types: string[];
}
interface Metric {
  task_type: TaskType;
  label: string;
  section: string;
  attempts: number;
  recent_accuracy: number | null;
  trend: number | null;
  last_practiced: string | null;
}
interface DashboardData {
  user: { id: string; target_band: number; exam_date: string | null };
  projection: ProjectionView;
  days_remaining: number | null;
  metrics: Metric[];
  weaknesses: Weak[];
  recommendations: Rec[];
  last_simulation: { id: string; scope: string; length: string; completed_at: string; results: { overall: { band: number | null } | null; sections: Record<string, SectionEst> } | null } | null;
  last_full_simulation: { id: string; completed_at: string; results: { overall: { band: number | null } | null } | null } | null;
  active_simulation: { id: string; scope: string; length: string } | null;
  vocabulary?: { due: number; new_left: number; new_per_day: number; reviewed_today: number; learned: number };
  active_drill: { session?: { exercise_id: string; mode: string } } | { expired_attempt_id: string } | null;
  trends: { projections: Array<{ day: string; overall: number | null; reading: number | null; listening: number | null; writing: number | null; speaking: number | null }> };
  totals: { attempts: number; ms: number };
}

function trendArrow(t: number | null) {
  if (t == null) return null;
  if (t > 0.03) return <span className="text-green-700">↑</span>;
  if (t < -0.03) return <span className="text-red-700">↓</span>;
  return <span className="text-zinc-400">→</span>;
}

export function Dashboard({ user }: { user: string }) {
  const { data, error, loading, reload } = useApi<DashboardData>(`/api/users/${user}/dashboard`);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const p = data.projection;
  const target = p.target_band;
  const top = data.recommendations[0];
  const weak = data.weaknesses[0];
  const minSum = minimumSumFor(target);
  const sectionTrend = (s: string) => {
    const ms = data.metrics.filter((m) => m.section === s && m.trend != null);
    return ms.length ? ms.reduce((a, m) => a + (m.trend ?? 0), 0) / ms.length : null;
  };
  const activeDrill = data.active_drill && "session" in data.active_drill ? data.active_drill.session : null;

  return (
    <div className="space-y-5">
      {(data.active_simulation || activeDrill) && (
        <Notice tone="warn">
          {data.active_simulation && (
            <>
              Unfinished {data.active_simulation.scope} simulation.{" "}
              <Link to={`/u/${user}/sim/${data.active_simulation.id}`} className="font-medium underline">
                Resume
              </Link>
              {"  "}
            </>
          )}
          {activeDrill && (
            <>
              Unfinished {activeDrill.mode} drill.{" "}
              <Link to={`/u/${user}/drill/${activeDrill.exercise_id}?mode=${activeDrill.mode}`} className="font-medium underline">
                Resume
              </Link>
            </>
          )}
        </Notice>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-5">
          <div className="label">Target</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{band(target)}</div>
          <div className="text-xs text-zinc-500">CEFR {cefrForBand(target)} · needs section mean ≥ {(target - 0.25).toFixed(2)}</div>
        </div>
        <div className="card p-5">
          <div className="label">Projected overall</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{band(p.overall.band)}</span>
            {p.overall.range && p.overall.range[0] !== p.overall.range[1] && (
              <span className="text-sm text-zinc-500">
                range {band(p.overall.range[0])}–{band(p.overall.range[1])}
              </span>
            )}
          </div>
          <div className="text-xs">
            <ConfidenceTag c={p.overall.confidence} />
            {p.overall.mean != null && <span className="text-zinc-500"> · mean {p.overall.mean.toFixed(3)}</span>}
          </div>
        </div>
        <div className="card p-5">
          <div className="label">Distance to threshold</div>
          {p.threshold.current_sum == null ? (
            <div className="mt-1 text-sm text-zinc-500">Needs an estimate in all four sections. Sum required: {minSum.toFixed(1)}.</div>
          ) : (
            <>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{p.threshold.gap_sum === 0 ? "reached" : `+${p.threshold.gap_sum!.toFixed(1)}`}</div>
              <div className="text-xs text-zinc-500">
                section sum {p.threshold.current_sum.toFixed(1)} / {minSum.toFixed(1)} needed
              </div>
            </>
          )}
        </div>
        <div className="card p-5">
          <div className="label">Days remaining</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{data.days_remaining ?? "—"}</div>
          <div className="text-xs text-zinc-500">
            {data.user.exam_date ? `exam ${data.user.exam_date}` : <Link to={`/u/${user}/settings`} className="underline">set exam date</Link>}
          </div>
        </div>
      </div>
      {data.vocabulary && (
        <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <div className="label">Vocabulary</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{data.vocabulary.due}</span>
              <span className="text-sm text-zinc-600">card{data.vocabulary.due === 1 ? "" : "s"} due</span>
              <span className="text-sm text-zinc-500">· {data.vocabulary.new_left} new word{data.vocabulary.new_left === 1 ? "" : "s"} left today</span>
            </div>
            <div className="text-xs text-zinc-500">
              {data.vocabulary.reviewed_today} review{data.vocabulary.reviewed_today === 1 ? "" : "s"} today · {data.vocabulary.learned} word{data.vocabulary.learned === 1 ? "" : "s"} in rotation
            </div>
          </div>
          <div className="flex gap-2">
            <Link to={`/u/${user}/vocab/session`} className={`btn ${data.vocabulary.due + data.vocabulary.new_left > 0 ? "btn-primary" : ""}`}>
              {data.vocabulary.due + data.vocabulary.new_left > 0 ? "Start today's session" : "Session done for today"}
            </Link>
            <Link to={`/u/${user}/vocab`} className="btn btn-ghost">
              Browse the bank
            </Link>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="grid divide-y divide-zinc-100 md:grid-cols-4 md:divide-x md:divide-y-0">
          {SECTION_ORDER.map((s) => {
            const e = p.sections[s]!;
            const below = e.band != null && e.band < target - 0.5;
            return (
              <div key={s} className="p-5">
                <div className="flex items-center justify-between">
                  <span className="label">{SECTION_LABEL[s]}</span>
                  {trendArrow(sectionTrend(s))}
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className={`text-2xl font-semibold tabular-nums ${below ? "text-red-700" : ""}`}>{band(e.band)}</span>
                  {e.range && e.range[0] !== e.range[1] && <span className="text-xs text-zinc-500">{band(e.range[0])}–{band(e.range[1])}</span>}
                </div>
                <ConfidenceTag c={e.confidence} />
                <p className="mt-1 text-[11px] leading-snug text-zinc-400">{e.evidence}</p>
              </div>
            );
          })}
        </div>
        <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-2 text-[11px] text-zinc-500">{p.disclaimer}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="label mb-2">Recommended next drill</div>
          {top ? (
            <>
              <div className="text-lg font-semibold">{top.label}</div>
              <p className="mt-1 text-sm text-zinc-600">{top.reason}</p>
              <div className="mt-4 flex gap-2">
                {top.exercise_id && (
                  <Link to={`/u/${user}/drill/${top.exercise_id}?mode=strict`} className="btn btn-primary">
                    Start (strict)
                  </Link>
                )}
                <Link to={`/u/${user}/practice/${top.task_type}`} className="btn">
                  Choose exercise
                </Link>
              </div>
              <div className="mt-4 space-y-1">
                {data.recommendations.slice(1, 4).map((r) => (
                  <div key={r.task_type} className="flex items-center justify-between text-[13px]">
                    <Link to={`/u/${user}/practice/${r.task_type}`} className="text-zinc-700 hover:underline">
                      {r.label}
                    </Link>
                    <span className="text-xs text-zinc-400">priority {(r.priority * 100).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">No exercises available.</p>
          )}
        </div>
        <div className="card p-5">
          <div className="label mb-2">Most critical weakness</div>
          {weak ? (
            <>
              <div className="text-lg font-semibold">{weak.label}</div>
              <p className="mt-1 text-sm text-zinc-600">
                {weak.errors} error(s) in {weak.opportunities} opportunities ({pct(weak.rate)}) · last seen {ago(weak.last_seen)}
              </p>
              <div className="mt-4">
                <Link to={`/u/${user}/focus`} className="btn">
                  Drill this weakness
                </Link>
              </div>
              <div className="mt-4 space-y-1.5">
                {data.weaknesses.slice(1, 5).map((w) => (
                  <div key={w.tag} className="grid grid-cols-[1fr_80px_40px] items-center gap-2 text-[13px]">
                    <span className="truncate text-zinc-700">{w.label}</span>
                    <Bar value={w.rate} tone={w.rate > 0.4 ? "bad" : "warn"} />
                    <span className="text-right text-xs tabular-nums text-zinc-500">{pct(w.rate)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">No recurring errors recorded in the last 30 days. Complete a few drills to build the error profile.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
        <div className="card p-5">
          <div className="label mb-3">Projected band trend</div>
          <BandChart points={data.trends.projections} target={target} />
        </div>
        <div className="card p-5">
          <div className="label mb-2">Last full simulation</div>
          {data.last_full_simulation ? (
            <>
              <div className="text-3xl font-semibold tabular-nums">{band(data.last_full_simulation.results?.overall?.band)}</div>
              <div className="text-xs text-zinc-500">{ago(data.last_full_simulation.completed_at)}</div>
              <Link to={`/u/${user}/sim/${data.last_full_simulation.id}/results`} className="mt-3 inline-block text-sm text-accent underline">
                Open results
              </Link>
            </>
          ) : (
            <p className="text-sm text-zinc-500">None yet.</p>
          )}
          {data.last_simulation && data.last_simulation.id !== data.last_full_simulation?.id && (
            <p className="mt-3 text-xs text-zinc-500">
              Latest: {data.last_simulation.scope} ({data.last_simulation.length}) {ago(data.last_simulation.completed_at)} —{" "}
              <Link to={`/u/${user}/sim/${data.last_simulation.id}/results`} className="underline">
                results
              </Link>
            </p>
          )}
          <Link to={`/u/${user}/simulate`} className="btn mt-4">
            New simulation
          </Link>
          <div className="mt-4 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
            {data.totals.attempts} attempts · {Math.round(data.totals.ms / 60000)} min of timed work
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="label mb-3">Recent performance by task</div>
        <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
          {data.metrics.map((m) => (
            <div key={m.task_type} className="grid grid-cols-[1fr_90px_44px_16px] items-center gap-2 text-[13px]">
              <Link to={`/u/${user}/practice/${m.task_type}`} className="truncate text-zinc-700 hover:underline">
                {m.label}
              </Link>
              <Bar value={m.recent_accuracy} tone={m.recent_accuracy == null ? "dark" : m.recent_accuracy >= 0.9 ? "ok" : m.recent_accuracy >= 0.7 ? "warn" : "bad"} />
              <span className="text-right text-xs tabular-nums text-zinc-500">{m.attempts ? pct(m.recent_accuracy) : "—"}</span>
              {trendArrow(m.trend)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
