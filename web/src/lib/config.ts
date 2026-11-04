import { useEffect, useState } from "react";
import { api } from "./api";

export interface AppConfigView {
  providers: {
    llm: { configured: boolean; provider: string; model: string; language: string };
    stt: { configured: boolean; provider: string; model: string };
    tts: { configured: boolean; provider: string; model: string };
  };
  routing: { model: string; training_threshold: number; training_theta_cut: number; is_official: false; ui_warning: string; official_threshold: null };
  target_options: number[];
  content: { exercises: number; invalid: number; warnings: number; file_errors: string[]; by_task: Record<string, number> };
  official: unknown;
}

let cached: Promise<AppConfigView> | null = null;
export function loadConfig(): Promise<AppConfigView> {
  if (!cached) cached = api.get<AppConfigView>("/api/config");
  return cached;
}

export function useConfig(): AppConfigView | null {
  const [c, setC] = useState<AppConfigView | null>(null);
  useEffect(() => {
    loadConfig().then(setC).catch(() => setC(null));
  }, []);
  return c;
}
