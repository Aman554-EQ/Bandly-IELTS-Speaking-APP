"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type CueOp, cueOp } from "@/content/cue-card-ops";
import { firstIssue } from "@/content/ops-common";
import { type TestOp, testOp } from "@/content/test-ops";

export interface OpState {
  busy: boolean;
  error: string | null;
  problems: string[];
  message: string | null;
}

export type AnyOp = TestOp | CueOp;

const isCue = (op: AnyOp): op is CueOp => op.op.startsWith("cue");

/**
 * Sends one admin change to POST /api/admin/tests or /api/admin/cue-cards
 * (chosen by the operation). Validates with the same Zod schema as the server
 * first, then refreshes the server-rendered page, so no reload is needed.
 */
export function useAdminOp() {
  const router = useRouter();
  const [state, setState] = useState<OpState>({ busy: false, error: null, problems: [], message: null });

  async function run(op: AnyOp): Promise<{ id?: string } | null> {
    const parsed = isCue(op) ? cueOp.safeParse(op) : testOp.safeParse(op);
    if (!parsed.success) {
      setState({ busy: false, error: firstIssue(parsed.error), problems: [], message: null });
      return null;
    }
    setState({ busy: true, error: null, problems: [], message: null });
    try {
      const res = await fetch(isCue(op) ? "/api/admin/cue-cards" : "/api/admin/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const j = (await res.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
        error?: string;
        problems?: string[];
      };
      if (!res.ok) {
        setState({
          busy: false,
          error: j.error ?? "That did not work. Please try again.",
          problems: j.problems ?? [],
          message: null,
        });
        return null;
      }
      setState({ busy: false, error: null, problems: [], message: j.message ?? "Saved." });
      router.refresh();
      return { id: j.id };
    } catch {
      setState({
        busy: false,
        error: "Network error. Check your connection and try again.",
        problems: [],
        message: null,
      });
      return null;
    }
  }

  return { ...state, run, clear: () => setState({ busy: false, error: null, problems: [], message: null }) };
}
