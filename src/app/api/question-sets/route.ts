import { connection } from "next/server";
import { listPracticeExams } from "@/server/db/repo";
import { errorResponse } from "@/server/http";

/** GET /api/question-sets: live exams and the parts each offers (public, titles only). */
export async function GET() {
  await connection();
  try {
    return Response.json({ sets: await listPracticeExams() });
  } catch (e) {
    return errorResponse(e, "question-sets");
  }
}
