"use client";

import { useState } from "react";

/**
 * A YouTube video that loads only when clicked: a thumbnail and a play button
 * first (fast, no YouTube cookies), then the privacy-enhanced player, playing.
 */
export function YouTubeVideo({ id, title, caption }: { id: string; title: string; caption?: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <figure>
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-line bg-ink shadow-lg">
        {playing ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 h-full w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary"
            aria-label={`Play video: ${title}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-90 transition-[opacity,transform] duration-300 group-hover:scale-[1.02] group-hover:opacity-100 motion-reduce:transition-none"
            />
            <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
            <span className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-ink shadow-xl transition-transform group-hover:scale-110 motion-reduce:transition-none sm:h-20 sm:w-20">
              <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 sm:h-8 sm:w-8" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
              </svg>
            </span>
            <span className="absolute bottom-3 left-4 right-4 text-left text-sm font-semibold text-white">
              ▶ Play video
            </span>
          </button>
        )}
      </div>
      {caption && (
        <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>{caption}</span>
          <a
            href={`https://youtu.be/${id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block py-1 font-semibold text-primary underline"
          >
            Watch on YouTube ↗
          </a>
        </figcaption>
      )}
    </figure>
  );
}
