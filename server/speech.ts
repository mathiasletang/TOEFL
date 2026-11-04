/**
 * Optional speech services through OpenAI-compatible HTTP endpoints:
 *   POST {base}/audio/transcriptions   (speech-to-text)
 *   POST {base}/audio/speech           (text-to-speech)
 * Works with OpenAI or any compatible local server. Nothing here is required:
 * without configuration the browser fallbacks are used and clearly labelled.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Env } from "./env";
import type { DB } from "./db";
import { nowIso } from "./db";
import { ROOT } from "./env";

export interface Transcription {
  text: string;
  confidence: number | null; // mean exp(avg_logprob) of segments when available — an ASR-confidence proxy
}

export function sttAvailable(env: Env): boolean {
  return env.stt.provider === "openai" && !!env.stt.apiKey;
}
export function ttsAvailable(env: Env): boolean {
  return env.tts.provider === "openai" && !!env.tts.apiKey;
}

export async function transcribe(env: Env, audio: Buffer, mime: string): Promise<Transcription> {
  if (!sttAvailable(env)) throw new Error("Speech-to-text is not configured.");
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("m4a") ? "mp4" : mime.includes("wav") ? "wav" : "webm";
  const attempt = async (format: "verbose_json" | "json") => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), `answer.${ext}`);
    form.append("model", env.stt.model);
    form.append("language", "en");
    form.append("response_format", format);
    const res = await fetch(`${env.stt.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.stt.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });
    return res;
  };
  let res = await attempt("verbose_json");
  if (res.status === 400) res = await attempt("json"); // some models only support plain json
  if (!res.ok) throw new Error(`STT HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { text?: string; segments?: Array<{ avg_logprob?: number; no_speech_prob?: number }> };
  const segs = body.segments ?? [];
  const confs = segs.filter((s) => typeof s.avg_logprob === "number").map((s) => Math.min(1, Math.exp(s.avg_logprob!)) * (1 - (s.no_speech_prob ?? 0)));
  return { text: (body.text ?? "").trim(), confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null };
}

const FEMALE = ["nova", "shimmer", "coral", "sage"];
const MALE = ["onyx", "echo", "fable", "ash"];

export function pickVoice(env: Env, voice: "female" | "male" | "neutral", speakerIndex: number): string {
  const voices = env.tts.voices.length ? env.tts.voices : ["alloy"];
  const pool = voice === "female" ? voices.filter((v) => FEMALE.includes(v)) : voice === "male" ? voices.filter((v) => MALE.includes(v)) : voices;
  const list = pool.length ? pool : voices;
  return list[speakerIndex % list.length]!;
}

export function audioDir(env: Env, sub: string): string {
  const d = path.join(env.dataDir, "audio", sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Recorded asset shipped with content: content/audio/<exerciseId>/<key>.(mp3|wav|ogg|webm) */
export function recordedAsset(exerciseId: string, key: string): { path: string; mime: string } | null {
  const base = path.join(ROOT, "content", "audio", exerciseId);
  for (const [ext, mime] of [["mp3", "audio/mpeg"], ["wav", "audio/wav"], ["ogg", "audio/ogg"], ["webm", "audio/webm"]] as const) {
    const p = path.join(base, `${key}.${ext}`);
    if (fs.existsSync(p)) return { path: p, mime };
  }
  return null;
}

export async function ttsFile(env: Env, db: DB, args: { exerciseId: string; key: string; text: string; voice: string }): Promise<{ path: string; mime: string }> {
  const hash = crypto.createHash("sha256").update(`${env.tts.model}|${args.voice}|${args.text}`).digest("hex");
  const row = db.prepare("SELECT path, mime FROM audio_assets WHERE text_hash = ? AND voice = ? AND provider = ?").get(hash, args.voice, env.tts.baseUrl) as
    | { path: string; mime: string }
    | undefined;
  if (row && fs.existsSync(row.path)) return row;
  if (!ttsAvailable(env)) throw new Error("Text-to-speech is not configured.");
  const res = await fetch(`${env.tts.baseUrl}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.tts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.tts.model, voice: args.voice, input: args.text, response_format: "mp3" }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(audioDir(env, "tts"), `${hash}.mp3`);
  fs.writeFileSync(file, buf);
  db.prepare(
    "INSERT OR REPLACE INTO audio_assets (id, exercise_id, item_key, source, provider, voice, text_hash, path, mime, created_at) VALUES (?, ?, ?, 'tts', ?, ?, ?, ?, 'audio/mpeg', ?)",
  ).run(crypto.randomUUID(), args.exerciseId, args.key, env.tts.baseUrl, args.voice, hash, file, nowIso());
  return { path: file, mime: "audio/mpeg" };
}
