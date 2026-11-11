# TOEFL iBT 2026 Trainer — target Band 6.0 (CEFR C2)

A local-first training instrument for the TOEFL iBT format introduced on **21 January 2026**, built for two users: **Mathias** (target Band 6.0, C2) and **Virgile** (target Band 5.0, C1). Each profile can change its target in Settings (5.0, 5.5 or 6.0).

It is not a general English course. It covers the 12 current task types, strict exam timing, a two-stage adaptive simulator, error-driven drill selection, and transparent internal score projections.

> All scores shown are **internal training estimates** built from this app's own exercises. They are never official TOEFL scores. ETS scoring, routing cut-offs and equating are proprietary (see `docs/PRD_AUDIT.md`).

---

## 1. Quick start

Requirements: **Node.js ≥ 22.13** (22, 24 or 26) and a recent Chrome or Edge (for the microphone and speech features). Firefox works for everything except browser speech recognition. No compiler or Visual Studio is needed: the database uses SQLite built into Node.

```bash
git clone https://github.com/mathiasletang/TOEFL.git
cd TOEFL
npm install
cp .env.example .env        # optional: add API keys (see §3)
npm start                   # builds the UI and serves everything on http://127.0.0.1:8787
```

Open **http://127.0.0.1:8787**, pick a profile and train.

| Command | What it does |
|---|---|
| `npm start` | Production build + local server on port 8787 (UI and API) |
| `npm run dev` | Development: API with auto-reload (8787) + Vite UI with hot reload on **http://localhost:5173** |
| `npm run serve` | Serve the last build without rebuilding |
| `npm run validate:content` | Validate every exercise and vocabulary entry; report simulation forms and vocabulary counts |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run typecheck` | Strict TypeScript check of server, shared engine and UI |
| `npm run check` | typecheck + content validation + tests |

Data is stored in `data/toefl.db` (SQLite) and `data/audio/` (recordings and the TTS cache). Back up the `data/` folder to keep your history. It is git-ignored.

### Windows (PowerShell / VS Code terminal)

If PowerShell says *"l'exécution de scripts est désactivée sur ce système"* when you type `npm`, run this once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Answer `O` (or `Y`), then close and reopen the terminal. Alternatively, type `npm.cmd` instead of `npm`.

If an earlier `npm install` failed halfway, delete the `node_modules` folder before retrying:

```powershell
Remove-Item -Recurse -Force node_modules
npm install
```

`EPERM` errors while deleting mean a program is holding the files open. Close VS Code, delete the folder from the File Explorer, reopen VS Code and retry.

---

## 2. What you can do

| Mode | Where | Behaviour |
|---|---|---|
| **Quick Drill** | Practice | Choose any of the 12 task types and start immediately. You get a correction screen after every item. |
| **Focus Weaknesses** | Focus weaknesses | Picks exercises that target your most costly recurring error patterns, plus spaced retries of failed items. |
| **TOEFL Simulation** | Simulation | Strict, timed sections or a full test. Reading and Listening use Module 1 → Module 2 routing. |

**Strict vs Practice** (toggle on Practice / Focus):

- **Strict:** hard countdown with auto-submit, audio plays once, no back navigation in Listening, no answers shown before submission. The deadline is stored on the server, so a page refresh does not reset the clock. A drill that expires while the tab is closed is submitted from its last autosave.
- **Practice:** the timer is soft (no auto-submit), audio replay is allowed, and early stop is allowed in Speaking.

### The 12 tasks and their interactions

| Section | Task | Interaction |
|---|---|---|
| Reading | Complete the Words | Inline letter fields sized to the exact number of missing letters. The cursor auto-advances, Backspace goes back, and focus time is recorded per gap. Gaps are derived from the original text by the ETS rule. |
| | Read in Daily Life | Notice/email/messages/table rendering + question tabs, keys 1–4/A–D |
| | Read an Academic Passage | Passage + one question at a time; vocabulary questions highlight the word |
| Listening | Listen and Choose a Response | One spoken line. The written replies appear only after the audio ends. |
| | Conversation / Announcement / Academic Talk | Audio once (strict), questions after the audio, no transcript until review |
| Speaking | Listen and Repeat | 7 sentences heard once. Recording starts automatically and stops after 8–12 s. You get a word diff, WER and CER on review. |
| | Take an Interview | 4 questions, recording starts immediately, 45 s each, transcript + AI feedback |
| Writing | Build a Sentence | Click or drag chunks into slots, with distractors and accepted alternative orders |
| | Write an Email | 7:00 hard timer, requirements list, spell-check off |
| | Academic Discussion | 10:00 hard timer, live word count with the 100-word ETS reference |

### Dashboard and progress

The dashboard shows:

- your target and the threshold arithmetic (Band 6.0 needs a section mean ≥ 5.75, i.e. a sum ≥ 23.0);
- the projected overall and section bands with ranges and confidence;
- days remaining, your most critical weakness and the recommended next drill;
- the trend chart and your last full simulation.

The Progress page adds:

- per-task accuracy, EWMA, trend and speed;
- the error profile and the critical-path ranking;
- recent versus historical results and your full attempt history;
- a READY gate scaled to your target.

---

## 3. Optional providers (`.env`)

Nothing below is required. Without it, every objective task works fully, and productive answers are saved but never given an invented score.

| Feature | Variables | Without it |
|---|---|---|
| **AI evaluation** of Email, Academic Discussion and Interview | `ANTHROPIC_API_KEY`, `LLM_MODEL` (default `claude-opus-5-5`), `LLM_EFFORT`, `FEEDBACK_LANGUAGE=en\|fr` | A clear "not configured" notice. The model response is still shown. Interview items can be self-rated. |
| **Speech-to-text** (Listen and Repeat scoring, Interview transcripts) | `STT_PROVIDER=openai`, `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL` | Chrome's built-in speech recognition is used, labelled "approximate". If it is unavailable, items can be self-rated against the ETS descriptors. |
| **Text-to-speech** (listening stimuli, sentences, interview questions) | `TTS_PROVIDER=openai`, `TTS_BASE_URL`, `TTS_API_KEY`, `TTS_MODEL`, `TTS_VOICES` | The browser's speech synthesis is used, labelled as a fallback that does not reproduce ETS audio. |

The STT and TTS variables target any **OpenAI-compatible** endpoint (`/v1/audio/transcriptions`, `/v1/audio/speech`), so a local Whisper-compatible server works too. API keys are read only by the local server and never sent to the browser. Generated TTS files are cached in `data/audio/tts/`.

**Recorded audio:** place files at `content/audio/<exerciseId>/<key>.mp3` (keys: `seg0…` for listening scripts, `item1…item7` for Listen and Repeat, `q1…q4` for Interview). If every key of an exercise has a file, the recordings are used instead of TTS.

AI evaluation calls the Anthropic Messages API with structured JSON output. Every answer is validated against a Zod schema, and invalid output, timeouts and provider errors are stored as failures without a score. Server-side refusal fallbacks (`fallbacks: "default"`) are enabled. Each evaluated response costs one API call; an interview costs four, one per question.

---

## 4. Adding exercises (no code changes)

Drop a JSON file into `content/exercises/`, run `npm run validate:content`, then restart. The format, the rules and examples for every task type are in **`docs/CONTENT_GUIDE.md`**.

The same applies to the **vocabulary bank** in `content/vocab/` (1,000 original entries in 20 packs, data only for now — no screen uses it yet). Its "Essentials" tier is an internal high-yield selection, not an official list.

Invalid exercises and vocabulary entries are never imported. The server logs them and the validator fails. The current bank holds 146 original exercises and supports **2 complete official-format full tests** with no exercise reused inside or across forms (`npm run validate:content` prints the exact counts).

---

## 5. How the numbers are produced (and their limits)

| Number | Method | Official? |
|---|---|---|
| Overall band | Mean of 4 section bands rounded to the nearest 0.5, ties up (ETS rule) | **Rule is official**; inputs are estimates |
| Reading / Listening projection | Rasch (1PL) EAP ability over your last 80 items, with author-estimated item difficulty, mapped to a band by an internal table; range = ±1 SD | Internal heuristic |
| Writing / Speaking projection | Share of blueprint raw points (Writing 20 = 10 BaS + 5 + 5; Speaking 55 = 7×5 + 4×5) from recent scored responses, mapped by an internal table | Internal heuristic |
| Simulation routing | Module 1 proportion correct ≥ **80 %** (configurable on the launcher; `irt-lite` model available in config) | **Not ETS** — ETS does not publish its cut-off |
| Listen and Repeat 0–5 | WER/CER/content- and function-word recall/order thresholds from the PRD | Internal proxy; pronunciation is not judged from text |
| Email / Discussion / Interview 0–5 | LLM estimator prompted with the public ETS task rubrics | Estimate; ETS engines are proprietary |
| Recommendations | `0.40·error frequency + 0.25·recency + 0.20·band impact + 0.15·speed deficit` | Heuristic, not a calibrated probability |

Confidence labels are `not enough data`, `low` and `medium`. The app never shows "high", because nothing here is calibrated against real TOEFL results.

---

## 6. Project layout

```
config/toefl-2026.json      official blueprint values + every internal parameter
content/exercises/*.json    exercise bank (validated on load)
content/vocab/*.json        vocabulary bank, one pack per category (validated on load)
shared/                     isomorphic engine: schemas, CTW rule, scoring, alignment, IRT, router, bands, validator
server/                     Fastify API, SQLite + migrations, sessions/timing, simulation, analytics, AI, speech
web/src/                    React UI: tasks/ (12 interactions + review), pages/, lib/timer.ts (shared timer state machine)
scripts/validate-content.ts content validator + simulation sufficiency report
tests/                      Vitest unit and API integration tests
docs/                       PRD (source), PRD audit, content guide, implementation plan
```

## 7. Troubleshooting

- **No sound in listening tasks:** without a TTS key the browser voice is used. Check the system volume and that the browser has English voices. The audio panel shows which source is in use.
- **Microphone blocked:** allow it for `127.0.0.1` in the browser's site settings. Recording needs `localhost`/`127.0.0.1` or HTTPS.
- **"Port in use":** set `PORT=…` in `.env`.
- **Reset a profile:** stop the server and delete `data/toefl.db` (this erases both profiles).
