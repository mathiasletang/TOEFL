-- Vocabulary recalibration for French speakers.
-- triage: 'known' (excluded from new cards; one in N verified later in production) or 'learn'.
ALTER TABLE vocab_cards ADD COLUMN triage TEXT;
ALTER TABLE vocab_cards ADD COLUMN verify_due_at TEXT;
ALTER TABLE vocab_cards ADD COLUMN verified_at TEXT;
-- Computed at load: similarity between the headword and its French translation (0-1).
ALTER TABLE vocab_entries ADD COLUMN transparent_fr REAL;
