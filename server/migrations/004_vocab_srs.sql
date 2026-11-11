-- Vocabulary practice: per-user spaced-repetition state, review log and production challenges.
-- Scheduling parameters live in config/toefl-2026.json (internal.vocabulary.srs).
ALTER TABLE users ADD COLUMN vocab_new_per_day INTEGER;   -- NULL = config default

CREATE TABLE vocab_cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entry_id TEXT,                    -- bank entry; NULL for a personal card
  headword TEXT NOT NULL,
  source_sentence TEXT,             -- personal cards: the sentence the word was found in
  source_exercise_id TEXT,
  origin TEXT NOT NULL,             -- scheduled | manual | harvest_ctw | harvest_question
  reps INTEGER NOT NULL DEFAULT 0,  -- consecutive successful reviews
  lapses INTEGER NOT NULL DEFAULT 0,
  ease REAL NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  review_count INTEGER NOT NULL DEFAULT 0,
  recognition_passed INTEGER NOT NULL DEFAULT 0,
  practice_count INTEGER NOT NULL DEFAULT 0,    -- reviews after recognition was passed
  production_count INTEGER NOT NULL DEFAULT 0,  -- of which production formats
  introduced_at TEXT,
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_vocab_cards_entry ON vocab_cards(user_id, entry_id) WHERE entry_id IS NOT NULL;
CREATE UNIQUE INDEX idx_vocab_cards_personal ON vocab_cards(user_id, headword) WHERE entry_id IS NULL;
CREATE INDEX idx_vocab_cards_due ON vocab_cards(user_id, due_at);

CREATE TABLE vocab_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL REFERENCES vocab_cards(id) ON DELETE CASCADE,
  entry_id TEXT,
  format TEXT NOT NULL,
  production INTEGER NOT NULL,
  first_exposure INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  quality INTEGER NOT NULL,
  error_tag TEXT,
  response TEXT,
  expected TEXT,
  elapsed_ms INTEGER,
  interval_before INTEGER NOT NULL,
  interval_after INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_vocab_reviews_user ON vocab_reviews(user_id, created_at);

CREATE TABLE vocab_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL,               -- spoken | written
  words_json TEXT NOT NULL,         -- [{ card_id, headword, present }]
  text TEXT NOT NULL,
  text_source TEXT NOT NULL,        -- typed | server_stt | browser | none
  feedback_json TEXT,               -- AI feedback, when a provider is configured
  feedback_error TEXT,
  self_rating INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_vocab_challenges_user ON vocab_challenges(user_id, created_at);
