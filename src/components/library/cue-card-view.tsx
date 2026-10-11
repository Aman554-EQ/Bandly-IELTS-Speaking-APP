/** A cue card exactly as students see it (library, practice overview, admin preview). */
export function CueCardView({
  prompt,
  bullets,
  explain,
  label = "Cue card",
}: {
  prompt: string;
  bullets: string[];
  explain: string;
  label?: string;
}) {
  return (
    <figure className="card max-w-xl border-2 p-6" aria-label={label}>
      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold">{prompt || "Card heading"}</p>
      <p className="mt-4 font-medium">You should say:</p>
      <ul className="mt-1 list-disc space-y-1 pl-6">
        {(bullets.length ? bullets : ["…"]).map((b, i) => (
          <li key={`${b}-${i}`}>{b}</li>
        ))}
      </ul>
      <p className="mt-3">{explain || "and explain …"}</p>
    </figure>
  );
}
