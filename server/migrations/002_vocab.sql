-- Vocabulary bank (content/vocab/*.json). Original content; the "core" tier is an
-- internal high-yield selection, not an official list.
CREATE TABLE vocab_packs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  selection_note TEXT NOT NULL,
  copyright_policy TEXT NOT NULL,
  file TEXT NOT NULL,
  loaded_at TEXT NOT NULL
);

CREATE TABLE vocab_entries (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL REFERENCES vocab_packs(id),
  headword TEXT NOT NULL,
  kind TEXT NOT NULL,            -- word | collocation | phrasal_verb | idiom | formula
  pos TEXT NOT NULL,
  cefr TEXT NOT NULL,            -- B2 | C1 | C2 (author estimate)
  tier TEXT NOT NULL,            -- core | extended | mastery
  category TEXT NOT NULL,
  function TEXT,                 -- functional_language only
  register TEXT NOT NULL,
  has_false_friend INTEGER NOT NULL DEFAULT 0,
  has_spelling_trap INTEGER NOT NULL DEFAULT 0,
  content_json TEXT NOT NULL,    -- full validated entry
  content_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_vocab_tier ON vocab_entries(tier, active);
CREATE INDEX idx_vocab_category ON vocab_entries(category, active);
CREATE INDEX idx_vocab_headword ON vocab_entries(headword);
