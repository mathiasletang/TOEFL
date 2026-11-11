import raw from "../config/toefl-2026.json";
import type { TaskType } from "./schema";
import type { RepeatProxyConfig } from "./align";

export type Composition = Partial<Record<TaskType, number>>;
export interface MstSection {
  router: Composition;
  lower: Composition;
  upper: Composition;
  router_minutes: number;
  lower_minutes: number;
  upper_minutes: number;
}

export interface AppConfig {
  official: {
    format_effective_date: string;
    mst: { reading: MstSection & { back_navigation_within_module: boolean }; listening: MstSection & { back_navigation_within_module: boolean } };
    writing: { build_a_sentence_items: number; email_seconds: number; discussion_seconds: number; discussion_effective_minimum_words: number; raw_points: number };
    speaking: { listen_and_repeat_items: number; listen_and_repeat_response_seconds_range: [number, number]; interview_questions: number; interview_response_seconds: number; preparation_seconds: number; raw_points: number };
    router_threshold: null;
    lower_path_score_ceiling: null;
  };
  internal: {
    default_target_band: number;
    target_options: number[];
    routing: { model: "percent-correct" | "irt-lite"; training_threshold: number; training_theta_cut: number; is_official: false; ui_warning: string };
    writing_build_a_sentence_minutes: number;
    short_simulation: { reading: MstSection; listening: MstSection };
    drill_seconds: Record<string, number>;
    projection: {
      rl_theta_cutpoints: Array<{ theta: number; band: number }>;
      ws_proportion_cutpoints: Array<{ p: number; band: number }>;
      recent_window_items: number;
      min_items_for_estimate: number;
      ewma_alpha: number;
    };
    listen_repeat_proxy: RepeatProxyConfig;
    recommendation_weights: { error_frequency: number; recency: number; band_impact: number; speed_deficit: number };
    vocabulary: {
      tiers: Record<"core" | "extended" | "mastery", { label: string; cefr: string[]; note: string }>;
      targets: { tier: Record<"core" | "extended" | "mastery", number>; cefr_share: Record<"B2" | "C1" | "C2", number>; share_tolerance: number };
      srs: {
        new_per_day_default: number;
        new_per_day_options: number[];
        initial_ease: number;
        minimum_ease: number;
        first_interval_days: number;
        second_interval_days: number;
        relearn_minutes: number;
        mature_interval_days: number;
        fast_answer_ms: { choice: number; typed: number };
        production_share_min: number;
        leech_lapses: number;
        retention_window_days: number;
        challenge_words: number;
        challenge_seconds: number;
      };
    };
    ready_gate: {
      last_full_simulations: number;
      minimum_projected_overall: number;
      minimum_projected_section: number;
      router_training_accuracy: { reading: number; listening: number };
      email_median_rubric: number;
      discussion_median_rubric: number;
      repeat_median_rubric: number;
      interview_median_rubric: number;
      max_timing_violations_last_7_days: number;
    };
  };
}

export const CONFIG = raw as unknown as AppConfig;

export function thetaToBand(theta: number): number {
  for (const c of CONFIG.internal.projection.rl_theta_cutpoints) if (theta >= c.theta) return c.band;
  return 1.0;
}

export function proportionToBand(p: number): number {
  for (const c of CONFIG.internal.projection.ws_proportion_cutpoints) if (p >= c.p - 1e-9) return c.band;
  return 1.0;
}
