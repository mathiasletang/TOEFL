import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Link, useRouter } from "../lib/router";
import { Spinner, ErrorBox, Notice } from "../components/ui";
import { ReviewView, type ReviewData } from "../tasks/Review";
import { TASK_LABEL, type TaskType } from "../../../shared/schema";
import { useMode } from "./Practice";
import { WordPicker } from "../components/WordPicker";

export function ReviewPage({ user, attemptId }: { user: string; attemptId: string }) {
  const { data, error, loading, setData } = useApi<ReviewData>(`/api/attempts/${attemptId}`);
  const { search, navigate } = useRouter();
  const [mode] = useMode();
  const [picking, setPicking] = useState(false);
  const [next, setNext] = useState<{ same: string | null; focus: { exercise_id: string | null; reason: string } | null }>({ same: null, focus: null });
  useEffect(() => {
    if (!data) return;
    const t = data.exercise.task_type;
    Promise.all([
      api.get<{ exercise_id: string | null }>(`/api/users/${user}/next?taskType=${t}&exclude=${data.exercise.id}`).catch(() => ({ exercise_id: null })),
      api.get<{ exercise_id: string | null; reason: string }>(`/api/users/${user}/focus`).catch(() => null),
    ]).then(([s, f]) => setNext({ same: s.exercise_id, focus: f }));
  }, [data, user]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const t = data.exercise.task_type as TaskType;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3">
        <div>
          <h1 className="text-lg font-semibold">Review · {TASK_LABEL[t]}</h1>
          <div className="text-xs text-zinc-400">{data.exercise.id}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={`btn ${picking ? "border-accent text-accent" : ""}`} aria-pressed={picking} onClick={() => setPicking(!picking)} title="Click any word of the correction to add it to your vocabulary deck">
            {picking ? "Adding words: on" : "Add words to vocabulary"}
          </button>
          {data.attempt.simulation_id ? (
            <Link to={`/u/${user}/sim/${data.attempt.simulation_id}/results`} className="btn">
              Back to simulation results
            </Link>
          ) : (
            <>
              {next.same && (
                <button className="btn btn-primary" onClick={() => navigate(`/u/${user}/drill/${next.same}?mode=${mode}`)}>
                  Next {TASK_LABEL[t]} →
                </button>
              )}
              {next.focus?.exercise_id && next.focus.exercise_id !== next.same && (
                <button className="btn" title={next.focus.reason} onClick={() => navigate(`/u/${user}/drill/${next.focus!.exercise_id}?mode=${mode}`)}>
                  Next weakness drill
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => navigate(`/u/${user}/drill/${data.exercise.id}?mode=${mode}`)}>
                Retry this one
              </button>
            </>
          )}
        </div>
      </div>
      {search.get("expired") && <Notice tone="warn">Your strict drill expired while the page was closed; it was submitted automatically with the last saved answers.</Notice>}
      {picking && (
        <Notice>
          Click any word below to add it to your vocabulary deck. Words that are not in the bank become personal cards with their sentence. Missed Complete the Words gaps and missed vocabulary questions are added automatically.{" "}
          <Link to={`/u/${user}/vocab/session`} className="underline">
            Go to today's session
          </Link>
        </Notice>
      )}
      <WordPicker user={user} exerciseId={data.exercise.id} enabled={picking}>
        <ReviewView data={data} onReload={setData} />
      </WordPicker>
    </div>
  );
}
