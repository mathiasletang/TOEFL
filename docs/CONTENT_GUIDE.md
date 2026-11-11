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

---

# Vocabulary bank

The vocabulary bank lives in `content/vocab/`, **one JSON file per category**. It is validated by `npm run validate:content`, loaded into SQLite at startup (tables `vocab_packs` and `vocab_entries`, migration `002_vocab.sql`), and has no user interface yet.

All entries are original. Do not copy dictionary definitions or import external word lists. The **core** tier ("Essentials") is an *internal high-yield selection*, not an official list, and CEFR levels are author estimates. Every pack's `selection_note` must say so.

## File format

```json
{
  "pack": {
    "id": "vocab_geo_v1",
    "category": "geology",
    "description": "…",
    "selection_note": "Internal selection …; this is not an official list and CEFR levels are author estimates.",
    "copyright_policy": "Original content …"
  },
  "entries": [ { … } ]
}
```

## Entry fields

| Field | Rule |
|---|---|
| `id` | `v_<pack>_<headword>`, lowercase with underscores, unique in the whole bank |
| `headword` | The word or expression. The pair headword + `pos` must be unique in the whole bank. |
| `kind` | `word` (one word, hyphenated compounds included), `collocation`, `phrasal_verb`, `idiom` or `formula` |
| `pos` | `noun verb adjective adverb preposition conjunction determiner pronoun phrase`. Phrasal verbs are `verb`; other expressions are `phrase`. |
| `cefr` | `B2`, `C1` or `C2` (author estimate) |
| `tier` | `core`, `extended` or `mastery` — see the table below |
| `category` | Must match the pack's category |
| `function` | Required in `functional_language` only (see the list below) |
| `definition` | Plain English, written for this app. It must not contain the headword. |
| `translation_fr` | French translation, required |
| `example_academic` | A sentence in academic register |
| `example_spoken` | A sentence as it would be said in conversation |
| `collocations` | Up to 4. A `word` needs at least 2. |
| `word_family` | Derived forms with their part of speech: `[{ "form": "analysis", "pos": "noun" }]` |
| `inflections` | Optional. Irregular forms the examples may use, when the validator does not know them. |
| `synonyms` | Up to 4 near-synonyms; may be empty for technical terms |
| `register` | `formal`, `neutral` or `informal` |
| `ipa` | General American pronunciation between slashes |
| `false_friend_fr` | Optional, required in `false_friends_fr`: `{ "trap": "librairie", "correct": "une librairie = a bookstore" }` |
| `spelling_trap` | Optional, required in `spelling_traps`: a short note on the point to watch |

Both examples must contain the headword, one of its inflections, or a form declared in `word_family`. For expressions, a few words may come between the parts ("mull **it** over"), and articles may change ("meet **the** deadline").

## Tiers

| Tier | Label | CEFR allowed | What goes in |
|---|---|---|---|
| `core` | Essentials | B2, C1 | Internal high-yield selection: cross-disciplinary academic words, campus and daily-life vocabulary, connectors and formulas for Email, Academic Discussion and Interview |
| `extended` | Extended (C1) | C1, and B2 for common discipline words | Vocabulary by discipline and function |
| `mastery` | Mastery (C2) | C2 | Nuance, precision and formal register |

Internal targets (in `config/toefl-2026.json` → `internal.vocabulary`): 400 core, 350 extended, 250 mastery; about 30 % B2, 45 % C1, 25 % C2. The validator warns when the CEFR shares drift by more than 5 points.

## Categories and functions

Categories: `general_academic`, `biology`, `ecology`, `geology`, `astronomy`, `psychology`, `sociology`, `anthropology`, `economics`, `history`, `art_history`, `linguistics`, `environmental_science`, `technology`, `campus_daily_life`, `functional_language`, `academic_collocations`, `phrasal_verbs_idioms`, `false_friends_fr`, `spelling_traps`.

Functions (`functional_language` only): `cause_consequence`, `concession`, `hedging`, `agreement_disagreement`, `speech_structuring`, `email_request`, `email_complaint`, `email_apology`, `email_follow_up`, `email_recommendation`.

## What the validator checks

- unique `id`, and unique headword + part of speech across all packs;
- each example contains the headword or a declared form, and the two examples differ;
- the definition does not contain the defined word or expression;
- the French translation is filled in;
- at least 2 collocations for `kind: "word"`;
- tier and CEFR are coherent, and the entry's category matches its pack;
- pack-specific fields are present (`function`, `false_friend_fr`, `spelling_trap`);
- one pack per category, and no pack presents itself as an official list.

`npm run validate:content` prints the counts by tier, CEFR and category. Add `-- --vocab-warnings` to list warnings, such as a collocation that does not contain its headword.
