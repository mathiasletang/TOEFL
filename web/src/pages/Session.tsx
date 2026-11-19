import { useState } from "react";
import { useApi } from "../lib/useApi";
import { Link, useRouter } from "../lib/router";
import { Spinner, ErrorBox, Notice } from "../components/ui";
import { IconArrowLeft, IconArrowRight, IconCheck } from "../components/icons";
import { launchBlock, sessionSteps, setStepDone, type Plan, type PlanBlock } from "../lib/today";

/** Today's session, one step at a time: open the step, then mark it done to move on. */
export function Session({ user }: { user: string }) {
  const { data, error, reload, setData } = useApi<Plan>(`/api/users/${user}/plan`);
  const { navigate } = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const back = (
    <Link to={`/u/${user}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-dim hover:text-text">
      <IconArrowLeft size={16} /> Today
    </Link>
  );
  if (data.status !== "active")
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <Notice>There is no session today: {data.status === "exam_day" ? "it is exam day." : "set your exam date in Settings first."}</Notice>
      </div>
    );
  const { base, bonus, baseDone, current } = sessionSteps(data);
  const steps = bonus ? [...base, bonus] : base;
  const index = current ? steps.indexOf(current) : -1;

  const finish = async (b: PlanBlock) => {
    setBusy(true);
    setErr(null);
    try {
      setData(await setStepDone(user, data.date, b.id, true));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const open = async (b: PlanBlock) => {
    setBusy(true);
    setErr(await launchBlock(user, b.launch, navigate));
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {back}
      <div className="flex gap-1.5" role="img" aria-label={`${steps.filter((s) => s.done).length} of ${steps.length} steps done`}>
        {steps.map((b) => (
          <span key={b.id} className={`h-2.5 flex-1 rounded-full ${b.done ? "bg-accent" : b === current ? "bg-ring" : "bg-line"}`} />
        ))}
      </div>

      {current ? (
        <section className="card p-6 sm:p-8" aria-labelledby="step-title">
          <div className="label">
            {current === bonus ? "Bonus round" : `Step ${index + 1} of ${base.length}`}
            {current.mode === "practice" && " · clock hidden"}
          </div>
          <h1 id="step-title" className="mt-2 text-2xl font-black tracking-tight">
            {current.label}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {[current.detail, current.items != null && current.launch?.kind !== "simulation" ? `${current.items} ${current.items === 1 ? "exercise" : "exercises"}` : null, current.minutes?.total != null ? `≈ ${current.minutes.total} min` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {current.diagnostic && (
            <div className="mt-4">
              <Notice tone="warn">{current.diagnostic.note}</Notice>
            </div>
          )}
          {current.correction && (
            <ol className="tile mt-4 space-y-1.5 p-5 text-sm text-muted">
              <li>
                <span className="font-extrabold text-text">1. Exercises</span> — ≈ {current.minutes?.work ?? "?"} min
              </li>
              <li>
                <span className="font-extrabold text-text">2. {current.correction.label}</span> — {current.correction.minutes} min. {current.correction.instruction}{" "}
                {current.correction.review_path && (
                  <Link to={`/u/${user}/${current.correction.review_path}`} className="font-bold text-text underline underline-offset-4">
                    Open today's correction
                  </Link>
                )}
              </li>
            </ol>
          )}
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button className="btn btn-primary h-14 rounded-[20px] text-base" disabled={busy || !current.launch} onClick={() => open(current)}>
              {current.launch ? "Open this step" : "No exercise available"} <IconArrowRight size={18} />
            </button>
            <button className="btn h-14 rounded-[20px] text-base" disabled={busy} onClick={() => finish(current)}>
              <IconCheck size={18} /> Done — next step
            </button>
          </div>
          {!baseDone && bonus && <p className="mt-4 text-xs text-dim">A bonus round unlocks once the three base steps are done.</p>}
        </section>
      ) : (
        <section className="card p-6 text-center sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent">
            <IconCheck size={26} />
          </div>
          <h1 className="mt-4 text-2xl font-black">Session complete</h1>
          <p className="mt-1 text-sm text-muted">
            {data.streak} {data.streak === 1 ? "day" : "days"} in a row. See you tomorrow.
          </p>
          <Link to={`/u/${user}`} className="btn mt-5">
            Back to Today
          </Link>
        </section>
      )}
      {err && <p className="text-sm font-semibold text-bad">{err}</p>}

      <ol className="space-y-1 text-sm">
        {steps.map((b, i) => (
          <li key={b.id} className={`flex items-center gap-3 ${b.done ? "text-dim line-through" : b === current ? "font-extrabold text-text" : "text-muted"}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${b.done ? "bg-accent text-on-accent" : b === current ? "border-2 border-accent" : "border border-ring"}`}>
              {b.done ? <IconCheck size={13} /> : b === bonus ? "+" : i + 1}
            </span>
            {b.label}
            {b === bonus && !baseDone && <span className="text-xs font-bold no-underline">(locked)</span>}
          </li>
        ))}
      </ol>
      <p className="text-xs text-dim">Steps are marked done by you, as on the Today page. Internal training schedule, not an ETS recommendation.</p>
    </div>
  );
}
