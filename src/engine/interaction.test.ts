import { describe, expect, it } from "vitest";
import {
  applyAction,
  classifyByRules,
  decideInteraction,
  FALLBACK_ANALYSIS,
  newQuestionState,
  type InteractionContext,
  type TurnAnalysis,
  type TurnIntent,
} from "./interaction";

const intentOf = (t: string, speechMs = 3_000) => classifyByRules(t, speechMs).analysis.intent;

describe("classifyByRules", () => {
  it.each<[string, TurnIntent]>([
    ["Sorry, could you repeat the question please?", "repeat_request"],
    ["Pardon?", "repeat_request"],
    ["I didn't catch that.", "repeat_request"],
    ["What was the question again?", "repeat_request"],
    ["Can you say that again?", "repeat_request"],
    ["What does walking holiday mean?", "clarification_request"],
    ["I don't know.", "dont_know"],
    ["Um, I have no idea.", "dont_know"],
    ["Can we skip this one?", "dont_know"],
    ["How much time do I have?", "meta"],
    ["Is that enough?", "meta"],
    ["I want to stop the test.", "stop_request"],
    ["What about you?", "question_to_examiner"],
    ["Well, I think that, um, let me think", "incomplete"],
    ["I usually walk to work because", "incomplete"],
    ["", "no_answer"],
    ["I walk about five kilometres every day because my office is close to my flat.", "answer"],
  ])("%s → %s", (text, intent) => {
    expect(intentOf(text)).toBe(intent);
  });

  it("does not mistake a long answer that mentions 'again' for a repeat request", () => {
    expect(
      intentOf(
        "I would love to go on a walking holiday again because last year I went to Scotland and it was amazing",
        9_000,
      ),
    ).toBe("answer");
  });

  it("detects polarity for Why / Why not", () => {
    expect(classifyByRules("No, not really.", 900).analysis.polarity).toBe("negative");
    expect(classifyByRules("Yes, I would.", 900).analysis.polarity).toBe("positive");
  });

  it("is confident about short, explicit requests (LLM can be skipped)", () => {
    expect(classifyByRules("Could you repeat that please?", 1_500).confident).toBe(true);
    expect(classifyByRules("I think walking is good", 2_000).confident).toBe(false);
  });
});

const a = (intent: TurnIntent): TurnAnalysis => ({ ...FALLBACK_ANALYSIS, intent, source: "rules" });
const ctx = (over: Partial<InteractionContext> = {}): InteractionContext => ({
  part: 1,
  kind: "main",
  fidelity: "exam",
  hasRephrase: false,
  state: newQuestionState(),
  ...over,
});

describe("decideInteraction (examiner policy)", () => {
  it("accepts answers", () => {
    expect(decideInteraction(a("answer"), ctx())).toEqual({ type: "accept" });
  });

  it("repeats on request up to the limit, then refuses once, then moves on", () => {
    let state = newQuestionState();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const act = decideInteraction(a("repeat_request"), ctx({ state }));
      seen.push(act.type);
      state = applyAction(state, act);
    }
    expect(seen).toEqual(["repeat", "repeat", "refuse_repeat", "move_on"]);
  });

  it("guided style allows more repeats", () => {
    let state = newQuestionState();
    for (let i = 0; i < 4; i++)
      state = applyAction(state, decideInteraction(a("repeat_request"), ctx({ state, fidelity: "guided" })));
    expect(state.repeats).toBe(4);
  });

  it("Part 3 rephrases instead of repeating verbatim (once)", () => {
    const first = decideInteraction(a("repeat_request"), ctx({ part: 3, hasRephrase: true }));
    expect(first).toEqual({ type: "repeat", rephrase: true });
    const second = decideInteraction(
      a("repeat_request"),
      ctx({ part: 3, hasRephrase: true, state: applyAction(newQuestionState(), first) }),
    );
    expect(second).toEqual({ type: "repeat", rephrase: false });
  });

  it("Part 1 cannot explain words; Part 3 rephrases", () => {
    expect(decideInteraction(a("clarification_request"), ctx())).toEqual({ type: "clarify", rephrase: false });
    expect(decideInteraction(a("clarification_request"), ctx({ part: 3, hasRephrase: true }))).toEqual({
      type: "clarify",
      rephrase: true,
    });
  });

  it("keeps listening when the candidate stops mid-thought (limited)", () => {
    let state = newQuestionState();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const act = decideInteraction(a("incomplete"), ctx({ state }));
      seen.push(act.type);
      state = applyAction(state, act);
    }
    expect(seen).toEqual(["continue", "continue", "accept"]);
  });

  it("'I don't know': Part 1 moves on; Part 3 tries a simpler wording first", () => {
    expect(decideInteraction(a("dont_know"), ctx())).toEqual({ type: "move_on", line: "skip.ok" });
    expect(decideInteraction(a("dont_know"), ctx({ part: 3, hasRephrase: true }))).toEqual({
      type: "repeat",
      rephrase: true,
    });
  });

  it("deflects questions to the examiner and stop requests", () => {
    expect(decideInteraction(a("question_to_examiner"), ctx())).toEqual({
      type: "say_and_relisten",
      line: "deflect.opinion",
    });
    expect(decideInteraction(a("stop_request"), ctx())).toEqual({ type: "say_and_relisten", line: "stop.info" });
  });

  it("re-asks once after an off-topic answer, then accepts", () => {
    const first = decideInteraction(a("off_topic"), ctx());
    expect(first).toEqual({ type: "reask" });
    expect(decideInteraction(a("off_topic"), ctx({ state: applyAction(newQuestionState(), first) }))).toEqual({
      type: "accept",
    });
  });

  it("the name question only reacts to a repeat request", () => {
    expect(decideInteraction(a("repeat_request"), ctx({ part: 0, kind: "name" }))).toEqual({
      type: "repeat",
      rephrase: false,
    });
    expect(decideInteraction(a("question_to_examiner"), ctx({ part: 0, kind: "name" }))).toEqual({ type: "accept" });
  });
});
