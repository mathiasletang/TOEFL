import { api } from "./api";
import type { AudioScript } from "../../../shared/publicView";

export interface Manifest {
  mode: "recorded" | "tts" | "browser";
  urls: Record<string, string | null>;
}

const cache = new Map<string, Manifest>();
export async function getManifest(exerciseId: string): Promise<Manifest> {
  if (!cache.has(exerciseId)) cache.set(exerciseId, await api.get<Manifest>(`/api/audio-manifest/${exerciseId}`));
  return cache.get(exerciseId)!;
}

export const AUDIO_MODE_LABEL: Record<Manifest["mode"], string> = {
  recorded: "Recorded audio",
  tts: "Synthesized voice (server TTS)",
  browser: "Browser speech synthesis — fallback, not ETS-like audio",
};

export interface Playback {
  done: Promise<{ ms: number; cancelled: boolean }>;
  cancel: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
function voices(): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  if (!voicesReady)
    voicesReady = new Promise((resolve) => {
      const v = speechSynthesis.getVoices();
      if (v.length) return resolve(v);
      const on = () => resolve(speechSynthesis.getVoices());
      speechSynthesis.addEventListener("voiceschanged", on, { once: true });
      setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
    });
  return voicesReady;
}

const FEMALE_HINT = /(female|woman|samantha|victoria|karen|moira|tessa|zira|aria|jenny|libby|sonia|susan|serena|allison|ava|google us english|google uk english female)/i;
const MALE_HINT = /(male|man|daniel|alex|fred|david|guy|ryan|george|tom|aaron|arthur|google uk english male)/i;

function chooseVoice(all: SpeechSynthesisVoice[], kind: "female" | "male" | "neutral", idx: number): SpeechSynthesisVoice | undefined {
  const en = all.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = kind === "female" ? en.filter((v) => FEMALE_HINT.test(v.name)) : kind === "male" ? en.filter((v) => MALE_HINT.test(v.name) && !/female/i.test(v.name)) : en;
  const list = pool.length ? pool : en;
  return list[idx % Math.max(1, list.length)];
}

function speak(text: string, voice: SpeechSynthesisVoice | undefined, signal: { cancelled: boolean }): Promise<void> {
  // Chrome stops long utterances after ~15 s: speak sentence by sentence.
  const parts = text.match(/[^.!?]+[.!?]+["”]?|[^.!?]+$/g) ?? [text];
  return parts.reduce(
    (p, part) =>
      p.then(
        () =>
          new Promise<void>((resolve) => {
            if (signal.cancelled) return resolve();
            const u = new SpeechSynthesisUtterance(part.trim());
            try {
              if (voice) u.voice = voice;
            } catch {
              /* engine rejected the voice object: use its default voice */
            }
            u.lang = voice?.lang ?? "en-US";
            u.rate = 0.95;
            // Safety net: some engines never fire onend; estimate duration generously.
            const words = part.split(/\s+/).length;
            const guard = window.setTimeout(() => resolve(), 2500 + words * 600);
            u.onend = () => {
              window.clearTimeout(guard);
              resolve();
            };
            u.onerror = () => {
              window.clearTimeout(guard);
              resolve();
            };
            speechSynthesis.speak(u);
          }),
      ),
    Promise.resolve(),
  );
}

/** Play an audio script once (segments in order). Recorded/TTS files when available, browser synthesis otherwise. */
export function playScript(exerciseId: string, script: AudioScript, opts: { onSegment?: (i: number) => void } = {}): Playback {
  const signal = { cancelled: false };
  let current: HTMLAudioElement | null = null;
  const started = performance.now();
  const done = (async () => {
    const m = await getManifest(exerciseId);
    const speakers = [...new Set(script.map((s) => s.speaker))];
    const all = m.mode === "browser" ? await voices() : [];
    if (m.mode === "browser" && (!("speechSynthesis" in window) || all.length === 0))
      throw new Error("No speech-synthesis voice is available in this browser and no audio provider is configured (see README → Audio).");
    for (let i = 0; i < script.length; i++) {
      if (signal.cancelled) break;
      const seg = script[i]!;
      opts.onSegment?.(i);
      const url = m.urls[seg.key];
      if (url) {
        await new Promise<void>((resolve, reject) => {
          const a = new Audio(url);
          current = a;
          a.onended = () => resolve();
          a.onerror = () => reject(new Error("Audio failed to load"));
          a.play().catch(reject);
        });
      } else {
        await speak(seg.text, chooseVoice(all, seg.voice, speakers.indexOf(seg.speaker)), signal);
      }
      if (i < script.length - 1) await sleep(350);
    }
    return { ms: performance.now() - started, cancelled: signal.cancelled };
  })();
  return {
    done,
    cancel: () => {
      signal.cancelled = true;
      current?.pause();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    },
  };
}
