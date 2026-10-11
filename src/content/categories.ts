/**
 * The four fixed library categories (step3.md §2). Shared by the seed, the
 * migration, server code and UI. Categories are found by `kind`; slugs and
 * titles are only defaults (admins may edit titles and descriptions).
 */
export const CATEGORY_KINDS = ["cambridge", "practice_test", "recent_real", "cue_cards"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const CATEGORY_DEFAULTS: Record<
  CategoryKind,
  { slug: string; title: string; description: string; legacySlugs: string[]; legacyTitles: string[] }
> = {
  cambridge: {
    slug: "cambridge",
    title: "Cambridge",
    description: "Speaking tests from the Cambridge IELTS books.",
    legacySlugs: [],
    legacyTitles: ["Cambridge Exam"],
  },
  practice_test: {
    slug: "practice-test",
    title: "Practice Test Exam",
    description: "Full practice tests written in the IELTS format.",
    legacySlugs: ["test-exam"],
    legacyTitles: ["Test Exam"],
  },
  recent_real: {
    slug: "recent-real-test",
    title: "Recent Real Test Questions",
    description: "Questions reported from recent real Speaking tests.",
    legacySlugs: [],
    legacyTitles: [],
  },
  cue_cards: {
    slug: "makkar-cue-cards",
    title: "Makkar Cue Cards",
    description: "Part 2 cue cards grouped by topic: people, places, objects and more.",
    legacySlugs: [],
    legacyTitles: [],
  },
};

/** Categories that hold tests (the fourth holds cue cards). */
export const TEST_CATEGORY_KINDS = ["cambridge", "practice_test", "recent_real"] as const;
export type TestCategoryKind = (typeof TEST_CATEGORY_KINDS)[number];

/** Only Cambridge tests belong to a book ("Cambridge 21"). */
export const usesBooks = (kind: CategoryKind) => kind === "cambridge";

export const DEFAULT_CUE_TOPICS = ["People", "Places", "Objects", "Experiences", "Events", "Activities"] as const;
