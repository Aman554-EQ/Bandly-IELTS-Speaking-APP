/**
 * The examiners' recorded voices (public/voice/<examiner>/manifest.json):
 * each folder holds only its own examiner's voice, and every fixed examiner
 * line is recorded with exactly the script's wording, so the exam never mixes
 * voices or falls back for the standard lines.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileBlueprint } from "@/engine/compiler";
import { EXAMINERS, type ExaminerId } from "@/engine/examiners";
import { allScriptClips, PROBE_IDS, probeClip } from "@/engine/script";
import { SAMPLE_SET } from "@/content/sample-set";

interface Manifest {
  clips: Record<string, { file: string; text: string; voice: string }>;
}
const manifest = (id: ExaminerId): Manifest =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "voice", id, "manifest.json"), "utf8"));

describe.each(Object.values(EXAMINERS))("$name's recorded voice", (examiner) => {
  const m = manifest(examiner.id);

  it("uses only this examiner's Kokoro voice, of the right gender", () => {
    const voices = new Set(Object.values(m.clips).map((c) => c.voice));
    expect([...voices]).toEqual([examiner.kokoroVoice]);
    // Kokoro naming: bf_ = British female, bm_ = British male.
    expect(examiner.kokoroVoice.startsWith(examiner.gender === "female" ? "bf_" : "bm_")).toBe(true);
  });

  it("has every fixed examiner line, with the script's exact wording and an audio file", () => {
    const lines = [...allScriptClips(examiner.name), ...PROBE_IDS.map(probeClip)];
    for (const l of lines) {
      const c = m.clips[l.key];
      expect(c, `missing clip ${l.key}`).toBeDefined();
      expect(c.text, l.key).toBe(l.text);
      expect(fs.existsSync(path.join(process.cwd(), "public", "voice", examiner.id, c.file)), c.file).toBe(true);
    }
  });

  it("the exam greets with this examiner's own name", () => {
    const bp = compileBlueprint({
      mode: "part1",
      fidelity: "exam",
      content: SAMPLE_SET,
      localHour: 10,
      examiner: examiner.id,
    });
    expect(bp.examiner.name).toBe(examiner.name);
    const greeting = bp.steps.find((s) => s.kind === "say");
    expect(greeting && "clip" in greeting ? greeting.clip.text : "").toContain(examiner.name);
  });
});
