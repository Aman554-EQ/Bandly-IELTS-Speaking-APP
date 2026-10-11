import { describe, expect, it } from "vitest";
import type { TurnIntent } from "@/engine/interaction";
import type { PartReport, TurnRecord } from "./db/types";
import {
  answersForPart,
  buildPartReport,
  combineParts,
  conductAdjustments,
  conductForPart,
  parseJson,
  partLlmSchema,
  partUserMessage,
  type PartLlm,
} from "./scoring";

let seq = 0;
function turn(over: Partial<TurnRecord> & { intent?: TurnIntent }): TurnRecord {
  const { intent = "answer", ...rest } = over;
  seq++;
  return {
    takeId: `t${seq}`,
    seq,
    part: 1,
    questionId: "q1",
    question: "Do you like walking?",
    kind: "main",
    attempt: 0,
    outcome: "end_of_turn",
    speechMs: 10_000,
    durationMs: 12_000,
    firstSpeechLatencyMs: 800,
    scored: true,
    transcript: "Yes I walk every day to my office",
    features: null,
    analysis: { intent, polarity: "positive", quality: "short", probe: null, source: "llm" },
    sttModel: "whisper",
    analysisModel: "qwen",
    createdAt: "",
    ...rest,
  };
}

const crit = (band: number) => ({ band, summary: "s", evidence: ["e"], improvements: ["i"] });
const llm = (b: [number, number, number, number]): PartLlm => ({
  criteria: { fluency: crit(b[0]), lexical: crit(b[1]), grammar: crit(b[2]), pronunciation: crit(b[3]) },
  feedback: "f",
  improvedAnswers: [],
  priorities: ["p"],
  vocabularyUpgrades: [],
});

describe("answersForPart", () => {
  it("merges continuation takes and excludes repeat requests from the answer text", () => {
    const turns = [
      turn({ intent: "repeat_request", transcript: "Sorry, can you repeat?", speechMs: 1_500 }),
      turn({ intent: "incomplete", transcript: "Well, I usually walk", attempt: 1, speechMs: 3_000 }),
      turn({ intent: "answer", transcript: "to work because it is close", attempt: 2, speechMs: 4_000 }),
    ];
    const [a] = answersForPart(turns, 1);
    expect(a.transcript).toBe("Well, I usually walk … to work because it is close");
    expect(a.speechMs).toBe(7_000);
    expect(a.notes).toContain("asked for a repeat ×1");
    expect(a.noResponse).toBe(false);
  });

  it("marks questions without any answer content as no response", () => {
    const [a] = answersForPart([turn({ intent: "no_answer", transcript: "", outcome: "no_response" })], 1);
    expect(a.noResponse).toBe(true);
  });

  it("ignores unscored takes (the name question)", () => {
    expect(answersForPart([turn({ part: 0, scored: false, questionId: "name" })], 1)).toEqual([]);
  });
});

describe("conduct rules", () => {
  it("no deduction within the allowances", () => {
    const turns = [turn({ intent: "repeat_request" }), turn({ intent: "repeat_request", questionId: "q2" })];
    expect(conductAdjustments(conductForPart(turns, 1))).toEqual([]);
  });

  it("deducts one Fluency band for excessive repeat requests", () => {
    const turns = [1, 2, 3].flatMap((i) => [
      turn({ intent: "repeat_request", questionId: `q${i}` }),
      turn({ intent: "answer", questionId: `q${i}`, attempt: 1 }),
    ]);
    const adj = conductAdjustments(conductForPart(turns, 1));
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ criterion: "fluency", delta: -1 });
    expect(adj[0].reason).toContain("3 repeat requests");
  });

  it("caps the Fluency deduction at one band even with several issues", () => {
    const turns = [
      ...[1, 2, 3].map((i) => turn({ intent: "repeat_request", questionId: `r${i}` })),
      ...[1, 2].map((i) => turn({ intent: "question_to_examiner", questionId: `x${i}` })),
    ];
    const adj = conductAdjustments(conductForPart(turns, 1)).filter((a) => a.criterion === "fluency");
    expect(adj).toHaveLength(1);
  });

  it("deducts Lexical Resource when many questions are not answered", () => {
    const turns = [1, 2, 3].map((i) => turn({ intent: "dont_know", questionId: `q${i}`, transcript: "I don't know" }));
    const adj = conductAdjustments(conductForPart(turns, 1));
    expect(adj.some((a) => a.criterion === "lexical" && a.delta === -1)).toBe(true);
  });
});

describe("buildPartReport", () => {
  it("applies adjustments, caps pronunciation and computes the part band", () => {
    const turns = [1, 2, 3].map((i) => turn({ intent: "repeat_request", questionId: `r${i}` }));
    const answers = answersForPart([...turns, turn({ questionId: "a1", speechMs: 70_000 })], 1);
    const r = buildPartReport({
      part: 1,
      answers,
      conduct: conductForPart(turns, 1),
      llm: llm([7, 6, 6, 9]),
      model: "m",
    });
    expect(r.criteria!.fluency).toMatchObject({ assessedBand: 7, band: 6 });
    expect(r.criteria!.pronunciation.band).toBe(8); // capped at fluency(7) + 1
    expect(r.band).toBe(6.5); // (6+6+6+8)/4 = 6.5
  });

  it("returns an unscored report when there was no speech", () => {
    const r = buildPartReport({ part: 2, answers: [], conduct: conductForPart([], 2), llm: null, model: null });
    expect(r.band).toBeNull();
    expect(r.sampleNote).toMatch(/No speech/);
  });
});

describe("combineParts", () => {
  const part = (p: 1 | 2 | 3, b: [number, number, number, number]): PartReport =>
    buildPartReport({ part: p, answers: [], conduct: conductForPart([], p), llm: llm(b), model: "m" });

  it("weights parts (P3 heaviest) and rounds to whole criterion bands", () => {
    const { criteria, overall } = combineParts([part(1, [7, 7, 7, 7]), part(2, [6, 6, 6, 6]), part(3, [6, 6, 6, 6])]);
    expect(criteria).toEqual({ fluency: 6, lexical: 6, grammar: 6, pronunciation: 6 }); // 6.3 → 6
    expect(overall).toBe(6);
  });

  it("a single part gives that part's criteria", () => {
    const { criteria, overall } = combineParts([part(2, [6, 7, 6, 6])]);
    expect(criteria).toEqual({ fluency: 6, lexical: 7, grammar: 6, pronunciation: 6 });
    expect(overall).toBe(6.5);
  });
});

describe("prompt and parsing", () => {
  it("labels no-response answers and interaction notes", () => {
    const answers = answersForPart(
      [
        turn({ intent: "repeat_request" }),
        turn({ attempt: 1 }),
        turn({ questionId: "q2", intent: "no_answer", transcript: "" }),
      ],
      1,
    );
    const msg = partUserMessage(1, "part1", answers);
    expect(msg).toContain("A: (no response)");
    expect(msg).toContain("notes: asked for a repeat ×1");
    expect(msg).toContain("Part 1 only");
  });

  it("parses JSON wrapped in text, coerces numeric strings and rejects out-of-range bands", () => {
    const ok = `Sure:\n${JSON.stringify({ ...llm([6, 6, 6, 6]), criteria: { ...llm([6, 6, 6, 6]).criteria, fluency: { ...crit(6), band: "6" } } })}`;
    expect(parseJson(partLlmSchema, ok).criteria.fluency.band).toBe(6);
    expect(() => parseJson(partLlmSchema, JSON.stringify(llm([11, 6, 6, 6])))).toThrow();
  });
});
