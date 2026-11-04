import { useEffect, useState } from "react";
import { useApi } from "../lib/useApi";
import { Link, useRouter } from "../lib/router";
import { TASK_ORDER, TASK_HINT, SECTION_LABEL, SECTION_ORDER, pct, ago } from "../lib/format";
import { Spinner, ErrorBox, PageTitle } from "../components/ui";
import { TASK_LABEL, TASK_SECTION, type TaskType } from "../../../shared/schema";

export type Mode = "strict" | "practice";

export function useMode(): [Mode, (m: Mode) => void] {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return (localStorage.getItem("toefl.mode") as Mode) || "strict";
    } catch {
      return "strict";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("toefl.mode", mode);
    } catch {
      /* ignore */
    }
  }, [mode]);
  return [mode, setMode];
}

export function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="inline-flex rounded-md border border-zinc-300 p-0.5 text-[13px]" role="radiogroup" aria-label="Mode">
        {(["strict", "practice"] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`rounded px-3 py-1 ${mode === m ? "bg-zinc-900 text-white" : "text-zinc-600"}`}>
            {m === "strict" ? "Strict" : "Practice"}
          </button>
        ))}
      </div>
      <span className="hidden text-xs text-zinc-500 md:inline">
        {mode === "strict" ? "Hard timer, auto-submit, audio once, no answers until submitted." : "Soft timer, replay allowed, no auto-submit."}
      </span>
    </div>
  );
}

interface TaskRow {
  task_type: TaskType;
  label: string;
  section: string;
  count: number;
}
interface Metric {
  task_type: TaskType;
  attempts: number;
  recent_accuracy: number | null;
  last_practiced: string | null;
}

export function Practice({ user }: { user: string }) {
  const [mode, setMode] = useMode();
  const tasks = useApi<TaskRow[]>("/api/task-types");
  const prog = useApi<{ metrics: Metric[] }>(`/api/users/${user}/progress`);
  if (tasks.loading) return <Spinner />;
  if (tasks.error) return <ErrorBox error={tasks.error} />;
  const metric = new Map((prog.data?.metrics ?? []).map((m) => [m.task_type, m]));
  return (
    <div>
      <PageTitle title="Quick drill" sub="Pick a task type and start immediately." right={<ModeToggle mode={mode} setMode={setMode} />} />
      <div className="grid gap-5 md:grid-cols-2">
        {SECTION_ORDER.map((s) => (
          <div key={s} className="card">
            <div className="border-b border-zinc-100 px-4 py-2.5 text-sm font-semibold">{SECTION_LABEL[s]}</div>
            <div className="divide-y divide-zinc-100">
              {TASK_ORDER.filter((t) => TASK_SECTION[t] === s).map((t) => {
                const m = metric.get(t);
                const row = tasks.data?.find((x) => x.task_type === t);
                return (
                  <div key={t} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link to={`/u/${user}/practice/${t}`} className="text-[14px] font-medium text-zinc-900 hover:underline">
                        {TASK_LABEL[t]}
                      </Link>
                      <div className="text-xs text-zinc-500">{TASK_HINT[t]}</div>
                      <div className="text-[11px] text-zinc-400">
                        {row?.count ?? 0} exercises · {m?.attempts ? `${m.attempts} done · recent ${pct(m.recent_accuracy)} · ${ago(m.last_practiced)}` : "not practised yet"}
                      </div>
                    </div>
                    <NextButton user={user} task={t} mode={mode} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NextButton({ user, task, mode }: { user: string; task: TaskType; mode: Mode }) {
  const [busy, setBusy] = useState(false);
  const { navigate } = useRouter();
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await fetch(`/api/users/${user}/next?taskType=${task}`).then((x) => x.json());
        setBusy(false);
        if (r.exercise_id) navigate(`/u/${user}/drill/${r.exercise_id}?mode=${mode}`);
      }}
    >
      Start
    </button>
  );
}

interface ExRow {
  id: string;
  title: string;
  difficulty: string;
  items: number;
  drill_seconds: number | null;
  attempts: number;
  best: number | null;
  last: string | null;
  source_type: string;
}

export function PracticeTask({ user, task }: { user: string; task: string }) {
  const [mode, setMode] = useMode();
  const { data, error, loading } = useApi<ExRow[]>(`/api/exercises?taskType=${task}&userId=${user}`);
  const label = TASK_LABEL[task as TaskType] ?? task;
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div>
      <PageTitle
        title={label}
        sub={
          <>
            <Link to={`/u/${user}/practice`} className="underline">
              All tasks
            </Link>{" "}
            · {TASK_HINT[task as TaskType]}
          </>
        }
        right={<ModeToggle mode={mode} setMode={setMode} />}
      />
      <div className="card divide-y divide-zinc-100">
        {data?.map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium capitalize text-zinc-900">{e.title}</div>
              <div className="text-xs text-zinc-500">
                <span className="chip mr-2">{e.difficulty}</span>
                {e.items} item{e.items > 1 ? "s" : ""}
                {e.drill_seconds ? ` · ${Math.floor(e.drill_seconds / 60)}:${String(e.drill_seconds % 60).padStart(2, "0")} training limit` : ""} · {e.id}
              </div>
            </div>
            <div className="w-36 text-right text-xs text-zinc-500">{e.attempts ? `${e.attempts}× · best ${pct(e.best)} · ${ago(e.last)}` : "new"}</div>
            <Link to={`/u/${user}/drill/${e.id}?mode=${mode}`} className="btn">
              {e.attempts ? "Retry" : "Start"}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
