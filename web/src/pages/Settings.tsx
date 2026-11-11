import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useConfig } from "../lib/config";
import { Spinner, PageTitle, Notice } from "../components/ui";
import { cefrForBand, minimumSumFor } from "../../../shared/bands";
import { browserRecognitionSupported, recordingSupported } from "../lib/recorder";

interface U {
  id: string;
  target_band: number;
  exam_date: string | null;
  vocab_new_per_day: number;
}

export function Settings({ user }: { user: string }) {
  const users = useApi<U[]>("/api/users");
  const cfg = useConfig();
  const me = users.data?.find((u) => u.id === user);
  const [target, setTarget] = useState<number | null>(null);
  const [date, setDate] = useState<string>("");
  const [saved, setSaved] = useState<string | null>(null);
  const [newPerDay, setNewPerDay] = useState<number | null>(null);
  const meta = useApi<{ new_per_day_options: number[]; new_per_day_default: number }>("/api/vocab/meta");
  useEffect(() => {
    if (me) {
      setTarget(me.target_band);
      setDate(me.exam_date ?? "");
      setNewPerDay(me.vocab_new_per_day);
    }
  }, [me]);
  if (!me || !cfg) return <Spinner />;
  const save = async () => {
    await api.patch(`/api/users/${user}`, { target_band: target, exam_date: date || null, vocab_new_per_day: newPerDay ?? undefined });
    setSaved("Saved.");
    setTimeout(() => setSaved(null), 2000);
  };
  const provider = (ok: boolean, label: string, detail: string) => (
    <div className="flex items-start gap-2 text-[13px]">
      <span className={ok ? "text-green-700" : "text-zinc-400"}>{ok ? "●" : "○"}</span>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-zinc-500">{detail}</div>
      </div>
    </div>
  );
  return (
    <div className="space-y-5">
      <PageTitle title="Settings" sub={`Profile: ${user}`} />
      <div className="card space-y-4 p-5">
        <div className="label">Goal</div>
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <div className="mb-1 text-xs text-zinc-500">Target overall band</div>
            <select className="input" value={target ?? 6} onChange={(e) => setTarget(Number(e.target.value))}>
              {cfg.target_options.map((t) => (
                <option key={t} value={t}>
                  {t.toFixed(1)} — CEFR {cefrForBand(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="mb-1 text-xs text-zinc-500">Exam date</div>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-xs text-zinc-500">New vocabulary words per day</div>
            <select className="input" value={newPerDay ?? 20} onChange={(e) => setNewPerDay(Number(e.target.value))}>
              {[...new Set([...(meta.data?.new_per_day_options ?? [20]), newPerDay ?? 20])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "0 — reviews only" : n}
                    {n === meta.data?.new_per_day_default ? " (default)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
          {saved && <span className="text-xs text-green-700">{saved}</span>}
        </div>
        {target != null && (
          <p className="text-xs text-zinc-500">
            Band {target.toFixed(1)} needs a mean of the four section bands ≥ {(target - 0.25).toFixed(2)} (sum ≥ {minimumSumFor(target).toFixed(1)}), because ETS rounds the mean to the nearest half band (5.25 → 5.5; 5.125 → 5.0).
            {target === 6 && " For 6.0 that means e.g. 6.0 / 6.0 / 6.0 / 5.0 or 6.0 / 6.0 / 5.5 / 5.5 — at most one half-band below 6 in two sections."}
          </p>
        )}
      </div>
      <div className="card space-y-3 p-5">
        <div className="label">Providers (configured in .env on the local server)</div>
        {provider(cfg.providers.llm.configured, "AI evaluation (Writing, Interview)", cfg.providers.llm.configured ? `${cfg.providers.llm.model} · feedback in ${cfg.providers.llm.language}` : "Not configured — set ANTHROPIC_API_KEY. No AI scores are ever invented without it.")}
        {provider(cfg.providers.stt.configured, "Speech-to-text (server)", cfg.providers.stt.configured ? cfg.providers.stt.model : browserRecognitionSupported() ? "Not configured — this browser's speech recognition is used as an approximate fallback." : "Not configured — and this browser has no speech recognition; speaking items can be self-rated.")}
        {provider(cfg.providers.tts.configured, "Text-to-speech (server)", cfg.providers.tts.configured ? cfg.providers.tts.model : "Not configured — the browser's speech synthesis is used (clearly labelled fallback).")}
        {provider(recordingSupported(), "Microphone recording", recordingSupported() ? "MediaRecorder available in this browser." : "Unavailable in this browser.")}
      </div>
      <div className="card space-y-2 p-5 text-[13px]">
        <div className="label">Content bank</div>
        <p>
          {cfg.content.exercises} validated exercises · {cfg.content.invalid} rejected · {cfg.content.warnings} warnings
        </p>
        {cfg.content.file_errors.length > 0 && <Notice tone="warn">{cfg.content.file_errors.join(" · ")}</Notice>}
        <p className="text-xs text-zinc-500">Add exercises by dropping JSON files into content/exercises/ and restarting; run npm run validate:content first.</p>
      </div>
      <div className="card space-y-1 p-5 text-[13px]">
        <div className="label">Routing (adaptive simulator)</div>
        <p>
          Internal training threshold: {(cfg.routing.training_threshold * 100).toFixed(0)}% of Module 1 correct ({cfg.routing.model}).
        </p>
        <p className="text-xs text-amber-800">{cfg.routing.ui_warning}</p>
      </div>
    </div>
  );
}
