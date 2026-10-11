/**
 * Examiner personas. Each one has its own pre-rendered voice folder
 * (`public/voice/<id>/`) and a matching browser-voice fallback.
 */
export type ExaminerId = "emma" | "james";

export interface ExaminerProfile {
  id: ExaminerId;
  name: string;
  initials: string;
  gender: "female" | "male";
  /** Kokoro-82M voice used to pre-render the clips. */
  kokoroVoice: string;
  /** Browser SpeechSynthesis voices to prefer if a clip is missing (en-GB first). */
  browserVoiceHints: string[];
}

export const EXAMINERS: Record<ExaminerId, ExaminerProfile> = {
  emma: {
    id: "emma",
    name: "Emma Hayes",
    initials: "EH",
    gender: "female",
    kokoroVoice: "bf_emma",
    browserVoiceHints: ["sonia", "libby", "hazel", "google uk english female", "serena", "kate", "\\bfemale\\b"],
  },
  james: {
    id: "james",
    name: "James Carter",
    initials: "JC",
    gender: "male",
    kokoroVoice: "bm_george",
    browserVoiceHints: ["ryan", "george", "thomas", "google uk english male", "daniel", "oliver", "\\bmale\\b"],
  },
};

export const DEFAULT_EXAMINER: ExaminerId = "emma";

export function examinerById(id: string | null | undefined): ExaminerProfile {
  return EXAMINERS[(id as ExaminerId) ?? DEFAULT_EXAMINER] ?? EXAMINERS[DEFAULT_EXAMINER];
}
