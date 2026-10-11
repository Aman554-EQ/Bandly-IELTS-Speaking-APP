/**
 * PostgreSQL schema (Drizzle ORM). Source of truth for `pnpm db:generate`.
 * Design: database-integration.md §5, adapted for speaking exams in
 * documentation/adr/0007-postgres-drizzle-local-first.md.
 *
 * Conventions
 * - Primary keys: UUID v7 (time-ordered), except audit_logs (bigint identity,
 *   append-only cursor) and webhook_events (the provider's message id).
 * - All timestamps are timestamptz. Mutable rows have updated_at.
 * - Content that history refers to is soft-deleted (deleted_at) and has a status.
 * - FKs: RESTRICT for anything attempts/results refer to, CASCADE only for pure
 *   children, SET NULL for optional audit references. Every FK is indexed.
 * - The deferrable UNIQUE (section_id, position) on exam_questions lives in a
 *   hand-written migration (drizzle/0001_*), because Drizzle cannot express DEFERRABLE.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "./uuid";

// ----------------------------------------------------------------- helpers

const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .$defaultFn(() => uuidv7());
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tstz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const deletedAt = () => tstz("deleted_at");

// ------------------------------------------------------------------- enums

export const contentStatus = pgEnum("content_status", ["draft", "published", "archived"]);
export const sectionKind = pgEnum("section_kind", ["part_1", "part_2", "part_3", "full_test"]);
export const questionType = pgEnum("question_type", [
  "speaking_prompt",
  "cue_card",
  "multiple_choice",
  "short_answer",
  "true_false_not_given",
  "matching",
  "fill_blank",
]);
/**
 * Attempt lifecycle. `scoring` and `score_failed` are Bandly additions: speaking
 * is scored by an AI assessor after submission, which can take time or fail.
 */
export const attemptStatus = pgEnum("attempt_status", [
  "in_progress",
  "submitted",
  "scoring",
  "scored",
  "score_failed",
  "expired",
  "abandoned",
]);
export const endReason = pgEnum("end_reason", ["completed", "ended_early"]);
export const userStatus = pgEnum("user_status", ["active", "suspended", "deleted"]);
export const roleKey = pgEnum("role_key", ["superadmin", "admin", "student"]);
export const feedbackSource = pgEnum("feedback_source", ["auto", "admin", "ai"]);
export const navigationMode = pgEnum("navigation_mode", ["collection_list", "direct_exam_list"]);
/** The four fixed library categories (step3.md §2). Code finds categories by kind, never by slug. */
export const categoryKind = pgEnum("category_kind", ["cambridge", "practice_test", "recent_real", "cue_cards"]);
export const groupKind = pgEnum("group_kind", ["part1_topic", "part3_topic"]);

// --------------------------------------------- authentication and roles

export const users = pgTable(
  "users",
  {
    id: id(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
    status: userStatus("status").notNull().default("active"),
    lastSeenAt: tstz("last_seen_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // Case-insensitive unique email (instead of the citext extension).
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    index("users_status_idx").on(t.status),
    index("users_created_idx").on(t.createdAt.desc(), t.id),
  ],
);

export const roles = pgTable("roles", {
  id: id(),
  key: roleKey("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** Higher means more privilege (used by "can manage" checks). */
  rank: smallint("rank").notNull(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: tstz("granted_at").notNull().defaultNow(),
    /** Null means the role is active. */
    revokedAt: tstz("revoked_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index("user_roles_role_idx").on(t.roleId),
    index("user_roles_granted_by_idx").on(t.grantedBy),
  ],
);

/** Processed webhook deliveries (Svix message id), so duplicates are ignored. */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  eventType: text("event_type").notNull(),
  processedAt: tstz("processed_at").notNull().defaultNow(),
  payloadHash: text("payload_hash"),
});

// ----------------------------------------------------------- exam content

export const modules = pgTable(
  "modules",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    /** Which of the four fixed categories this row is (UI name: "category"). */
    kind: categoryKind("kind").unique(),
    /** Superseded by `kind` (content v2); kept until the clean-up migration. */
    navigationMode: navigationMode("navigation_mode").notNull().default("collection_list"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    displayOrder: integer("display_order").notNull().default(0),
    status: contentStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("modules_status_order_idx").on(t.status, t.displayOrder),
    index("modules_created_by_idx").on(t.createdBy),
  ],
);

export const collections = pgTable(
  "collections",
  {
    id: id(),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** Numeric sort key (Cambridge 21 → 21). Lists sort by it, newest number first. */
    sortNumber: integer("sort_number"),
    /** Manual order for collections without a number. */
    displayOrder: integer("display_order"),
    status: contentStatus("status").notNull().default("draft"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("collections_module_slug_uq").on(t.moduleId, t.slug),
    // Target for exams' composite FK, which keeps exams.module_id consistent.
    unique("collections_id_module_uq").on(t.id, t.moduleId),
    uniqueIndex("collections_module_sort_number_uq")
      .on(t.moduleId, t.sortNumber)
      .where(sql`${t.sortNumber} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index("collections_listing_idx").on(t.moduleId, t.status, t.sortNumber.desc(), t.id),
  ],
);

export const exams = pgTable(
  "exams",
  {
    id: id(),
    /** The book (Cambridge only). Null for numbered tests without a book (content v2). */
    collectionId: uuid("collection_id"),
    /** Denormalised for fast filtering; kept equal to the collection's module by a composite FK. */
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    examNumber: integer("exam_number"),
    description: text("description"),
    timeLimitSeconds: integer("time_limit_seconds"),
    status: contentStatus("status").notNull().default("draft"),
    publishedAt: tstz("published_at"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("exams_collection_slug_uq").on(t.collectionId, t.slug),
    unique("exams_id_module_uq").on(t.id, t.moduleId),
    foreignKey({
      name: "exams_collection_module_fk",
      columns: [t.collectionId, t.moduleId],
      foreignColumns: [collections.id, collections.moduleId],
    }).onDelete("restrict"),
    index("exams_collection_listing_idx").on(t.collectionId, t.status, t.displayOrder),
    index("exams_module_status_idx").on(t.moduleId, t.status),
    // One "Test N" per category and book (no book counts as one group).
    uniqueIndex("exams_test_number_uq")
      .on(t.moduleId, sql`coalesce(${t.collectionId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.examNumber)
      .where(sql`${t.examNumber} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
);

export const examSections = pgTable(
  "exam_sections",
  {
    id: id(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "restrict" }),
    kind: sectionKind("kind").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    timeLimitSeconds: integer("time_limit_seconds"),
    displayOrder: integer("display_order").notNull().default(0),
    /** e.g. full_test: { includes: ["part_1", "part_2", "part_3"] } (no duplicated question rows). */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    status: contentStatus("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("exam_sections_exam_kind_uq").on(t.examId, t.kind),
    unique("exam_sections_id_exam_uq").on(t.id, t.examId),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: id(),
    type: questionType("type").notNull(),
    title: text("title"),
    /** Main question text (what the examiner asks, or the cue card heading). */
    prompt: text("prompt").notNull(),
    instructions: text("instructions"),
    /** Type-specific payload, validated by Zod on write (src/server/db/content.ts). */
    content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
    explanation: text("explanation"),
    difficulty: smallint("difficulty"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: integer("version").notNull().default(1),
    status: contentStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("questions_type_status_idx").on(t.type, t.status),
    index("questions_tags_gin_idx").using("gin", t.tags),
    index("questions_created_by_idx").on(t.createdBy),
  ],
);

export const questionOptions = pgTable(
  "question_options",
  {
    id: id(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    body: text("body").notNull(),
    /** Never sent to a student before submission. */
    isCorrect: boolean("is_correct").notNull().default(false),
    displayOrder: integer("display_order").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("question_options_order_uq").on(t.questionId, t.displayOrder)],
);

/**
 * A Part 1 topic or a Part 3 discussion topic of one test part (content v2).
 * `engine_key` is the id the examiner's audio clip for the intro is keyed by.
 */
export const questionGroups = pgTable(
  "question_groups",
  {
    id: id(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => examSections.id, { onDelete: "cascade" }),
    kind: groupKind("kind").notNull(),
    title: text("title").notNull(),
    /** What the examiner says first, e.g. "Now, let's talk about walking." */
    intro: text("intro").notNull(),
    /** Part 1: the topic about the candidate (work, studies, home), asked first. */
    isCore: boolean("is_core").notNull().default(false),
    engineKey: text("engine_key").notNull(),
    position: integer("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("question_groups_section_idx").on(t.sectionId, t.position)],
);

export const examQuestions = pgTable(
  "exam_questions",
  {
    id: id(),
    examId: uuid("exam_id")
      .notNull()
      .references(() => exams.id, { onDelete: "restrict" }),
    sectionId: uuid("section_id").notNull(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    /** Topic (Part 1 and 3); null for the Part 2 cue card. */
    groupId: uuid("group_id").references(() => questionGroups.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    points: numeric("points", { precision: 6, scale: 2, mode: "number" }).notNull().default(1),
    scoringRules: jsonb("scoring_rules").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "exam_questions_section_exam_fk",
      columns: [t.sectionId, t.examId],
      foreignColumns: [examSections.id, examSections.examId],
    }).onDelete("restrict"),
    unique("exam_questions_section_question_uq").on(t.sectionId, t.questionId),
    index("exam_questions_exam_idx").on(t.examId),
    index("exam_questions_question_idx").on(t.questionId),
    index("exam_questions_group_idx").on(t.groupId),
  ],
);

// ---------------------------------------------------- Makkar cue cards

/** Cue card topics (People, Places, …): a library separate from tests (step3.md §3). */
export const cueCardTopics = pgTable(
  "cue_card_topics",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("cue_card_topics_position_idx").on(t.position)],
);

export const cueCards = pgTable(
  "cue_cards",
  {
    id: id(),
    topicId: uuid("topic_id")
      .notNull()
      .references(() => cueCardTopics.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    /** Card heading, e.g. "Describe a person who helped you." */
    prompt: text("prompt").notNull(),
    bullets: text("bullets").array().notNull(),
    /** Last line of the card: "and explain why …" */
    explain: text("explain").notNull(),
    /** What the examiner says when handing over the card. */
    spokenPrompt: text("spoken_prompt").notNull(),
    roundOff: jsonb("round_off").$type<{ id: string; text: string }[]>().notNull().default([]),
    /** Audio clip key; changes when the spoken wording changes. */
    engineKey: text("engine_key").notNull(),
    status: contentStatus("status").notNull().default("draft"),
    position: integer("position").notNull(),
    version: integer("version").notNull().default(1),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("cue_cards_topic_slug_uq").on(t.topicId, t.slug),
    index("cue_cards_topic_idx").on(t.topicId, t.position),
    index("cue_cards_status_idx").on(t.status),
    index("cue_cards_created_by_idx").on(t.createdBy),
  ],
);

// ------------------------------------------------ attempts and results

/** Settings the candidate chose for an attempt. */
export interface AttemptSettings {
  fidelity: "exam" | "guided";
  examinerId: "emma" | "james";
}

export const examAttempts = pgTable(
  "exam_attempts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** A test attempt has exam + section; a cue card attempt has cue_card_id (exactly one, CHECK). */
    examId: uuid("exam_id").references(() => exams.id, { onDelete: "restrict" }),
    sectionId: uuid("section_id"),
    cueCardId: uuid("cue_card_id").references(() => cueCards.id, { onDelete: "restrict" }),
    status: attemptStatus("status").notNull().default("in_progress"),
    endReason: endReason("end_reason"),
    startedAt: tstz("started_at").notNull().defaultNow(),
    deadlineAt: tstz("deadline_at"),
    submittedAt: tstz("submitted_at"),
    lastActivityAt: tstz("last_activity_at").notNull().defaultNow(),
    durationMs: integer("duration_ms"),
    settings: jsonb("settings").$type<AttemptSettings>().notNull(),
    /** The exact content the examiner used, so later edits never rewrite history (ADR-0007). */
    contentSnapshot: jsonb("content_snapshot").$type<Record<string, unknown>>(),
    /** Engine event log (timings, repeats, pauses) for replay and analysis. */
    events: jsonb("events").$type<unknown[]>().notNull().default([]),
    error: text("error"),
    clientMeta: jsonb("client_meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "exam_attempts_section_exam_fk",
      columns: [t.sectionId, t.examId],
      foreignColumns: [examSections.id, examSections.examId],
    }).onDelete("restrict"),
    index("exam_attempts_user_started_idx").on(t.userId, t.startedAt.desc(), t.id),
    index("exam_attempts_exam_status_idx").on(t.examId, t.status),
    index("exam_attempts_status_activity_idx").on(t.status, t.lastActivityAt),
    index("exam_attempts_section_idx").on(t.sectionId),
    uniqueIndex("exam_attempts_one_in_progress_uq")
      .on(t.userId, t.examId, t.sectionId)
      .where(sql`${t.status} = 'in_progress'`),
    uniqueIndex("exam_attempts_one_in_progress_card_uq")
      .on(t.userId, t.cueCardId)
      .where(sql`${t.status} = 'in_progress' AND ${t.cueCardId} IS NOT NULL`),
    index("exam_attempts_cue_card_idx").on(t.cueCardId),
    check(
      "exam_attempts_target_ck",
      sql`(${t.examId} IS NOT NULL AND ${t.sectionId} IS NOT NULL AND ${t.cueCardId} IS NULL) OR (${t.examId} IS NULL AND ${t.sectionId} IS NULL AND ${t.cueCardId} IS NOT NULL)`,
    ),
  ],
);

/**
 * One row per recorded take (one mic opening). A question can have several
 * takes (repeat requests, "can I start again?"), so the idempotency key is
 * (attempt_id, take_id) instead of (attempt_id, question_id). ADR-0007.
 */
export const attemptAnswers = pgTable(
  "attempt_answers",
  {
    id: id(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => examAttempts.id, { onDelete: "cascade" }),
    takeId: text("take_id").notNull(),
    part: smallint("part").notNull(),
    /** The engine's question id (also covers probes and the name question). */
    questionKey: text("question_key").notNull(),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "restrict" }),
    examQuestionId: uuid("exam_question_id").references(() => examQuestions.id, { onDelete: "restrict" }),
    /** Transcript, speech features and what the examiner understood. */
    answer: jsonb("answer").$type<Record<string, unknown>>().notNull(),
    isCorrect: boolean("is_correct"),
    pointsAwarded: numeric("points_awarded", { precision: 6, scale: 2, mode: "number" }),
    answeredAt: tstz("answered_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("attempt_answers_take_uq").on(t.attemptId, t.takeId),
    index("attempt_answers_order_idx").on(t.attemptId, t.answeredAt, t.id),
    index("attempt_answers_question_idx").on(t.questionId),
    index("attempt_answers_exam_question_idx").on(t.examQuestionId),
  ],
);

export const results = pgTable(
  "results",
  {
    id: id(),
    /** One result per attempt: the database-level guard against double scoring. */
    attemptId: uuid("attempt_id")
      .notNull()
      .unique("results_attempt_uq")
      .references(() => examAttempts.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    examId: uuid("exam_id").references(() => exams.id, { onDelete: "restrict" }),
    moduleId: uuid("module_id").references(() => modules.id, { onDelete: "restrict" }),
    cueCardId: uuid("cue_card_id").references(() => cueCards.id, { onDelete: "restrict" }),
    rawScore: numeric("raw_score", { precision: 7, scale: 2, mode: "number" }),
    maxScore: numeric("max_score", { precision: 7, scale: 2, mode: "number" }),
    percentage: numeric("percentage", { precision: 5, scale: 2, mode: "number" }),
    /** Overall IELTS band (null until the final report exists or if there was not enough speech). */
    bandScore: numeric("band_score", { precision: 3, scale: 1, mode: "number" }),
    /** { partReports: { "1": PartReport, … }, final: FinalReport | null } */
    breakdown: jsonb("breakdown").$type<Record<string, unknown>>().notNull().default({}),
    scoringVersion: text("scoring_version").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("results_user_created_idx").on(t.userId, t.createdAt.desc(), t.id),
    index("results_module_created_idx").on(t.moduleId, t.createdAt),
    index("results_exam_created_idx").on(t.examId, t.createdAt),
    index("results_cue_card_idx").on(t.cueCardId),
    check("results_target_ck", sql`(${t.examId} IS NULL) <> (${t.cueCardId} IS NULL)`),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => results.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => examAttempts.id, { onDelete: "restrict" }),
    /** Null means overall (or per-part) feedback rather than one question. */
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "restrict" }),
    source: feedbackSource("source").notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("feedback_result_idx").on(t.resultId),
    index("feedback_attempt_idx").on(t.attemptId),
    index("feedback_question_idx").on(t.questionId),
    index("feedback_created_by_idx").on(t.createdBy),
  ],
);

// ------------------------------------------------------------ auditing

/** Append-only. Application code never updates or deletes these rows. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt.desc(), t.id.desc()),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt.desc()),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

/**
 * Footer "Stay updated" sign-ups. Email is stored lower-case and trimmed; no
 * account needed. Sending happens later through an email provider (not yet).
 */
export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: id(),
    email: text("email").notNull(),
    /** Where the form was: "footer", … */
    source: text("source").notNull().default("footer"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    unsubscribedAt: tstz("unsubscribed_at"),
  },
  (t) => [uniqueIndex("newsletter_subscribers_email_uq").on(t.email)],
);
