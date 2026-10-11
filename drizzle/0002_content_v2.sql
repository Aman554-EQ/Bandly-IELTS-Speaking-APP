-- Content v2 (step3-redesign-plan.md §3, §6.1). Additive only: new tables, new nullable
-- columns, NOT NULL relaxed on attempt/result targets, check constraints.
-- Rollback: DROP the three new tables and the new columns/constraints/indexes; SET NOT NULL
-- again on exams.collection_id, exam_attempts.exam_id/section_id, results.exam_id/module_id
-- (only after confirming no cue-card attempts or book-less tests exist). Take pnpm db:backup first.
CREATE TYPE "public"."category_kind" AS ENUM('cambridge', 'practice_test', 'recent_real', 'cue_cards');--> statement-breakpoint
CREATE TYPE "public"."group_kind" AS ENUM('part1_topic', 'part3_topic');--> statement-breakpoint
CREATE TABLE "cue_card_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cue_card_topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cue_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"prompt" text NOT NULL,
	"bullets" text[] NOT NULL,
	"explain" text NOT NULL,
	"spoken_prompt" text NOT NULL,
	"round_off" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"engine_key" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cue_cards_topic_slug_uq" UNIQUE("topic_id","slug")
);
--> statement-breakpoint
CREATE TABLE "question_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"kind" "group_kind" NOT NULL,
	"title" text NOT NULL,
	"intro" text NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"engine_key" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exam_attempts" ALTER COLUMN "exam_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_attempts" ALTER COLUMN "section_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ALTER COLUMN "collection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ALTER COLUMN "exam_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ALTER COLUMN "module_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD COLUMN "cue_card_id" uuid;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "kind" "category_kind";--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "cue_card_id" uuid;--> statement-breakpoint
ALTER TABLE "cue_cards" ADD CONSTRAINT "cue_cards_topic_id_cue_card_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."cue_card_topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cue_cards" ADD CONSTRAINT "cue_cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_groups" ADD CONSTRAINT "question_groups_section_id_exam_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."exam_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cue_card_topics_position_idx" ON "cue_card_topics" USING btree ("position");--> statement-breakpoint
CREATE INDEX "cue_cards_topic_idx" ON "cue_cards" USING btree ("topic_id","position");--> statement-breakpoint
CREATE INDEX "cue_cards_status_idx" ON "cue_cards" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cue_cards_created_by_idx" ON "cue_cards" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "question_groups_section_idx" ON "question_groups" USING btree ("section_id","position");--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_cue_card_id_cue_cards_id_fk" FOREIGN KEY ("cue_card_id") REFERENCES "public"."cue_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_group_id_question_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."question_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_cue_card_id_cue_cards_id_fk" FOREIGN KEY ("cue_card_id") REFERENCES "public"."cue_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_attempts_one_in_progress_card_uq" ON "exam_attempts" USING btree ("user_id","cue_card_id") WHERE "exam_attempts"."status" = 'in_progress' AND "exam_attempts"."cue_card_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "exam_attempts_cue_card_idx" ON "exam_attempts" USING btree ("cue_card_id");--> statement-breakpoint
CREATE INDEX "exam_questions_group_idx" ON "exam_questions" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exams_test_number_uq" ON "exams" USING btree ("module_id",coalesce("collection_id", '00000000-0000-0000-0000-000000000000'::uuid),"exam_number") WHERE "exams"."exam_number" IS NOT NULL AND "exams"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "results_cue_card_idx" ON "results" USING btree ("cue_card_id");--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_kind_unique" UNIQUE("kind");--> statement-breakpoint
ALTER TABLE "exam_attempts" ADD CONSTRAINT "exam_attempts_target_ck" CHECK (("exam_attempts"."exam_id" IS NOT NULL AND "exam_attempts"."section_id" IS NOT NULL AND "exam_attempts"."cue_card_id" IS NULL) OR ("exam_attempts"."exam_id" IS NULL AND "exam_attempts"."section_id" IS NULL AND "exam_attempts"."cue_card_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_target_ck" CHECK (("results"."exam_id" IS NULL) <> ("results"."cue_card_id" IS NULL));