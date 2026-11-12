-- Daily plan on the Dashboard: one row per block marked as done on a given day.
-- The plan itself (phases, weekly rotations, checkpoints) lives in config/toefl-2026.json → internal.plan.
CREATE TABLE plan_checks (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,              -- local calendar day, YYYY-MM-DD
  block TEXT NOT NULL,             -- vocab | shadowing | main | optional
  done_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date, block)
);

-- Exam date requested for Mathias (fresh databases get it from internal.profile_exam_dates).
UPDATE users SET exam_date = '2027-01-09' WHERE id = 'Mathias' AND exam_date IS NULL;
