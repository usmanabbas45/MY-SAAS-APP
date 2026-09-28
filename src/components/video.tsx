"use client";

import { useState } from "react";

/**
 * Lightweight YouTube embed: shows the thumbnail and only loads the player (from youtube-nocookie.com)
 * when the visitor clicks play, so pages stay fast and no YouTube cookies are set before that.
 */
export function YouTube({ id, title, start }: { id: string; title: string; start?: number }) {
  const [playing, setPlaying] = useState(false);
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1${start ? `&start=${start}` : ""}`;
  return (
    <div className="video">
      {playing ? (
        <iframe src={src} title={title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
      ) : (
        <button type="button" className="video-poster" onClick={() => setPlaying(true)} aria-label={`Play video: ${title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" />
          <span className="video-play" aria-hidden>▶</span>
        </button>
      )}
    </div>
  );
}
