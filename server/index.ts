import { buildApp } from "./app";

const { app, env, content } = await buildApp({ logger: false });
for (const f of content.fileErrors) console.error(`[content] ${f}`);
for (const e of content.errors) console.error(`[content] ${e.id}: ${e.message}`);
if (content.errors.length) console.error(`[content] ${content.errors.length} invalid exercise(s) were NOT imported. Run: npm run validate:content`);
await app.listen({ port: env.port, host: "127.0.0.1" });
console.log(`TOEFL trainer API on http://127.0.0.1:${env.port}  (${content.exercises.length} exercises loaded)`);
console.log(`AI evaluation: ${env.llm.provider === "anthropic" && env.llm.apiKey ? env.llm.model : "not configured"} · STT: ${env.stt.provider} · TTS: ${env.tts.provider}`);
