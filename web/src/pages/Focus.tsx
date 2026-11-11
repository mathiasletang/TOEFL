import { useApi } from "../lib/useApi";
import { Link } from "../lib/router";
import { Spinner, ErrorBox, PageTitle, Notice, Bar } from "../components/ui";
import { pct, ago } from "../lib/format";
import { useMode, ModeToggle } from "./Practice";
import { TASK_LABEL, type TaskType } from "../../../shared/schema";

interface FocusData {
  exercise_id: string | null;
  task_type?: TaskType;
  reason: string;
  weakness?: { tag: string; label: string; errors: number; opportunities: number } | null;
}
interface W {
  tag: string;
  label: string;
  errors: number;
  opportunities: number;
  rate: number;
  last_seen: string;
  task_types: TaskType[];
  sources?: string[];
}

export function Focus({ user }: { user: string }) {
  const [mode, setMode] = useMode();
  const f = useApi<FocusData>(`/api/users/${user}/focus`);
  const prog = useApi<{ weaknesses: W[] }>(`/api/users/${user}/progress`);
  if (f.loading) return <Spinner />;
  if (f.error) return <ErrorBox error={f.error} />;
  return (
    <div className="space-y-5">
      <PageTitle title="Focus weaknesses" sub="Error-driven selection: your most costly recurring mistakes first, with spaced retries of failed exercises." right={<ModeToggle mode={mode} setMode={setMode} />} />
      {f.data?.exercise_id ? (
        <div className="card p-6">
          <div className="label mb-1">Next targeted exercise</div>
          <div className="text-lg font-semibold">{f.data.task_type ? TASK_LABEL[f.data.task_type] : ""}</div>
          <p className="mt-1 text-sm text-zinc-600">{f.data.reason}</p>
          <div className="mt-4 flex gap-2">
            <Link to={`/u/${user}/drill/${f.data.exercise_id}?mode=${mode}`} className="btn btn-primary">
              Start
            </Link>
            <button className="btn" onClick={f.reload}>
              Refresh
            </button>
          </div>
        </div>
      ) : (
        <Notice>{f.data?.reason ?? "No recommendation yet."}</Notice>
      )}
      <div className="card p-5">
        <div className="label mb-3">Error profile — last 30 days</div>
        {!prog.data?.weaknesses.length ? (
          <p className="text-sm text-zinc-500">No errors recorded yet.</p>
        ) : (
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-1">Pattern</th>
                <th>Rate</th>
                <th className="w-32" />
                <th>Errors</th>
                <th>Tasks</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {prog.data.weaknesses.map((w) => (
                <tr key={w.tag} className="border-t border-zinc-100">
                  <td className="py-1.5 font-medium">{w.label}</td>
                  <td className="tabular-nums">{pct(w.rate)}</td>
                  <td>
                    <Bar value={w.rate} tone={w.rate > 0.4 ? "bad" : "warn"} />
                  </td>
                  <td className="tabular-nums text-zinc-600">
                    {w.errors}/{w.opportunities}
                  </td>
                  <td className="text-xs text-zinc-500">{[...w.task_types.map((t) => TASK_LABEL[t]), ...(w.sources ?? []).map((x) => (x === "vocabulary" ? "Vocabulary reviews" : x))].join(", ")}</td>
                  <td className="text-xs text-zinc-500">{ago(w.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
