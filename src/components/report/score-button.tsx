"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Scores (or re-scores) a saved session, then refreshes the page. */
export function ScoreButton({
  sessionId,
  force = false,
  label,
}: {
  sessionId: string;
  force?: boolean;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Scoring failed.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scoring failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-2">
      <Button variant={force ? "secondary" : "primary"} size={force ? "md" : "lg"} onClick={run} disabled={busy}>
        {busy ? "Scoring… (10–30 s)" : label}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
