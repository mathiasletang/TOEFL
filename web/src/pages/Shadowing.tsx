import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Link, useRouter } from "../lib/router";
import { speakText, type Playback } from "../lib/audio";
import { ErrorBox, Notice, PageTitle, Spinner } from "../components/ui";

interface Segment {
  id: string;
  exercise_id: string;
  text: string;
  words: number;
  source: string;
  url: string | null;
}
interface Session {
  date: string;
  minutes: number;
  instruction: string;
  no_repeat_days: number;
  pool: number;
  per_session: number;
  repeats: number;
  audio: "tts" | "browser";
  segments: Segment[];
}

/** Daily shadowing: short segments from listening scripts, never repeated within the no-repeat window. */
export function Shadowing({ user }: { user: string }) {
  const { data, error, loading } = useApi<Session>(`/api/users/${user}/shadowing`);
  const { navigate } = useRouter();
  const [plays, setPlays] = useState<Record<string, number>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const current = useRef<Playback | null>(null);
  useEffect(() => () => current.current?.cancel(), []);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const play = async (s: Segment) => {
    current.current?.cancel();
    setAudioError(null);
    setPlaying(s.id);
    const p = speakText(s.text, s.url);
    current.current = p;
    try {
      const r = await p.done;
      if (!r.cancelled) setPlays((x) => ({ ...x, [s.id]: (x[s.id] ?? 0) + 1 }));
    } catch (e) {
      setAudioError(e instanceof Error ? e.message : "Audio unavailable");
    } finally {
      setPlaying((id) => (id === s.id ? null : id));
    }
  };
  const finish = async () => {
    await api.put(`/api/users/${user}/plan/checks`, { date: data.date, block: "shadowing", done: true });
    navigate(`/u/${user}`);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="Shadowing"
        sub={`${data.minutes} minutes · ${data.segments.length} segments from conversations and academic talks · none repeats within ${data.no_repeat_days} days`}
        right={
          <Link to={`/u/${user}`} className="btn btn-ghost">
            Dashboard
          </Link>
        }
      />
      <Notice>{data.instruction}</Notice>
      {data.audio === "browser" && <p className="mt-2 text-xs text-zinc-500">Audio: browser speech synthesis (no TTS key configured) — a fallback, not ETS-like audio.</p>}
      {data.repeats > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          The pool ({data.pool} segments) is too small for {data.no_repeat_days} days without repetition: {data.repeats} segment(s) seen recently are reused today.
        </p>
      )}
      {audioError && <p className="mt-2 text-sm text-red-700">{audioError}</p>}
      <ol className="mt-4 space-y-2">
        {data.segments.map((s, i) => (
          <li key={s.id} className="card flex items-start gap-3 p-3">
            <span className="mt-1 w-5 text-right text-xs tabular-nums text-zinc-400">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className={`reading text-[16px] ${hidden[s.id] ? "select-none blur-sm" : ""}`}>{s.text}</p>
              <div className="mt-1 text-xs text-zinc-400">
                {s.source} · {s.words} words · played {plays[s.id] ?? 0}×
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button className="btn py-1 text-xs" onClick={() => play(s)} disabled={playing === s.id}>
                {playing === s.id ? "Playing…" : "▶ Play"}
              </button>
              <button className="btn btn-ghost py-1 text-xs" onClick={() => setHidden((h) => ({ ...h, [s.id]: !h[s.id] }))} aria-pressed={!!hidden[s.id]}>
                {hidden[s.id] ? "Show text" : "Hide text"}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex justify-end">
        <button className="btn btn-primary" onClick={finish}>
          Mark shadowing as done
        </button>
      </div>
    </div>
  );
}
