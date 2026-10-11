// Live check against the running dev server and the real Groq API.
// Creates a Part 1 session, sends spoken takes (Kokoro-generated WAVs),
// prints what the examiner understood, then scores the part.
//
//   pnpm dev --port 3100   (in another terminal)
//   node scripts/live-check.mjs [baseUrl]
import { readFileSync } from "node:fs";
import { testStudentToken } from "./lib/clerk-test-token.mjs";

for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* optional */
  }
}
// Calls the API as the Clerk test student (Development instance only).
const AUTH = { Authorization: `Bearer ${await testStudentToken(900)}` };

const BASE = process.argv[2] ?? "http://localhost:3100";
const fx = (n) => new Blob([readFileSync(`tests/e2e/fixtures/say-${n}.wav`)], { type: "audio/wav" });

async function json(res) {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t.slice(0, 300) };
  }
}

const s = await json(
  await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({ mode: "part1", fidelity: "exam", examinerId: "james" }),
  }),
);
console.log("session:", s.id);

let n = 0;
async function take(fixture, q, kind = "main", part = 1, attempt = 0, speechMs = 3000) {
  const meta = {
    takeId: `t${++n}`,
    part,
    questionId: q.id,
    question: q.text,
    kind,
    attempt,
    outcome: "end_of_turn",
    speechMs,
    durationMs: speechMs + 2500,
    firstSpeechLatencyMs: 700,
    scored: kind !== "name",
  };
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  form.append("audio", fx(fixture), `${meta.takeId}.wav`);
  const t0 = Date.now();
  const r = await json(
    await fetch(`${BASE}/api/sessions/${s.id}/turns`, { method: "POST", body: form, headers: AUTH }),
  );
  const a = r.analysis ?? r;
  console.log(
    `${fixture.padEnd(11)} → ${String(a.intent).padEnd(22)} [${a.source}] ${Date.now() - t0}ms  "${(a.transcript ?? "").slice(0, 70)}"${a.reason ? `  (${a.reason})` : ""}`,
  );
  return a;
}

const q1 = { id: "walking-4", text: "Would you ever like to go on a walking holiday?" };
const q2 = { id: "walking-3", text: "What places are there to go for a walk near where you live?" };
const q3 = { id: "walking-2", text: "Did you walk more when you were at school than now?" };

await take("repeat", q1, "main", 1, 0, 2_400);
await take("clarify", q1, "main", 1, 1, 2_300);
await take("answer", q1, "main", 1, 2, 10_000);
await take("incomplete", q2, "main", 1, 0, 3_200);
await take("longanswer", q2, "main", 1, 1, 27_000);
await take("dontknow", q3, "main", 1, 0, 1_300);
await take("opinion", q3, "main", 1, 1, 3_000);

console.log("\nscoring Part 1 …");
const t0 = Date.now();
const rep = await json(
  await fetch(`${BASE}/api/sessions/${s.id}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: "{}",
  }),
);
console.log(`scored in ${Date.now() - t0}ms with ${rep.model}`);
if (!rep.parts) console.log(rep);
else {
  const p = rep.parts[0];
  console.log("overall:", rep.overall, "criteria:", rep.criteria);
  console.log("part band:", p.band, "conduct:", p.conduct, "adjustments:", p.adjustments);
  console.log("feedback:", p.feedback);
  console.log("summary:", rep.summary.slice(0, 200));
}
console.log(`\nOpen: ${BASE}/results/${s.id}`);
