"use client";

import { useEffect, useRef } from "react";

/**
 * Animated level bars driven by a `level()` function (0..1). Updates the DOM
 * directly in requestAnimationFrame, so audio levels never cause React
 * re-renders.
 */
export function LevelBars({
  level,
  bars = 5,
  active = true,
  className = "",
  color = "var(--primary)",
}: {
  level: () => number;
  bars?: number;
  active?: boolean;
  className?: string;
  color?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let smooth = 0;
    const weights = Array.from({ length: bars }, (_, i) => 0.55 + 0.45 * Math.sin(((i + 1) / (bars + 1)) * Math.PI));
    const tick = () => {
      smooth = smooth * 0.7 + level() * 0.3;
      const el = ref.current;
      if (el) {
        el.childNodes.forEach((node, i) => {
          const h = Math.max(0.12, Math.min(1, smooth * weights[i] * 1.6));
          (node as HTMLElement).style.transform = `scaleY(${h})`;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level, bars, active]);

  return (
    <div ref={ref} className={`flex h-8 items-center gap-1 ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="h-full w-1.5 origin-center rounded-full transition-transform duration-75"
          style={{ background: color, transform: "scaleY(0.12)" }}
        />
      ))}
    </div>
  );
}
