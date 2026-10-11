/**
 * Exports every line each examiner can say (fixed script + every question of
 * every exam in the database, drafts included) to tools/voice/lines.json for
 * the voice renderer.
 *
 *   pnpm voice:lines       (part of pnpm voice:render)
 *
 * Without a database it falls back to the built-in sample set.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SAMPLE_SET } from "../src/content/sample-set";
import { allContentClips } from "../src/engine/compiler";
import { EXAMINERS } from "../src/engine/examiners";
import { allScriptClips } from "../src/engine/script";
import type { Clip, ExamContent } from "../src/engine/types";
import { closeDb, getDb } from "../src/server/db/client";
import { cueCardContent, looseContent } from "../src/server/db/assemble";
import { cardDataOf, listCueCards, listTestsAdmin } from "../src/server/db/library";
import { loadEnv } from "./lib/load-env";

async function contentsFromDb(): Promise<ExamContent[]> {
  const db = getDb();
  // Every test (drafts too, so clips exist before publishing) and every cue card.
  const tests = await listTestsAdmin(db);
  const { items: cards } = await listCueCards(db, { preview: true, limit: 100 });
  let all = cards;
  for (let offset = 100; all.length === offset; offset += 100) {
    all = all.concat((await listCueCards(db, { preview: true, limit: 100, offset })).items);
  }
  return [...tests.map((t) => looseContent(t.parts)), ...all.map((c) => cueCardContent(cardDataOf(c)))];
}

function unique(clips: Clip[]): Clip[] {
  const m = new Map<string, Clip>();
  for (const c of clips) if (c.text.trim() && !m.has(c.key)) m.set(c.key, c);
  return [...m.values()];
}

async function main() {
  loadEnv();
  let contents: ExamContent[];
  try {
    contents = await contentsFromDb();
    console.log(`Read ${contents.length} tests and cue cards from the database.`);
  } catch (e) {
    console.warn(`Database not available (${e instanceof Error ? e.message : e}); using the built-in sample set.`);
    contents = [SAMPLE_SET];
  }

  const examiners = Object.values(EXAMINERS).map((e) => ({
    id: e.id,
    name: e.name,
    voice: e.kokoroVoice,
    lines: unique([...allScriptClips(e.name), ...contents.flatMap(allContentClips)]),
  }));

  const out = path.resolve(__dirname, "..", "tools", "voice", "lines.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), examiners }, null, 2) + "\n");
  for (const e of examiners) console.log(`${e.id} (${e.voice}): ${e.lines.length} lines`);
  console.log(`→ ${path.relative(process.cwd(), out)}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
