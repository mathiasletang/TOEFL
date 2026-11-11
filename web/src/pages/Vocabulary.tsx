import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Link } from "../lib/router";
import { Spinner, ErrorBox, Notice, PageTitle, Bar, Kbd } from "../components/ui";
import { speakText, browserSpeechAvailable, type Playback } from "../lib/audio";
import { Recording, recordingSupported, browserRecognitionSupported, releaseMicrophone } from "../lib/recorder";
import { pct } from "../lib/format";
import { useConfig } from "../lib/config";
import type { VocabEntry } from "../../../shared/vocab";
import type { Format } from "../../../shared/vocabSrs";

// ---------------------------------------------------------------- shared bits

interface Summary {
  due: number;
  new_left: number;
  new_per_day: number;
  introduced_today: number;
  reviewed_today: number;
  learned: number;
  next_due_at: string | null;
}
interface Meta {
  tiers: Record<string, { label: string; note: string }>;
  categories: Record<string, string>;
  formats: Record<string, string>;
  mature_interval_days: number;
  production_share_min: number;
  challenge: { words: number; seconds: number };
  note: string;
}
interface CardView {
  id: string;
  entry_id: string | null;
  personal: boolean;
  origin: string;
  status: "new" | "learning" | "mature";
  due: boolean;
  due_at: string | null;
  interval_days: number;
  lapses: number;
  review_count: number;
  source_sentence: string | null;
  source_exercise_id: string | null;
}

const TIER_LABEL = (meta: Meta | null, tier: string) => (tier === "personal" ? "Personal" : (meta?.tiers[tier]?.label ?? tier));
const STATUS_CLS: Record<string, string> = { new: "text-zinc-500", learning: "border-amber-200 bg-amber-50 text-amber-800", mature: "border-green-200 bg-green-50 text-green-800" };
const ORIGIN_LABEL: Record<string, string> = { scheduled: "Daily introduction", manual: "Added by you", harvest_ctw: "Missed in Complete the Words", harvest_question: "Missed vocabulary question" };

function useMeta() {
  return useApi<Meta>("/api/vocab/meta").data;
}

function VocabNav({ user, active, live }: { user: string; active: "bank" | "session" | "stats"; live?: Summary | null }) {
  const fetched = useApi<Summary>(`/api/users/${user}/vocab/summary`).data;
  const summary = live ?? fetched;
  const tabs = [
    ["bank", "Bank", `/u/${user}/vocab`],
    ["session", "Daily session", `/u/${user}/vocab/session`],
    ["stats", "Stats", `/u/${user}/vocab/stats`],
  ] as const;
  return (
    <div className="mb-5 flex gap-1 border-b border-zinc-200">
      {tabs.map(([key, label, to]) => (
        <Link key={key} to={to} className={`-mb-px border-b-2 px-3 py-2 text-sm ${active === key ? "border-zinc-900 font-medium text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}>
          {label}
          {key === "session" && summary && summary.due + summary.new_left > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">{summary.due + summary.new_left}</span>}
        </Link>
      ))}
    </div>
  );
}

function SpeakButton({ text, url, label = "Listen" }: { text: string; url?: string | null; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const play = async () => {
    setBusy(true);
    setError(null);
    try {
      await speakText(text, url).done;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audio unavailable");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={play} disabled={busy} aria-label={`${label}: ${text}`}>
        {busy ? "…" : "🔊"} {label}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </>
  );
}

/** Full content of a bank entry. `audio` is "tts" when the server can synthesize it. */
function EntryCard({ entry, audio, compact }: { entry: VocabEntry; audio?: string; compact?: boolean }) {
  const url = (key: string) => (audio === "tts" ? `/api/vocab/audio/${entry.id}/${key}` : null);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xl font-semibold">{entry.headword}</span>
        <span className="font-mono text-[13px] text-zinc-500">{entry.ipa}</span>
        <SpeakButton text={entry.headword} url={url("headword")} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="chip">{entry.pos}</span>
        <span className="chip">CEFR {entry.cefr} (estimate)</span>
        <span className="chip">{entry.register}</span>
        {entry.kind !== "word" && <span className="chip">{entry.kind.replace(/_/g, " ")}</span>}
      </div>
      <p>{entry.definition}</p>
      <p className="text-zinc-600">
        <span className="label mr-2">French</span>
        {entry.translation_fr}
      </p>
      {entry.false_friend_fr && (
        <Notice tone="warn">
          False friend: it does not mean “{entry.false_friend_fr.trap}”. {entry.false_friend_fr.correct}
        </Notice>
      )}
      {entry.spelling_trap && <Notice tone="warn">Spelling: {entry.spelling_trap}</Notice>}
      <div className="space-y-1.5">
        <div className="flex items-start gap-2">
          <span className="label mt-1 w-20 shrink-0">Academic</span>
          <span className="reading text-[15px]">{entry.example_academic}</span>
          {!compact && <SpeakButton text={entry.example_academic} url={url("academic")} label="" />}
        </div>
        <div className="flex items-start gap-2">
          <span className="label mt-1 w-20 shrink-0">Spoken</span>
          <span className="reading text-[15px]">{entry.example_spoken}</span>
          {!compact && <SpeakButton text={entry.example_spoken} url={url("spoken")} label="" />}
        </div>
      </div>
      {entry.collocations.length > 0 && (
        <div>
          <span className="label mr-2">Collocations</span>
          {entry.collocations.join(" · ")}
        </div>
      )}
      {entry.word_family.length > 0 && (
        <div>
          <span className="label mr-2">Word family</span>
          {entry.word_family.map((f) => `${f.form} (${f.pos})`).join(" · ")}
        </div>
      )}
      {entry.synonyms.length > 0 && (
        <div>
          <span className="label mr-2">Close in meaning</span>
          {entry.synonyms.join(" · ")}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bank

interface BankRow {
  id: string;
  card_id: string | null;
  headword: string;
  kind: string;
  pos: string | null;
  cefr: string | null;
  tier: string;
  category: string | null;
  definition: string | null;
  translation_fr: string | null;
  status: "new" | "learning" | "mature";
  in_deck: boolean;
  due: boolean;
}

export function VocabBank({ user }: { user: string }) {
  const meta = useMeta();
  const [tier, setTier] = useState("core");
  const [cefr, setCefr] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(150);
  const query = useMemo(() => new URLSearchParams(Object.entries({ tier, cefr, category, status, q }).filter(([, v]) => v)).toString(), [tier, cefr, category, status, q]);
  const { data, error, loading, setData } = useApi<{ total: number; entries: BankRow[] }>(`/api/users/${user}/vocab/entries?${query}`);
  useEffect(() => setShown(150), [query]);
  const add = async (row: BankRow) => {
    await api.post(`/api/users/${user}/vocab/cards`, { entryId: row.id });
    if (data) setData({ ...data, entries: data.entries.map((e) => (e.id === row.id ? { ...e, in_deck: true } : e)) });
  };
  const tiers = ["core", "extended", "mastery", "personal", ""];
  return (
    <div>
      <PageTitle title="Vocabulary" sub="1,000 original entries. Tiers and CEFR levels are internal conventions of this app — “Essentials” is an internal high-yield selection, not an official list." />
      <VocabNav user={user} active="bank" />
      <div className="mb-3 flex flex-wrap gap-1">
        {tiers.map((t) => (
          <button key={t || "all"} className={`btn py-1.5 text-[13px] ${tier === t ? "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800" : ""}`} onClick={() => setTier(t)} title={t && t !== "personal" ? meta?.tiers[t]?.note : undefined}>
            {t ? TIER_LABEL(meta, t) : "All"}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input w-56" placeholder="Search word, meaning or French…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the vocabulary bank" />
        <select className="input" value={cefr} onChange={(e) => setCefr(e.target.value)} aria-label="CEFR level">
          <option value="">All levels</option>
          {["B2", "C1", "C2"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(meta?.categories ?? {}).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          <option value="new">New</option>
          <option value="learning">Learning</option>
          <option value="mature">Mature</option>
          <option value="due">Due now</option>
          <option value="in_deck">In my deck</option>
        </select>
        {data && <span className="text-xs text-zinc-500">{data.total} entries</span>}
      </div>
      {error ? <ErrorBox error={error} /> : loading && !data ? <Spinner /> : null}
      {data && data.entries.length === 0 && <p className="text-sm text-zinc-500">{tier === "personal" ? "No personal cards yet. Words you miss or click on correction screens appear here when they are not in the bank." : "No entry matches these filters."}</p>}
      {data && data.entries.length > 0 && (
        <div className="card divide-y divide-zinc-100">
          {data.entries.slice(0, shown).map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <Link to={`/u/${user}/vocab/entry/${e.id}`} className="font-medium text-zinc-900 hover:text-accent hover:underline">
                  {e.headword}
                </Link>
                {e.pos && <span className="ml-2 text-xs text-zinc-400">{e.pos}</span>}
                <div className="truncate text-[13px] text-zinc-500">{e.translation_fr ? `${e.translation_fr} — ${e.definition}` : (e.definition ?? "Personal card")}</div>
              </div>
              {e.cefr && <span className="chip">{e.cefr}</span>}
              <span className={`chip ${STATUS_CLS[e.status]}`}>{e.due ? "due" : e.status}</span>
              {e.in_deck ? (
                <span className="w-20 text-right text-xs text-zinc-400">in deck</span>
              ) : (
                <button className="btn w-20 py-1 text-xs" onClick={() => add(e)} title="Study this word next, before the scheduled introductions">
                  + Add
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {data && data.entries.length > shown && (
        <button className="btn mt-3" onClick={() => setShown(shown + 300)}>
          Show more ({data.entries.length - shown} left)
        </button>
      )}
    </div>
  );
}

interface EntryDetail {
  entry: VocabEntry | null;
  personal: { headword: string; source_sentence: string | null } | null;
  card: CardView | null;
  exercises: Array<{ id: string; task_type: string; task_label: string; title: string }>;
  audio: string;
}

export function VocabEntryPage({ user, entryId }: { user: string; entryId: string }) {
  const meta = useMeta();
  const { data, error, loading, reload } = useApi<EntryDetail>(`/api/users/${user}/vocab/entries/${entryId}`);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const c = data.card;
  const add = async () => {
    await api.post(`/api/users/${user}/vocab/cards`, { entryId });
    await reload();
  };
  return (
    <div className="space-y-5">
      <div className="text-sm">
        <Link to={`/u/${user}/vocab`} className="text-zinc-500 hover:text-zinc-900">
          ← Vocabulary bank
        </Link>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="card p-5">
          {data.entry ? (
            <>
              <div className="mb-3 flex flex-wrap gap-1.5">
                <span className="chip">{TIER_LABEL(meta, data.entry.tier)} · internal tier</span>
                <span className="chip">{meta?.categories[data.entry.category] ?? data.entry.category}</span>
              </div>
              <EntryCard entry={data.entry} audio={data.audio} />
            </>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-baseline gap-3">
                <span className="text-xl font-semibold">{data.personal!.headword}</span>
                <SpeakButton text={data.personal!.headword} />
              </div>
              <span className="chip">Personal card — not in the bank</span>
              {data.personal!.source_sentence ? <p className="reading text-[15px]">{data.personal!.source_sentence}</p> : <p className="text-zinc-500">No source sentence was saved with this word.</p>}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="card space-y-2 p-4 text-[13px]">
            <div className="label">My progress</div>
            {c ? (
              <>
                <div>
                  <span className={`chip ${STATUS_CLS[c.status]}`}>{c.status}</span> <span className="text-zinc-500">{ORIGIN_LABEL[c.origin] ?? c.origin}</span>
                </div>
                <div className="text-zinc-600">
                  {c.review_count} review{c.review_count === 1 ? "" : "s"} · {c.lapses} lapse{c.lapses === 1 ? "" : "s"} · interval {c.interval_days} d
                </div>
                <div className="text-zinc-600">{c.review_count === 0 ? "Waiting in your queue." : c.due ? "Due now." : `Next review ${c.due_at ? new Date(c.due_at).toLocaleDateString() : "—"}.`}</div>
              </>
            ) : (
              <>
                <p className="text-zinc-500">Not studied yet. It will be introduced in order, or you can add it now.</p>
                <button className="btn btn-primary py-1.5 text-xs" onClick={add}>
                  + Add to my deck
                </button>
              </>
            )}
            <Link to={`/u/${user}/vocab/session`} className="btn mt-1 w-full py-1.5 text-xs">
              Today's session
            </Link>
          </div>
          <div className="card space-y-2 p-4 text-[13px]">
            <div className="label">In the exercise bank</div>
            {data.exercises.length === 0 ? (
              <p className="text-zinc-500">This word does not appear in any exercise yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.exercises.map((x) => (
                  <li key={x.id}>
                    <Link to={`/u/${user}/drill/${x.id}?mode=practice`} className="text-accent hover:underline">
                      {x.title}
                    </Link>
                    <div className="text-xs text-zinc-400">{x.task_label}</div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-zinc-400">Found automatically by matching word forms in the exercise texts.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- daily session

interface NextCard {
  card: (CardView & { phase: "review" | "new"; tier: string; cefr: string | null }) | null;
  seed: number;
  question: { format: Format; input: "choice" | "typed" | "none"; instruction: string; prompt: string; detail?: string; options?: string[]; speak?: string; firstLetter?: string } | null;
  audio_url: string | null;
  summary: Summary;
}
interface ReviewResult {
  correct: boolean;
  near_miss: boolean;
  expected: string;
  given: string;
  error_label: string | null;
  format: Format;
  card: CardView;
  entry: VocabEntry | null;
  headword: string;
  summary: Summary;
}

function dueText(c: CardView): string {
  if (!c.due_at) return "";
  const ms = Date.parse(c.due_at) - Date.now();
  if (ms < 3600000) return `Back in about ${Math.max(1, Math.round(ms / 60000))} min.`;
  const d = Math.round(ms / 86400000);
  return `Next review in ${d} day${d === 1 ? "" : "s"}.`;
}

export function VocabSession({ user }: { user: string }) {
  const meta = useMeta();
  const cfg = useConfig();
  const [cur, setCur] = useState<NextCard | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [done, setDone] = useState(0);
  const [right, setRight] = useState(0);
  const shownAt = useRef(performance.now());
  const playback = useRef<Playback | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const n = await api.post<NextCard>(`/api/users/${user}/vocab/next?audio=${browserSpeechAvailable() ? 1 : 0}`);
      setCur(n);
      setResult(null);
      setText("");
      shownAt.current = performance.now();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }, [user]);
  useEffect(() => {
    void load();
    return () => playback.current?.cancel();
  }, [load]);

  const q = cur?.question ?? null;
  const play = useCallback(() => {
    if (!q?.speak) return;
    playback.current?.cancel();
    playback.current = speakText(q.speak, cur?.audio_url);
    playback.current.done.catch(() => undefined);
  }, [q, cur]);
  useEffect(() => {
    if (q?.format === "dictation" && !result) play();
    if (q?.input === "typed" && !result) inputRef.current?.focus();
  }, [q, result, play]);
  useEffect(() => {
    if (result) nextRef.current?.focus();
  }, [result]);

  const submit = useCallback(
    async (payload: { choice?: number; text?: string }) => {
      if (!cur?.card || !q || busy || result) return;
      setBusy(true);
      try {
        const r = await api.post<ReviewResult>(`/api/users/${user}/vocab/reviews`, { cardId: cur.card.id, format: q.format, seed: cur.seed, elapsedMs: Math.round(performance.now() - shownAt.current), ...payload });
        setResult(r);
        setDone((d) => d + 1);
        if (r.correct) setRight((x) => x + 1);
      } catch (e) {
        setError(e);
      } finally {
        setBusy(false);
      }
    },
    [cur, q, busy, result, user],
  );

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (result || !q || q.input !== "choice") return;
      const i = "1234".indexOf(e.key);
      if (i >= 0 && q.options && i < q.options.length) void submit({ choice: i });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [q, result, submit]);

  const summary = result?.summary ?? cur?.summary ?? null;
  return (
    <div>
      <PageTitle
        title="Vocabulary"
        sub="Due reviews first, then today's new words. Spacing is an internal SM-2-style schedule."
        right={summary && <div className="text-xs text-zinc-500">{summary.due} due · {summary.new_left} new left · {summary.reviewed_today} reviewed today</div>}
      />
      <VocabNav user={user} active="session" live={summary} />
      {error != null && <ErrorBox error={error} onRetry={load} />}
      {!cur && !error && <Spinner />}
      {cur && !cur.card && <SessionEnd user={user} summary={cur.summary} done={done} right={right} onRecheck={load} />}
      {cur?.card && q && (
        <div className="mx-auto max-w-2xl">
          <div className="card p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span className={`chip ${cur.card.phase === "new" ? "border-blue-200 bg-blue-50 text-blue-800" : ""}`}>{cur.card.phase === "new" ? "New word" : "Review"}</span>
              <span className="chip">{meta?.formats[q.format] ?? q.format}</span>
              <span className="chip">{TIER_LABEL(meta, cur.card.tier)}{cur.card.cefr ? ` · ${cur.card.cefr}` : ""}</span>
              {cur.card.origin.startsWith("harvest") && <span className="chip border-amber-200 bg-amber-50 text-amber-800">{ORIGIN_LABEL[cur.card.origin]}</span>}
            </div>
            <p className="mb-3 text-sm text-zinc-500">{q.instruction}</p>
            {q.format === "dictation" ? (
              <button className="btn mb-4" onClick={play}>
                🔊 Play again
              </button>
            ) : (
              <div className={`mb-2 ${q.prompt.length > 60 ? "reading" : "text-2xl font-semibold"}`}>{q.prompt}</div>
            )}
            {q.detail && <div className="mb-4 text-sm text-zinc-500">{q.detail}</div>}

            {q.input === "choice" && (
              <div className="mt-4 space-y-2">
                {q.options!.map((o, i) => {
                  const picked = result && result.given === o;
                  const isAnswer = result && result.expected === o;
                  return (
                    <button
                      key={i}
                      disabled={!!result || busy}
                      onClick={() => submit({ choice: i })}
                      className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left text-sm disabled:cursor-default ${isAnswer ? "border-green-300 bg-green-50" : picked ? "border-red-300 bg-red-50" : "border-zinc-200 hover:border-zinc-400"}`}
                    >
                      <Kbd>{i + 1}</Kbd>
                      <span>{o}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {q.input === "typed" && (
              <form
                className="mt-4 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit({ text: (q.firstLetter ?? "") + text });
                }}
              >
                {q.firstLetter && <span className="font-mono text-lg font-semibold">{q.firstLetter}</span>}
                <input
                  ref={inputRef}
                  className="input flex-1 font-mono"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={!!result}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={q.firstLetter ? "rest of the word" : "type your answer"}
                  aria-label="Your answer"
                />
                {!result && (
                  <button className="btn btn-primary" disabled={busy}>
                    Check
                  </button>
                )}
              </form>
            )}
            {q.input === "none" && !result && (
              <button className="btn btn-primary mt-4" disabled={busy} onClick={() => submit({})}>
                Got it — continue
              </button>
            )}
            {q.input === "typed" && !result && (
              <button className="mt-2 text-xs text-zinc-400 hover:text-zinc-700" onClick={() => submit({ text: "" })} disabled={busy}>
                I don't know
              </button>
            )}
          </div>

          {result && (
            <div className="card mt-4 p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className={`text-sm font-semibold ${result.correct ? "text-green-700" : "text-red-700"}`}>
                  {q.input === "none" ? "Saved to your rotation" : result.correct ? "Correct" : result.near_miss ? "Almost — check the spelling" : "Not quite"}
                  {!result.correct && result.error_label && <span className="ml-2 font-normal text-zinc-500">({result.error_label})</span>}
                </div>
                <button ref={nextRef} className="btn btn-primary" onClick={load} disabled={busy}>
                  Next <Kbd>Enter</Kbd>
                </button>
              </div>
              {!result.correct && (
                <p className="mb-3 text-sm">
                  {result.given ? (
                    <>
                      You answered <span className={`text-red-700 ${q.input === "typed" ? "font-mono" : ""}`}>{result.given}</span>.{" "}
                    </>
                  ) : null}
                  Expected: <span className={`font-semibold ${q.input === "typed" ? "font-mono" : ""}`}>{result.expected}</span>
                </p>
              )}
              <p className="mb-4 text-xs text-zinc-500">{dueText(result.card)}</p>
              {result.entry ? (
                <EntryCard entry={result.entry} audio={cfg?.providers.tts.configured ? "tts" : "browser"} compact />
              ) : (
                <div className="text-sm">
                  <span className="text-lg font-semibold">{result.headword}</span> <span className="chip ml-2">personal card</span>
                  {result.card.source_sentence && <p className="reading mt-2 text-[15px]">{result.card.source_sentence}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionEnd({ user, summary, done, right, onRecheck }: { user: string; summary: Summary; done: number; right: number; onRecheck: () => void }) {
  const soon = summary.next_due_at && Date.parse(summary.next_due_at) - Date.now() < 3600000 ? summary.next_due_at : null;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card p-6">
        <div className="text-lg font-semibold">{summary.reviewed_today > 0 ? "Session complete" : "Nothing to review right now"}</div>
        <p className="mt-1 text-sm text-zinc-600">
          {done > 0 && `${right}/${done} correct in this sitting. `}
          {summary.reviewed_today} review{summary.reviewed_today === 1 ? "" : "s"} today · {summary.introduced_today} new word{summary.introduced_today === 1 ? "" : "s"} introduced (limit {summary.new_per_day}, adjustable in Settings).
        </p>
        {soon && (
          <p className="mt-2 text-sm text-zinc-600">
            A missed card comes back at {new Date(soon).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.{" "}
            <button className="text-accent underline" onClick={onRecheck}>
              Check again
            </button>
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <Link to={`/u/${user}/vocab/stats`} className="btn">
            See stats
          </Link>
          <Link to={`/u/${user}`} className="btn btn-ghost">
            Dashboard
          </Link>
        </div>
      </div>
      {summary.reviewed_today > 0 && <Challenge user={user} />}
    </div>
  );
}

// ---------------------------------------------------------------- production challenge

interface ChallengeProposal {
  words: Array<{ card_id: string; headword: string; definition: string | null; translation_fr: string | null }>;
  seconds: number;
  ai_configured: boolean;
  stt_configured: boolean;
}
interface ChallengeResult {
  id: string;
  mode: string;
  text: string;
  text_source: string;
  words: Array<{ card_id: string; headword: string; present: boolean | null }>;
  feedback: { words: Array<{ headword: string; used: boolean; meaning_correct: boolean; natural: boolean; comment: string }>; overall_comment: string; improved_version: string } | null;
  feedback_error: string | null;
  ai_configured: boolean;
  self_rating: number | null;
}

function Challenge({ user }: { user: string }) {
  const { data, error } = useApi<ChallengeProposal>(`/api/users/${user}/vocab/challenge`);
  const [mode, setMode] = useState<"written" | "spoken">("written");
  const [text, setText] = useState("");
  const [rec, setRec] = useState<Recording | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ChallengeResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<Recording | null>(null);
  useEffect(() => () => {
    void recRef.current?.stop().catch(() => undefined);
    releaseMicrophone();
  }, []);

  const send = useCallback(
    async (body: { mode: "written" | "spoken"; text: string; textSource: string }) => {
      if (!data) return;
      setBusy("Checking…");
      setErr(null);
      try {
        setResult(await api.post<ChallengeResult>(`/api/users/${user}/vocab/challenge`, { cardIds: data.words.map((w) => w.card_id), ...body }));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not submit");
      } finally {
        setBusy(null);
      }
    },
    [data, user],
  );

  const stop = useCallback(async () => {
    const r = recRef.current;
    if (!r || !data) return;
    recRef.current = null;
    setRec(null);
    setBusy("Transcribing…");
    try {
      const out = await r.stop();
      releaseMicrophone();
      let transcript = out.transcript ?? "";
      let source = transcript ? "browser" : "none";
      if (data.stt_configured) {
        try {
          transcript = (await api.upload<{ transcript: string }>(`/api/users/${user}/vocab/challenge/transcribe`, out.blob)).transcript;
          source = transcript ? "server_stt" : "none";
        } catch {
          /* keep the browser transcript, if any */
        }
      }
      await send({ mode: "spoken", text: transcript, textSource: source });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Recording failed");
      setBusy(null);
    }
  }, [data, send, user]);

  useEffect(() => {
    if (!rec) return;
    if (left <= 0) {
      void stop();
      return;
    }
    const t = window.setTimeout(() => setLeft((x) => x - 1), 1000);
    return () => window.clearTimeout(t);
  }, [rec, left, stop]);

  const start = async () => {
    if (!data) return;
    setErr(null);
    try {
      const r = await Recording.start(!data.stt_configured);
      recRef.current = r;
      setLeft(data.seconds);
      setRec(r);
    } catch (e) {
      setErr(e instanceof Error ? `Microphone unavailable: ${e.message}` : "Microphone unavailable");
    }
  };
  const rate = async (rating: number) => {
    if (result) setResult(await api.post<ChallengeResult>(`/api/vocab/challenges/${result.id}/self-rate`, { rating }));
  };

  if (error) return <ErrorBox error={error} />;
  if (!data || data.words.length === 0) return null;
  const canVerifySpeech = data.stt_configured || browserRecognitionSupported();
  return (
    <div className="card p-6">
      <div className="label mb-1">Production challenge</div>
      <p className="text-sm text-zinc-600">
        Use {data.words.length === 1 ? "this word" : `these ${data.words.length} words`} from today's reviews in a {data.seconds}-second spoken answer or in two written sentences.
      </p>
      <ul className="my-3 space-y-1 text-sm">
        {data.words.map((w) => {
          const r = result?.words.find((x) => x.card_id === w.card_id);
          return (
            <li key={w.card_id} className="flex items-baseline gap-2">
              {result && <span className={r?.present ? "text-green-700" : r?.present === false ? "text-red-700" : "text-zinc-400"}>{r?.present ? "✓" : r?.present === false ? "✗" : "?"}</span>}
              <span className="font-semibold">{w.headword}</span>
              {w.definition && <span className="text-zinc-500">— {w.definition}</span>}
            </li>
          );
        })}
      </ul>
      {!result && (
        <>
          <div className="mb-3 flex gap-1">
            {(["written", "spoken"] as const).map((m) => (
              <button key={m} className={`btn py-1 text-xs ${mode === m ? "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800" : ""}`} onClick={() => setMode(m)} disabled={!!rec || !!busy}>
                {m === "written" ? "Write two sentences" : `Speak for ${data.seconds} s`}
              </button>
            ))}
          </div>
          {mode === "written" ? (
            <>
              <textarea className="input h-28 w-full" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder="Two sentences that use the words above…" aria-label="Your sentences" />
              <button className="btn btn-primary mt-2" disabled={!text.trim() || !!busy} onClick={() => send({ mode: "written", text, textSource: "typed" })}>
                {busy ?? "Check my sentences"}
              </button>
            </>
          ) : !recordingSupported() ? (
            <Notice tone="warn">Recording is not available in this browser. Use the written version.</Notice>
          ) : (
            <>
              {!canVerifySpeech && <Notice tone="warn">No speech-to-text is available (server or browser): the words cannot be verified automatically, so you will self-evaluate.</Notice>}
              {!data.stt_configured && canVerifySpeech && <p className="mb-2 text-xs text-zinc-500">Transcript from this browser's speech recognition — approximate.</p>}
              {rec ? (
                <button className="btn btn-danger mt-2" onClick={stop}>
                  ● Recording… {left} s — stop
                </button>
              ) : (
                <button className="btn btn-primary mt-2" onClick={start} disabled={!!busy}>
                  {busy ?? "Start recording"}
                </button>
              )}
            </>
          )}
        </>
      )}
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      {result && (
        <div className="mt-3 space-y-3 text-sm">
          {result.text ? (
            <div>
              <div className="label mb-1">{result.mode === "spoken" ? `Transcript (${result.text_source === "server_stt" ? "server speech-to-text" : "browser recognition, approximate"})` : "Your text"}</div>
              <p className="reading text-[15px]">{result.text}</p>
            </div>
          ) : (
            <Notice tone="warn">No transcript was produced, so the words could not be verified. Rate yourself below.</Notice>
          )}
          {result.text && (
            <p className="text-zinc-600">
              {result.words.filter((w) => w.present).length}/{result.words.length} target words found{result.mode === "spoken" ? " in the transcript" : ""} (inflected forms count).
            </p>
          )}
          {result.feedback ? (
            <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <div className="label">AI feedback — training comment, not a score</div>
              {result.feedback.words.map((w) => (
                <div key={w.headword}>
                  <span className="font-semibold">{w.headword}</span>{" "}
                  <span className={w.used && w.meaning_correct && w.natural ? "text-green-700" : "text-amber-700"}>{!w.used ? "not used" : !w.meaning_correct ? "meaning off" : !w.natural ? "unnatural use" : "good"}</span>
                  <span className="text-zinc-600"> — {w.comment}</span>
                </div>
              ))}
              <p>{result.feedback.overall_comment}</p>
              <div>
                <div className="label mb-1">Improved version</div>
                <p className="reading text-[15px]">{result.feedback.improved_version}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {result.feedback_error ? <Notice tone="warn">AI feedback failed ({result.feedback_error}). Nothing was invented — rate yourself instead.</Notice> : !result.ai_configured ? <p className="text-xs text-zinc-500">AI feedback is not configured (ANTHROPIC_API_KEY). Self-evaluation:</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-zinc-600">How naturally did you use the words?</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className={`btn px-2.5 py-1 text-xs ${result.self_rating === n ? "border-zinc-900 bg-zinc-900 text-white hover:bg-zinc-800" : ""}`} onClick={() => rate(n)}>
                    {n}
                  </button>
                ))}
                <span className="text-xs text-zinc-400">1 = forced · 5 = natural</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- stats

interface Stats {
  by_tier: Record<string, { new: number; learning: number; mature: number; total: number }>;
  by_status: { new: number; learning: number; mature: number; total: number };
  window_days: number;
  retention: { reviews: number; correct: number; rate: number | null };
  production_share: number | null;
  reviews_by_day: Array<{ date: string; reviews: number; correct: number }>;
  failing: Array<{ card_id: string; entry_id: string | null; headword: string; lapses: number; recent_fails: number; last_error_label: string | null; status: string }>;
  leech_threshold: number;
  challenges: number;
  summary: Summary;
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="label">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export function VocabStats({ user }: { user: string }) {
  const meta = useMeta();
  const { data, error, loading } = useApi<Stats>(`/api/users/${user}/vocab/stats`);
  const max = Math.max(1, ...(data?.reviews_by_day.map((d) => d.reviews) ?? [1]));
  return (
    <div>
      <PageTitle title="Vocabulary" sub="Counts come from your own reviews in this app. Nothing here is an official measure." />
      <VocabNav user={user} active="stats" />
      {error ? <ErrorBox error={error} /> : loading && !data ? <Spinner /> : null}
      {data && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="New" value={data.by_status.new} sub="not studied yet" />
            <Stat label="Learning" value={data.by_status.learning} sub={`interval under ${meta?.mature_interval_days ?? 21} days`} />
            <Stat label="Mature" value={data.by_status.mature} sub={`interval of ${meta?.mature_interval_days ?? 21} days or more`} />
            <Stat
              label={`Retention · ${data.window_days} days`}
              value={pct(data.retention.rate)}
              sub={data.retention.reviews ? `${data.retention.correct}/${data.retention.reviews} reviews correct (first exposures excluded)` : "no reviews yet"}
            />
          </div>
          <div className="card p-5">
            <div className="label mb-3">Words by state and tier</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="pb-2 font-medium">Tier (internal)</th>
                  <th className="font-medium">New</th>
                  <th className="font-medium">Learning</th>
                  <th className="font-medium">Mature</th>
                  <th className="w-1/3 font-medium">Studied</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.by_tier)
                  .filter(([tier, t]) => tier !== "personal" || t.total > 0)
                  .map(([tier, t]) => (
                    <tr key={tier} className="border-t border-zinc-100">
                      <td className="py-2 font-medium">{TIER_LABEL(meta, tier)}</td>
                      <td className="tabular-nums">{t.new}</td>
                      <td className="tabular-nums">{t.learning}</td>
                      <td className="tabular-nums">{t.mature}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Bar value={t.learning + t.mature} max={Math.max(1, t.total)} tone="ok" />
                          <span className="w-16 text-right text-xs tabular-nums text-zinc-500">
                            {t.learning + t.mature}/{t.total}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card p-5">
              <div className="label mb-3">Reviews per day · last {data.window_days} days</div>
              {data.reviews_by_day.length === 0 ? (
                <p className="text-sm text-zinc-500">No reviews yet.</p>
              ) : (
                <div className="flex h-28 items-end gap-1" role="img" aria-label="Reviews per day">
                  {data.reviews_by_day.map((d) => (
                    <div key={d.date} className="flex h-full min-w-[6px] max-w-[28px] flex-1 flex-col justify-end" title={`${d.date}: ${d.correct}/${d.reviews} correct`}>
                      <div className="bg-red-300" style={{ height: `${((d.reviews - d.correct) / max) * 100}%` }} />
                      <div className="bg-zinc-700" style={{ height: `${(d.correct / max) * 100}%` }} />
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-zinc-500">
                Dark = correct, red = missed. Production formats: {pct(data.production_share)} of reviews after first exposure (internal floor {pct(meta?.production_share_min ?? 0.6)}). {data.challenges} production challenge{data.challenges === 1 ? "" : "s"}.
              </p>
            </div>
            <div className="card p-5">
              <div className="label mb-3">Words that keep failing</div>
              {data.failing.length === 0 ? (
                <p className="text-sm text-zinc-500">None. A word appears here after {data.leech_threshold} lapses, or {data.leech_threshold} misses in {data.window_days} days.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {data.failing.map((f) => (
                    <li key={f.card_id} className="flex items-baseline justify-between gap-3">
                      <Link to={`/u/${user}/vocab/entry/${f.entry_id ?? f.card_id}`} className="font-medium hover:text-accent hover:underline">
                        {f.headword}
                      </Link>
                      <span className="text-xs text-zinc-500">
                        {f.lapses} lapse{f.lapses === 1 ? "" : "s"} · {f.recent_fails} recent miss{f.recent_fails === 1 ? "" : "es"}
                        {f.last_error_label ? ` · ${f.last_error_label}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-400">
            {data.summary.next_due_at ? `Next card due ${new Date(data.summary.next_due_at).toLocaleString()}. ` : ""}
            {meta?.note}
          </p>
        </div>
      )}
    </div>
  );
}
