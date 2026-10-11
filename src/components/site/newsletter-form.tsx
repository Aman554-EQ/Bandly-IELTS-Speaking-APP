"use client";

import { type FormEvent, useState } from "react";

/** Footer "Stay updated" form: email only, stored by POST /api/newsletter. */
export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ status: "idle" | "busy" | "ok" | "error"; message?: string }>({
    status: "idle",
  });

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const company = (new FormData(e.currentTarget).get("company") as string) ?? "";
    setState({ status: "busy" });
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "footer", ...(company ? { company } : {}) }),
      });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? "Something went wrong. Please try again.");
      setState({ status: "ok", message: j.message ?? "Thanks! You're on the list." });
      setEmail("");
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  return (
    <form onSubmit={submit} aria-label="Subscribe to updates" className="w-full">
      <div className="flex gap-2">
        <label htmlFor="newsletter-email" className="sr-only">
          Email address
        </label>
        <input
          id="newsletter-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        {/* Honeypot for bots; hidden from people and screen readers. */}
        <input type="text" name="company" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
        <button
          type="submit"
          disabled={state.status === "busy"}
          className="h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-ink transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {state.status === "busy" ? "Subscribing…" : "Subscribe"}
        </button>
      </div>
      <p
        role="status"
        className={`mt-1.5 min-h-4 text-xs ${state.status === "error" ? "text-danger" : state.status === "ok" ? "font-medium text-success" : "text-muted"}`}
      >
        {state.message ?? "No spam. Unsubscribe any time."}
      </p>
    </form>
  );
}
