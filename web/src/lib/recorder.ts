/** Microphone recording (MediaRecorder) with optional live browser speech recognition. */

interface SRResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string; confidence: number } };
}
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: SRResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(): void;
  stop(): void;
}

export function browserRecognitionSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function recordingSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export interface RecordingResult {
  blob: Blob;
  durationMs: number;
  transcript: string | null;
  confidence: number | null;
}

let sharedStream: MediaStream | null = null;
export async function getMicrophone(): Promise<MediaStream> {
  if (sharedStream && sharedStream.getAudioTracks().some((t) => t.readyState === "live")) return sharedStream;
  sharedStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  return sharedStream;
}

export function releaseMicrophone() {
  sharedStream?.getTracks().forEach((t) => t.stop());
  sharedStream = null;
}

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

export class Recording {
  private mr: MediaRecorder;
  private chunks: Blob[] = [];
  private started = performance.now();
  private recognition: SR | null = null;
  private finals: Array<{ t: string; c: number }> = [];
  private recEnded: Promise<void> = Promise.resolve();

  private constructor(stream: MediaStream, useRecognition: boolean) {
    const mime = pickMime();
    this.mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.mr.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.mr.start(250);
    if (useRecognition && browserRecognitionSupported()) {
      const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
      const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition)!;
      const r = new Ctor();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = false;
      r.onresult = (e) => {
        this.finals = [];
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i]!;
          if (res.isFinal) this.finals.push({ t: res[0].transcript, c: res[0].confidence });
        }
      };
      this.recEnded = new Promise((resolve) => {
        r.onend = () => resolve();
        r.onerror = () => resolve();
      });
      try {
        r.start();
        this.recognition = r;
      } catch {
        this.recognition = null;
      }
    }
  }

  static async start(useRecognition: boolean): Promise<Recording> {
    const stream = await getMicrophone();
    return new Recording(stream, useRecognition);
  }

  async stop(): Promise<RecordingResult> {
    const durationMs = performance.now() - this.started;
    const stopped = new Promise<void>((resolve) => {
      this.mr.onstop = () => resolve();
    });
    if (this.mr.state !== "inactive") this.mr.stop();
    await stopped;
    let transcript: string | null = null;
    let confidence: number | null = null;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* already stopped */
      }
      await Promise.race([this.recEnded, new Promise((r) => setTimeout(r, 2000))]);
      // An empty result from browser recognition is not evidence of silence (it often fails quietly): treat as "no transcript".
      transcript = this.finals.map((f) => f.t.trim()).join(" ").trim() || null;
      const cs = this.finals.map((f) => f.c).filter((c) => c > 0);
      confidence = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null;
    }
    return { blob: new Blob(this.chunks, { type: this.mr.mimeType || "audio/webm" }), durationMs, transcript, confidence };
  }
}
