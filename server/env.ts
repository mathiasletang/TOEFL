import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function str(name: string, def = ""): string {
  const v = process.env[name];
  return v == null || v.trim() === "" ? def : v.trim();
}

export interface Env {
  port: number;
  dataDir: string;
  llm: { provider: "anthropic" | "none"; apiKey: string; model: string; effort: "low" | "medium" | "high"; timeoutMs: number; language: "en" | "fr" };
  stt: { provider: "openai" | "none"; baseUrl: string; apiKey: string; model: string };
  tts: { provider: "openai" | "none"; baseUrl: string; apiKey: string; model: string; voices: string[] };
}

export function loadEnv(overrides: Partial<Env> = {}): Env {
  const effort = str("LLM_EFFORT", "medium");
  const env: Env = {
    port: Number(str("PORT", "8787")),
    dataDir: path.resolve(ROOT, str("DATA_DIR", "./data")),
    llm: {
      provider: str("LLM_PROVIDER", "anthropic") === "none" ? "none" : "anthropic",
      apiKey: str("ANTHROPIC_API_KEY"),
      model: str("LLM_MODEL", "claude-opus-5-5"),
      effort: (["low", "medium", "high"].includes(effort) ? effort : "medium") as Env["llm"]["effort"],
      timeoutMs: Number(str("LLM_TIMEOUT_MS", "120000")),
      language: str("FEEDBACK_LANGUAGE", "en") === "fr" ? "fr" : "en",
    },
    stt: {
      provider: str("STT_PROVIDER", "none") === "openai" ? "openai" : "none",
      baseUrl: str("STT_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: str("STT_API_KEY"),
      model: str("STT_MODEL", "whisper-1"),
    },
    tts: {
      provider: str("TTS_PROVIDER", "none") === "openai" ? "openai" : "none",
      baseUrl: str("TTS_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: str("TTS_API_KEY"),
      model: str("TTS_MODEL", "tts-1"),
      voices: str("TTS_VOICES", "alloy,onyx,nova,echo,shimmer,fable").split(",").map((s) => s.trim()).filter(Boolean),
    },
    ...overrides,
  };
  fs.mkdirSync(env.dataDir, { recursive: true });
  return env;
}
