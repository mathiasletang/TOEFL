import { useApi } from "../lib/useApi";
import { Link } from "../lib/router";
import { band, pct, ago, secs, SECTION_ORDER, SECTION_LABEL } from "../lib/format";
import { Spinner, ErrorBox, PageTitle, Bar, ConfidenceTag } from "../components/ui";
import { BandChart } from "../components/Charts";
import { ERROR_TAG_LABELS } from "../../../shared/errors";
import { TASK_LABEL, type TaskType } from "../../../shared/schema";
import type { ProjectionView } from "./Dashboard";

interface ProgressData {
  projection: ProjectionView;
  metrics: Array<{ task_type: TaskType; label: string; section: string; attempts: number; items: number; recent_accuracy: number | null; ewma: number | null; trend: number | null; mean_seconds_per_item: number | null; target_seconds_per_item: number | null; last_practiced: string | null; timing_violations_7d: number }>;
  weaknesses: Array<{ tag: string; label: string; errors: number; opportunities: number; rate: number }>;
  recommendations: Array<{ task_type: TaskType; label: string; priority: number; reason: string; factors: Record<string, number> }>;
  trends: { projections: Array<{ day: string; overall: number | null; reading: number | null; listening: number | null; writing: number | null; speaking: number | null }> };
  recent_vs_historical: Array<{ task_type: TaskType; label: string; recent: number | null; recent_n: number; earlier: number | null; earlier_n: number }>;
  ready_gate: { ready: boolean; target: number; checks: Array<{ id: string; label: string; status: string; detail: string }>; note: string };
  attempts: Array<{ id: string; task_type: TaskType; exercise_id: string; mode: string; simulation_id: string | null; submitted_at: string; elapsed_ms: number; raw_score: number | null; max_score: number; accuracy: number | null; pending: number; timed_out: number; timing_violation: number; error_tags: string[] }>;
}

export function Progress({ user }: { user: string }) {
  const { data, error, loading } = useApi<ProgressData>(`/api/users/${user}/progress`);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const g = data.ready_gate;
  return (
    <div className="space-y-5">
      <PageTitle title="Progress" sub="All figures are computed from your stored attempts. Band estimates are internal training projections, not official scores." />

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="label">Readiness gate — target {band(g.target)}</div>
          <span className={`chip ${g.ready ? "border-green-300 bg-green-50 text-green-800" : ""}`}>{g.ready ? "READY" : "NOT READY"}</span>
        </div>
        <div className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
          {g.checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-[13px]">
              <span className={c.status === "pass" ? "text-green-700" : c.status === "fail" ? "text-red-700" : "text-zinc-400"}>{c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "○"}</span>
              <span className="flex-1">
                {c.label}
                <span className="ml-2 text-xs text-zinc-500">{c.detail}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-zinc-400">{g.note}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {SECTION_ORDER.map((s) => {
          const e = data.projection.sections[s]!;
          return (
            <div key={s} className="card p-4">
              <div className="label">{SECTION_LABEL[s]}</div>
              <div className="text-2xl font-semibold tabular-nums">{band(e.band)}</div>
              <ConfidenceTag c={e.confidence} />
              <p className="mt-1 text-[11px] text-zinc-400">{e.evidence}</p>
            </div>
          );
        })}
      </div>

      <div className="card p-5">
        <div className="label mb-3">Projected bands over time</div>
        <BandChart points={data.trends.projections} target={data.projection.target_band} />
      </div>

      <div className="card overflow-x-auto p-5">
        <div className="label mb-3">Task metrics</div>
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-1">Task</th>
              <th>Attempts</th>
              <th>Recent (30 items)</th>
              <th className="w-28" />
              <th>EWMA</th>
              <th>Trend</th>
              <th>Speed / item</th>
              <th>Last</th>
            </tr>
          </thead>
          <tbody>
            {data.metrics.map((m) => (
              <tr key={m.task_type} className="border-t border-zinc-100">
                <td className="py-1.5">
                  <Link to={`/u/${user}/practice/${m.task_type}`} className="hover:underline">
                    {m.label}
                  </Link>
                </td>
                <td className="tabular-nums">{m.attempts}</td>
                <td className="tabular-nums">{pct(m.recent_accuracy)}</td>
                <td>
                  <Bar value={m.recent_accuracy} tone={m.recent_accuracy == null ? "dark" : m.recent_accuracy >= 0.9 ? "ok" : m.recent_accuracy >= 0.7 ? "warn" : "bad"} />
                </td>
                <td className="tabular-nums">{pct(m.ewma)}</td>
                <td className={`tabular-nums ${m.trend == null ? "" : m.trend > 0 ? "text-green-700" : "text-red-700"}`}>{m.trend == null ? "—" : `${m.trend > 0 ? "+" : ""}${(m.trend * 100).toFixed(0)} pts`}</td>
                <td className={`tabular-nums ${m.mean_seconds_per_item && m.target_seconds_per_item && m.mean_seconds_per_item > m.target_seconds_per_item ? "text-amber-700" : ""}`}>
                  {m.mean_seconds_per_item == null ? "—" : `${m.mean_seconds_per_item.toFixed(0)} s`}
                  {m.target_seconds_per_item ? <span className="text-zinc-400"> / {m.target_seconds_per_item} s</span> : null}
                </td>
                <td className="text-xs text-zinc-500">{ago(m.last_practiced)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="label mb-3">Critical path — where the next hour should go</div>
          <div className="space-y-2">
            {data.recommendations.slice(0, 6).map((r, i) => (
              <div key={r.task_type} className="text-[13px]">
                <div className="flex justify-between">
                  <span className="font-medium">
                    {i + 1}. {r.label}
                  </span>
                  <span className="tabular-nums text-zinc-500">{(r.priority * 100).toFixed(0)}</span>
                </div>
                <div className="text-xs text-zinc-500">{r.reason}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-zinc-400">priority = 0.40·error frequency + 0.25·recency + 0.20·band impact + 0.15·speed deficit (internal heuristic, not a calibrated probability)</p>
        </div>
        <div className="card p-5">
          <div className="label mb-3">Recent 14 days vs before</div>
          <table className="w-full text-[13px]">
            <tbody>
              {data.recent_vs_historical
                .filter((r) => r.recent_n + r.earlier_n > 0)
                .map((r) => (
                  <tr key={r.task_type} className="border-t border-zinc-100">
                    <td className="py-1.5">{r.label}</td>
                    <td className="tabular-nums text-zinc-500">{pct(r.earlier)}</td>
                    <td className="text-zinc-300">→</td>
                    <td className="tabular-nums font-medium">{pct(r.recent)}</td>
                    <td className="text-right text-xs text-zinc-400">
                      n={r.earlier_n}/{r.recent_n}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {data.recent_vs_historical.every((r) => r.recent_n + r.earlier_n === 0) && <p className="text-sm text-zinc-500">No data yet.</p>}
        </div>
      </div>

      <div className="card overflow-x-auto p-5">
        <div className="label mb-3">History (last 100 attempts)</div>
        <table className="w-full min-w-[720px] text-[13px]">
          <tbody>
            {data.attempts.map((a) => (
              <tr key={a.id} className="border-t border-zinc-100">
                <td className="py-1.5 text-xs text-zinc-500">{new Date(a.submitted_at).toLocaleString()}</td>
                <td>{TASK_LABEL[a.task_type]}</td>
                <td className="text-xs text-zinc-500">{a.simulation_id ? "simulation" : a.mode}</td>
                <td className="tabular-nums">{a.raw_score == null ? <span className="text-amber-700">pending</span> : `${+a.raw_score.toFixed(2)}/${a.max_score}`}</td>
                <td className="tabular-nums text-zinc-500">{secs(a.elapsed_ms)}</td>
                <td className="text-xs text-zinc-500">
                  {a.error_tags.slice(0, 3).map((t) => ERROR_TAG_LABELS[t] ?? t).join(", ")}
                  {a.timed_out ? " · auto-submitted" : ""}
                </td>
                <td className="text-right">
                  <Link to={`/u/${user}/review/${a.id}`} className="text-accent underline">
                    review
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.attempts.length === 0 && <p className="text-sm text-zinc-500">No attempts yet.</p>}
      </div>
    </div>
  );
}
