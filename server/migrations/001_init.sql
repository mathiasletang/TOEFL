-- Users (fixed two-user local app)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  target_band REAL NOT NULL DEFAULT 6.0,
  exam_date TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Content packs and exercises (stimulus + interaction + scoring live in content_json)
CREATE TABLE content_packs (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  copyright_policy TEXT NOT NULL,
  file TEXT NOT NULL,
  loaded_at TEXT NOT NULL
);

CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES content_packs(id),
  section TEXT NOT NULL,
  task_type TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  b REAL NOT NULL,
  source_type TEXT NOT NULL,
  source_reference TEXT,
  item_count INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_exercises_task ON exercises(task_type, active);

-- Normalised questions / scorable items with their keys (derived from content on load)
CREATE TABLE exercise_items (
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  item_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- mcq | gap | ordering | repeat | interview | essay
  prompt TEXT,
  answer_json TEXT,                -- correct answer (index, word, chunk order, reference text)
  accepted_json TEXT,              -- accepted alternatives
  skill TEXT,
  b REAL NOT NULL,
  PRIMARY KEY (exercise_id, item_key)
);

-- Audio assets: recorded files or cached TTS renders
CREATE TABLE audio_assets (
  id TEXT PRIMARY KEY,
  exercise_id TEXT,
  item_key TEXT,
  source TEXT NOT NULL,            -- recorded | tts
  provider TEXT,
  voice TEXT,
  text_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_audio_hash ON audio_assets(text_hash, voice, provider);

-- Timed sessions (drills and simulation modules share the same timing record)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,              -- drill | simulation_module
  mode TEXT NOT NULL,              -- practice | strict
  exercise_id TEXT,
  simulation_id TEXT,
  status TEXT NOT NULL,            -- active | submitted | expired | abandoned
  time_limit_ms INTEGER,
  started_at TEXT NOT NULL,
  deadline_at TEXT,
  ended_at TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id, status);

-- Attempts: one per exercise answered
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  exercise_id TEXT NOT NULL REFERENCES exercises(id),
  task_type TEXT NOT NULL,
  section TEXT NOT NULL,
  session_id TEXT,
  simulation_id TEXT,
  module_stage TEXT,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  time_limit_ms INTEGER,
  timed_out INTEGER NOT NULL DEFAULT 0,
  timing_violation INTEGER NOT NULL DEFAULT 0,
  response_json TEXT NOT NULL,
  raw_score REAL,
  max_score REAL NOT NULL,
  accuracy REAL,
  pending INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL,
  error_tags_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX idx_attempts_user ON attempts(user_id, submitted_at);
CREATE INDEX idx_attempts_user_task ON attempts(user_id, task_type);

-- Item-level responses for analytics
CREATE TABLE item_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  section TEXT NOT NULL,
  item_key TEXT NOT NULL,
  correct INTEGER,
  score REAL,
  max_score REAL NOT NULL,
  response TEXT,
  expected TEXT,
  skill TEXT,
  b REAL NOT NULL,
  error_tag TEXT,
  elapsed_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_items_user ON item_responses(user_id, task_type, created_at);

-- Error taxonomy (reference)
CREATE TABLE error_categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

-- Speaking recordings
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  exercise_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  attempt_id TEXT,
  session_id TEXT,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  duration_ms INTEGER,
  transcript TEXT,
  transcript_source TEXT,
  asr_confidence REAL,
  stt_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_recordings_user ON recordings(user_id, exercise_id);

-- AI evaluations (Writing / Interview); failures are stored too, never faked
CREATE TABLE ai_evaluations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  task_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,            -- ok | invalid_output | provider_error | unavailable
  rubric_score REAL,
  confidence REAL,
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_attempt ON ai_evaluations(attempt_id);

-- Adaptive / section / full simulations
CREATE TABLE simulations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,             -- reading | listening | writing | speaking | full
  length TEXT NOT NULL,            -- full | short
  status TEXT NOT NULL,            -- active | completed | abandoned
  router_config_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,         -- ordered steps with exercise ids
  step_index INTEGER NOT NULL DEFAULT 0,
  routes_json TEXT NOT NULL DEFAULT '{}',
  results_json TEXT,
  notices_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_sim_user ON simulations(user_id, status);

-- Progress snapshots (projection history for trends)
CREATE TABLE progress_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  projection_json TEXT NOT NULL
);
CREATE INDEX idx_snap_user ON progress_snapshots(user_id, created_at);
