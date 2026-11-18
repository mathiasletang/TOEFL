-- Plan dosage: drills started from Focus weaknesses are marked so the Dashboard can compare
-- the real weekly mix with the plan's targets; shadowing segments served per day (no repeat
-- within the window set in internal.plan.shadowing).
ALTER TABLE sessions ADD COLUMN origin TEXT;   -- NULL | focus

CREATE TABLE shadowing_log (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,                          -- local calendar day, YYYY-MM-DD
  segment_id TEXT NOT NULL,                    -- <exercise id>:<audio segment>:<piece>
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, date, segment_id)
);
CREATE INDEX idx_shadowing_user_segment ON shadowing_log(user_id, segment_id, date);
