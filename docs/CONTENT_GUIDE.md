# Adding exercises

Every exercise lives in a JSON file under `content/exercises/`. You can add files or exercises without touching code:

1. Create or extend a file:
   ```json
   {
     "pack": { "id": "my_pack_v1", "description": "…", "copyright_policy": "Original content. No operational ETS item copied." },
     "exercises": [ { … }, { … } ]
   }
   ```
2. Run `npm run validate:content`. Fix every `✗`; review every `!` warning.
3. Restart the server. Valid exercises are imported, changed ones are updated, and removed ones are deactivated (their history is kept).

The schemas are in `shared/schema.ts` and the checks in `shared/validate.ts`. The fields below are the ones you need to write.

## Common fields

| Field | Rule |
|---|---|
| `id` | lowercase snake_case, unique across the whole bank (prefix by section: `r_`, `l_`, `s_`, `w_`) |
| `section`, `task_type` | must match (e.g. `reading` + `complete_the_words`) |
| `difficulty` | `A1 A2 B1 B2 B2-C1 C1 C1-C2 C2` — also sets the default item difficulty for projections and module selection |
| `source_type` | `ets_format_synthetic` for original content; `ets_official` only for material you are licensed to use |
| `source_reference` | optional free text |
| `b` | optional difficulty override in logits (−3…3) |
| `drill_seconds` | optional training time limit override (20–1800) |

Multiple-choice questions (all reading and listening sets) use this shape:

```json
{ "id": "q1", "stem": "…", "options": ["…","…","…","…"], "answer_index": 2,
  "skill": "detail", "explanation": "One sentence that justifies the key.", "highlight": "word (vocabulary questions in reading only)" }
```

- `skill` is one of: `purpose main_idea detail inference vocabulary rhetorical_function organization reference speaker_intent next_action pragmatic_response attitude`.
- Options are shuffled automatically when the bank is loaded. Don't refer to "option B" in explanations; quote the option text instead.

## Per task

**complete_the_words**
- Fields: `topic`, `passage`.
- Write a single paragraph of 70–100 words.
- Gaps are computed for you: words 2, 4, 6 … from the second word of sentence 2, ten in total.
- Every one of those ten words must be letters only and at least 2 letters long. No numbers, hyphens, apostrophes or one-letter words such as "a" or "I". If the validator complains, rephrase.

**read_in_daily_life**
- Fields: `stimulus` and 2–3 `questions`.
- `stimulus` is `{ format, title?, meta?: [{label,value}], body? | messages?: [{sender,time?,text}] | table?: {columns,rows}, footer? }`, 15–150 words.
- `format` is one of: `notice email text_messages schedule menu form webpage advertisement invoice social_post memo`.

**read_academic_passage**
- Fields: `title`, `discipline`, `passage` (paragraphs separated by a blank line, about 200 words), exactly 5 `questions`.

**listen_choose_response**
- Fields: `audio` (exactly one segment `{speaker, voice: female|male|neutral, text}`), `options` (4), `answer_index`, `skill`, `explanation`.

**conversation / announcement / academic_talk**
- All three have `context` (the line shown on screen) and `audio` (segments) plus a question list:

| Task | Audio | Questions |
|---|---|---|
| conversation | exactly 2 speakers, at least 4 turns | 2 |
| announcement | 40–85 words | 2 |
| academic_talk | 100–250 words, plus a `title` field | 4 |

**listen_and_repeat**
- Fields: `scenario`, `speaker_voice`, exactly 7 `items` `{index 1..7, text, response_seconds 8..12}`.
- Lengths and response windows must not decrease from one item to the next.
- Aim for roughly 5–8 syllables for the first item, rising to 20–29 for the last.

**take_an_interview**
- Fields: `scenario`, `interviewer_voice`, `response_seconds: 45`, exactly 4 `questions`.
- Question levels go `personal_experience → preference → general_opinion → policy_opinion`.

**build_a_sentence**
```json
{ "context": "What did the interviewer ask you?",
  "frame": ["She asked", null, null, null, null, "."],
  "answer": ["what", "I", "found", "most challenging"],
  "alternatives": [],
  "distractors": ["did I find"],
  "full_response": "She asked what I found most challenging.",
  "pattern": "embedded_questions",
  "explanation": "…" }
```
- `frame` mixes fixed text with `null` slots. The number of slots must equal the number of answer chunks.
- `full_response` must equal frame + answer exactly. The validator rebuilds it, removing the space before punctuation.
- List every other genuinely correct order in `alternatives`; each must use the same chunks.
- At most 2 distractors; a distractor must not also be an answer chunk.
- `pattern` is one of: `embedded_questions noun_complement_clauses relative_clauses verb_complement_patterns modals_and_tense conditionals passives comparatives coordination_and_subordination`.

**write_an_email**
- Fields: `time_limit_seconds: 420`, `scenario`, `recipient_name`, `recipient_role`, `subject`, 2–4 `requirements`, `exemplar`, `exemplar_label`.

**academic_discussion**
- Fields: `time_limit_seconds: 600`, `course`, `professor {name, prompt}`, exactly 2 `students {name, text}`, `exemplar` (at least 100 words), `exemplar_label`.

## Recorded audio (optional)

Put audio files at `content/audio/<exercise id>/<key>.mp3`. `.wav`, `.ogg` and `.webm` also work. The keys are:

| Task | Keys |
|---|---|
| Listening scripts | `seg0`, `seg1`, … in script order |
| Listen and Repeat | `item1` … `item7` |
| Interview | `q1` … `q4` |

Recordings are used only when every key of the exercise has a file. Otherwise the configured TTS or the browser fallback plays the script.

## Simulation sufficiency

`npm run validate:content` ends with the number of disjoint forms the bank can build for each simulation type. One full official-format test consumes:

| Section | Exercises per form |
|---|---|
| Reading | 3 Complete the Words passages, 10 Daily-Life questions (two 2-question sets + two 3-question sets), 2 academic passages |
| Listening | 18 Choose-a-Response items, 6 conversations, 4 announcements, 3 talks |
| Writing | 10 Build a Sentence items, 1 email, 1 discussion |
| Speaking | 1 Listen-and-Repeat set, 1 interview |
