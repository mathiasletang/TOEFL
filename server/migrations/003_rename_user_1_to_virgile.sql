-- Rename the profile "User_1" to "Virgile" and set its target to Band 5.0 (C1), keeping all history.
-- On a fresh database this does nothing: the profiles are created after migrations run.
INSERT INTO users (id, display_name, target_band, exam_date, created_at)
  SELECT 'Virgile', 'Virgile', 5.0, exam_date, created_at FROM users WHERE id = 'User_1';
UPDATE sessions SET user_id = 'Virgile' WHERE user_id = 'User_1';
UPDATE attempts SET user_id = 'Virgile' WHERE user_id = 'User_1';
UPDATE item_responses SET user_id = 'Virgile' WHERE user_id = 'User_1';
UPDATE recordings SET user_id = 'Virgile' WHERE user_id = 'User_1';
UPDATE ai_evaluations SET user_id = 'Virgile' WHERE user_id = 'User_1';
UPDATE simulations SET user_id = 'Virgile' WHERE user_id = 'User_1';
UPDATE progress_snapshots SET user_id = 'Virgile' WHERE user_id = 'User_1';
DELETE FROM users WHERE id = 'User_1';
