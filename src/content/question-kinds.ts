/**
 * What a Part 3 discussion question asks the candidate to do. Admin metadata
 * for organising and searching the question bank; the examiner engine ignores it.
 */
export const P3_KINDS = ["opinion", "ideas", "experience", "reasons", "compare", "future", "evaluate"] as const;
export type P3Kind = (typeof P3_KINDS)[number];

export const P3_KIND_LABEL: Record<P3Kind, string> = {
  opinion: "Opinion",
  ideas: "Ideas and solutions",
  experience: "Experience",
  reasons: "Reasons and causes",
  compare: "Compare (past, present, places)",
  future: "Future and predictions",
  evaluate: "Advantages and disadvantages",
};
