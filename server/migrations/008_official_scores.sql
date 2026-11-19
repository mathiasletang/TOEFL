-- Scores of an official ETS test entered by the user (one row per test taken).
-- Shown as an anchor on Progress and counted as a diagnostic on the Today page.
-- The overall band is not stored: it is the mean of the four sections rounded to the nearest half band.
CREATE TABLE official_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  taken_on TEXT NOT NULL,          -- YYYY-MM-DD
  reading REAL NOT NULL,
  listening REAL NOT NULL,
  writing REAL NOT NULL,
  speaking REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_official_scores_user ON official_scores(user_id, taken_on);
