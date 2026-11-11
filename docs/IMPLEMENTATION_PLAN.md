# Implementation plan and status

| Phase | Scope | Status |
|---|---|---|
| 1. Audit & architecture | PRD audit (`docs/PRD_AUDIT.md`), single-package TypeScript stack: React + Vite + Tailwind / Fastify / SQLite (better-sqlite3) / Zod / Vitest; shared isomorphic engine in `shared/` | Done |
| 2. Foundation | Migrations (`server/migrations`), two fixed users with separate data, navigation, dashboard, server-side session/deadline engine, shared timer state machine (`web/src/lib/timer.ts`) | Done |
| 3. Exercise engine | 12 dedicated interactions, 146 validated original exercises, server-side scoring, item-level persistence, review screens with explanations | Done |
| 4. Speaking & Writing | MediaRecorder capture + local storage, optional OpenAI-compatible STT/TTS, browser fallbacks (labelled), WER/CER alignment, AI evaluators with schema validation, self-rating fallback | Done |
| 5. Adaptive simulation | Official MST composition, exact subset assembly, internal configurable routing, module timers with server-side auto-submit, section/full/short simulations, sufficiency validator | Done |
| 6. Analytics | Rasch projections with ranges, raw-point projections, overall rounding, error profile, priority-based recommendations, focus mode, trends, recent vs historical, READY gate | Done |
| 7. Testing & polish | `npm run check` (typecheck, content validation, 46 Vitest tests), Playwright smoke run of 14 UI flows (see final report), responsive layout | Done |
| 8. Vocabulary bank (data) | `content/vocab/` (20 packs, 1,000 original entries), Zod schema and validator in `shared/vocab.ts`, migration `002_vocab.sql`, loader `server/vocab.ts`, counts in `npm run validate:content` | Done — no UI yet |

Not implemented (documented in PRD_AUDIT §7): phoneme-level pronunciation scoring, calibrated P(overall ≥ target).
