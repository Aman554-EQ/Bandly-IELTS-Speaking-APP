"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/server/auth/users";

const field = "mt-1 w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-base";

/** Edits the allowed profile fields. Email and password are managed in the Clerk account menu. */
export function ProfileForm({ profile }: { profile: Profile }) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [examinerId, setExaminerId] = useState(profile.preferences.examinerId ?? "emma");
  const [fidelity, setFidelity] = useState(profile.preferences.fidelity ?? "exam");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          bio: bio.trim() || null,
          preferences: { examinerId, fidelity },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Your changes were not saved.");
      setMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Your changes were not saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card mt-8 space-y-5 p-6">
      <div>
        <label htmlFor="displayName" className="font-semibold">
          Display name
        </label>
        <input
          id="displayName"
          className={field}
          value={displayName}
          maxLength={80}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor="bio" className="font-semibold">
          About you <span className="font-normal text-muted">(optional, up to 500 characters)</span>
        </label>
        <textarea
          id="bio"
          className={field}
          rows={3}
          value={bio}
          maxLength={500}
          onChange={(e) => setBio(e.target.value)}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="examiner" className="font-semibold">
            Default examiner
          </label>
          <select
            id="examiner"
            className={field}
            value={examinerId}
            onChange={(e) => setExaminerId(e.target.value as "emma" | "james")}
          >
            <option value="emma">Emma Hayes</option>
            <option value="james">James Carter</option>
          </select>
        </div>
        <div>
          <label htmlFor="fidelity" className="font-semibold">
            Default style
          </label>
          <select
            id="fidelity"
            className={field}
            value={fidelity}
            onChange={(e) => setFidelity(e.target.value as "exam" | "guided")}
          >
            <option value="exam">Exam style</option>
            <option value="guided">Guided style</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        {message && (
          <p
            role={message.ok ? "status" : "alert"}
            className={`font-medium ${message.ok ? "text-success" : "text-danger"}`}
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
