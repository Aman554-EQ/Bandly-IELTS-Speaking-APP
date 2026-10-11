-- Hand-written: Drizzle cannot declare DEFERRABLE constraints.
-- One question per position within a section, checked at COMMIT, so an admin
-- can reorder questions (swap positions) inside a single transaction.
-- Rollback: ALTER TABLE "exam_questions" DROP CONSTRAINT "exam_questions_section_position_uq";
ALTER TABLE "exam_questions"
  ADD CONSTRAINT "exam_questions_section_position_uq"
  UNIQUE ("section_id", "position") DEFERRABLE INITIALLY DEFERRED;
