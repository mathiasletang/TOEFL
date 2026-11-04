# PRD audit — corrections, assumptions and limitations

Source document: `docs/PRD_TOEFL_2026.md`, the research report supplied with the build brief.

Source hierarchy applied:

1. ETS 2026 specifications, as cited in the PRD
2. ETS task rubrics
3. Explicit PRD requirements
4. PRD engineering suggestions
5. Implementation decisions, documented below

> **Verification note.** The ETS facts below (task list, blueprint counts, MST composition, timing, rounding rule, rubric descriptors) come from the PRD and its citations. They were **not re-verified against live ETS pages** during this build. If ETS publishes a change, update `config/toefl-2026.json` (`official` block). No code change is needed.

---

## 1. Target change: C1 → C2

The brief targeted Band 5.0 (C1). The user then asked for **C2**, so the default target is now **Band 6.0** for both profiles. 5.0 and 5.5 stay selectable in Settings.

| Item | PRD (5.0) | Implemented (6.0 default) |
|---|---|---|
| Threshold | mean ≥ 4.75, sum ≥ 19.0 | mean ≥ 5.75, sum ≥ **23.0**; the formula is `target − 0.25`, so any target works |
| Valid 6.0 profiles | — | e.g. 6/6/6/5 or 6/6/5.5/5.5 (`minimalProfiles(6)` in `shared/bands.ts`) |
| Internal routing threshold | 0.75 | **0.80** (configurable per simulation on the launcher) |
| READY gate | overall ≥ 5.0, sections ≥ 4.0, router 0.8, medians ≥ 4 | overall ≥ **6.0**, sections ≥ **5.5**, router **0.9**, rubric medians ≥ **4.5**, 0 timing violations in 7 days |
| AI rewrites | "band_5_5_rewrite" | `target_rewrite`, written at the user's target level (C2 by default), keeping the learner's ideas |
| Content difficulty | B2–C1 | Bank spans B2 → C2. Upper-module selection prefers higher-difficulty items. |

CEFR mapping used: 6.0 = C2, 5.0–5.5 = C1, 4.0–4.5 = B2, 3.0–3.5 = B1, 2.0–2.5 = A2, 1.0–1.5 = A1.

## 2. Corrections to the PRD seed exercises

| Seed | Problem found | Correction |
|---|---|---|
| `r_ctw_001` | Passage has **60 words**; ETS specifies about 70–100. | Added a final sentence (72 words). The gap region is unchanged. |
| `r_ctw_001` | Gap 9 is `incre` + `asingly`. This breaks the PRD's own floor(n/2) rule: 12 letters gives 6 visible letters, so `increa` + `singly`. | Gaps are now **derived from the full text** (`shared/ctw.ts`). The derived key matches the PRD's 10 target words. |
| `r_ctw_001` | `display_text` shows `str_____` (5 blanks) for `eets` (4 letters), and `incre_____` with 5 blanks for 7 letters. | `display_text` is no longer stored. The UI sizes each field to the exact number of missing letters. |
| `r_daily_001`, `r_academic_001`, listening seeds | Some questions had no `id`, `skill` or explanation. | Added ids, skill tags and one-line explanations (needed for review screens and the error profile). |
| `r_academic_001` | Passage has 166 words (ETS: about 200). | Kept. The validator flags it as a warning, not an error. |
| `s_repeat_001` | Item 7 has about 35 syllables, above the ETS research prototype range (≈6–29). | Shortened to about 28 syllables with the same structure. |
| `w_build_001` | The `prefix` + `tokens` + `correct_order` model cannot place fixed words mid-sentence, and the answer string was unchecked. | Normalized to `frame` (fixed text and slots) + `answer` + `alternatives` + `distractors` + `full_response`. The validator checks that frame + answer rebuilds `full_response` exactly. |
| Email / Discussion seeds | Samples are labelled "Band 5 style". | Kept verbatim, labelled "PRD sample response". New prompts use target-level exemplars. |
| AI prompt JSON | Keys end in `_fr`, and the Interview schema forces numeric pronunciation and prosody scores. | Feedback language is configurable (`FEEDBACK_LANGUAGE`). `pronunciation_intelligibility` and `prosody` are nullable and set to `null` without acoustic evidence. |
| All MCQ content | Authored answer positions are skewed toward option A. | Options are **shuffled deterministically** at load time, with the answer index remapped. "None/All of…" options keep their order. |

## 3. Normalized rules (as implemented)

### Complete the Words (`shared/ctw.ts`)

- The first sentence stays intact. The first sentence ends at the first `.`, `!` or `?` followed by a capital letter.
- Truncation starts at the **second word of the second sentence**. Every second word is truncated after that, counting across sentence boundaries, until **10** words are truncated. The rest stays intact. This matches the PRD's worked example word for word.
- Visible letters = `floor(n/2)`, missing letters = `ceil(n/2)`.
- **Assumption:** a target word must contain only letters and be at least 2 letters long. ETS examples show no other case. A passage that would need such a gap is rejected, so the author must rephrase.
- Scoring is case-insensitive and needs exact spelling. There is no partial credit within a word.
- Error classes (orthography, inflection, derivation, function word, meaning in context, no answer) come from an **automatic heuristic**, labelled as such.

### Build a Sentence

- One point per item, for an exact sequence matching the answer or a declared alternative. The 10 points correspond to the 10 BaS raw points in the blueprint.
- Distractors (at most 2) are offered but must stay unused.

### Listen and Repeat

- 7 items, response windows of 8–12 s that never decrease, and syllable length that never decreases (one-syllable tolerance from the heuristic counter).
- The PRD syllable ladder is used **only** as a validator warning. ETS publishes no exact per-item grid.
- Pipeline: transcript → normalization (contractions expanded, punctuation stripped, morphemes kept) → Levenshtein word alignment → WER, CER, content/function-word recall, order score → internal 0–5 proxy.
  - Internal thresholds from the PRD: 5 needs WER ≤ 3 % and no contrary acoustic evidence; 4 needs WER ≤ 12 % and content recall ≥ 85 %; 3 needs content recall ≥ 60 %; 2 needs ≥ 30 %; 1 needs any matched word.
  - The 4-point content-recall cut was relaxed from 0.90 to **0.85**. That way, losing 1 of 9 content words still counts as "meaning essentially preserved".
- Intelligibility is reported **only** when the recognizer returns a confidence (Whisper `avg_logprob`, or browser recognition confidence). Pronunciation and prosody are never inferred from text.
- An empty browser-recognition result counts as "no transcript", not as silence, because it often fails silently. Such items go to self-rating.

### Timing and navigation

| Part | Value used | Basis |
|---|---|---|
| Reading Module 1 / Module 2 | 20 min / 9 min | Blueprint "18–21 + 9" (PRD). 20 is the midpoint choice. |
| Listening Module 1 / lower / upper | 18 / 7 / 11 min | Blueprint (PRD). The module timer includes audio playback. |
| Writing: Build a Sentence | 6 min shared timer | **Assumption.** 23 min total − 7 − 10 = 6. |
| Email / Discussion | 7:00 / 10:00 | Official |
| Speaking | Paced by response windows (8–12 s; 45 s) | Official; no preparation time |
| Drill time limits (Reading, Listening, BaS) | CTW 150 s; Daily 30 + 35 s/q; Academic 60 + 45 s/q; Listening 35 s/q after the audio; LCR 25 s; BaS 35 s | **Internal training paces** from the PRD strategy notes, in `config.internal.drill_seconds` |

Navigation:

- **Reading:** Back is allowed inside a module. You cannot return to Module 1 (ETS, per the PRD).
- **Listening:** no Back.
- **Build a Sentence:** Back is allowed within the BaS block. This is an **assumption**, since the sources don't settle it. Change `allowBack` in `server/simulation.ts` if needed.
- **Speaking:** sequential.

Interruption and refresh behaviour:

- **Deadlines** are stored server-side, so refreshing never resets a clock.
- **Expired strict drills and modules** are auto-submitted from the last autosave on the next request.
- **Listening audio** already played in strict mode is not replayed after a refresh.
- **A Listen-and-Repeat or Interview item** interrupted mid-recording is marked "interrupted" and skipped, not replayed.

## 4. Adaptive simulator

- Module composition follows the published MST blueprint exactly:
  - Reading: router 10 CTW + 5 Daily + 5 Academic; lower 10 CTW + 5 Daily; upper 10 CTW + 5 Academic.
  - Listening: router 8 + 4 + 4 + 4; lower 7 + 4 + 4; upper 3 + 4 + 8.
- Exercises are picked per form with an exact subset sum (for example, 5 Daily-Life questions = a 2-question set + a 3-question set).
  - Unseen exercises are preferred, then difficulty: lower module → easier, upper → harder.
  - No exercise is repeated **within** a form. If a form contains exercises the user has already attempted, the start screen says so.
  - If the bank cannot fill a form, the simulation refuses to start and names the missing task types. There is no silent recycling.
- **Routing:** `official_router_threshold = null`. The training threshold is 0.80 proportion correct, or a θ cut of 1.0 for the `irt-lite` model. The UI shows the "internal training threshold — ETS does not publish its routing cut-off" warning. The route is revealed only after the section; candidates only see "Module 1" and "Module 2".
- **Short simulations** use a reduced internal composition (`config.internal.short_simulation`) and are labelled as non-official.
- The bank currently supports **2** disjoint official-format full tests and **3** short ones (`npm run validate:content`).

## 5. Projections (all internal)

- **Reading/Listening:** Rasch EAP over the last 80 objective items.
  - Prior N(0.5, 1.2²). Item difficulty is an author estimate from the CEFR label (B2 −0.25 … C2 2.2).
  - θ maps to a band by an internal table (θ ≥ 2.0 → 6.0, ≥ 1.5 → 5.5, ≥ 1.0 → 5.0 …). The range is θ ± 1 posterior SD.
  - At least 10 items are needed. Confidence is "low" under 40 items and "medium" above. It is never "high".
- **Writing/Speaking:** proportion of blueprint raw points, using recent scored responses only. Raw points are Writing 20 = 10 BaS + 5 + 5 and Speaking 55 = 7 × 5 + 4 × 5.
  - Missing task types are weighted out and flagged.
  - A proportion table maps the result to a band (≥ 0.95 → 6.0, ≥ 0.88 → 5.5, ≥ 0.80 → 5.0 …).
  - Self-ratings are included, and they are recorded as self-ratings.
- **Overall:** the official rule (mean of four bands, nearest half, ties up) applied to these estimates. The overall exists only when all four sections have an estimate.
- None of these mappings is an ETS conversion table. They need calibration against your real score report once you have one.

## 6. AI evaluation

- Separate evaluator configurations exist for Email, Academic Discussion and Interview (`server/ai/prompts.ts`). They are derived from the PRD prompts and the public rubric descriptors.
- Structured output via JSON schema, then **strict Zod validation**:
  - Integer scores 0–5, confidence 0–1.
  - Criterion scores, error spans with corrections, missing requirements or underdeveloped claims, the highest-impact fix, and a target-level rewrite or model answer.
- Failure handling:
  - Invalid output is stored as `invalid_output`.
  - Exceptions and timeouts are stored as `provider_error`.
  - A missing key returns `unavailable`.
  - In none of these cases is a score written.
- The UI always labels the score as a "task-level rubric (0–5), not a 1–6 section band" and "TOEFL-aligned estimator … not an ETS score".

## 7. Known limitations

1. **Audio realism.** No recorded ETS-style audio ships with the app. Listening uses server TTS when configured, otherwise browser speech synthesis, which is clearly labelled. You can add your own recordings under `content/audio/`.
2. **Pronunciation and prosody** are not scored. That would need forced alignment or phoneme models, which are not implemented. The phonetic layer described in the PRD is **not implemented**. Feedback is limited to word accuracy, timing (WPM) and, when available, ASR confidence.
3. **Browser speech recognition** (the fallback when no STT key is set) works in Chrome/Edge. Chrome sends audio to Google's recognition service; configure a local OpenAI-compatible Whisper server if you need everything to stay offline.
4. **Content volume.** There are 146 original exercises, enough for 2 full official-format tests plus drills. After that, simulations reuse previously attempted items, with a notice. Add content with `docs/CONTENT_GUIDE.md`.
5. **Uncalibrated difficulty.** Item difficulties and every band mapping are author estimates. Treat projections as directional until you can compare them with an official result.
6. **Single machine, no authentication.** By design, the server listens only on `127.0.0.1`.
7. **The PRD's "variance reduction" and per-section "expected hours" model** is implemented as a heuristic priority score. No probability P(overall ≥ target) is computed, because the data to calibrate it does not exist.
