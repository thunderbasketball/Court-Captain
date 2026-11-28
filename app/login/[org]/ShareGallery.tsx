"use client";

import { useState } from "react";
import SharePanel from "../../SharePanel";

export type GalleryItem = { key: string; label: string; text: string; v: string };

// Share the news: the organization's pictures in a row to swipe; tap one to share it, right below.
export default function ShareGallery({ org, items }: { org: string; items: GalleryItem[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!items.length) return null;
  const it = items.find((i) => i.key === picked);
  return (
    <section id="share" className="scroll-mt-4 space-y-2">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Share the news</h2>
      <div className="rounded-xl bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
        <ul className="-mx-3 flex snap-x scroll-px-3 gap-3 overflow-x-auto px-3 pb-2">
          {items.map((i) => (
            <li key={i.key} className="w-36 shrink-0 snap-start sm:w-44">
              <button
                type="button"
                aria-expanded={picked === i.key}
                aria-label={`Share: ${i.label}`}
                onClick={() => setPicked((p) => (p === i.key ? null : i.key))}
                className="block w-full text-left"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a picture made on the fly */}
                <img
                  src={`/share/${org}/${i.key}/image?v=${i.v}`}
                  alt=""
                  loading="lazy"
                  width={1080}
                  height={1080}
                  className={`aspect-square w-full rounded-lg bg-zinc-200 object-cover object-top dark:bg-zinc-800 ${picked === i.key ? "ring-4 ring-thunder-blue" : "ring-1 ring-zinc-950/10"}`}
                />
                <span className="mt-1 block text-sm font-medium">{i.label}</span>
              </button>
            </li>
          ))}
        </ul>
        {it && <SharePanel key={it.key} at={`/share/${org}/${it.key}`} v={it.v} text={it.text} file={`${org}-${it.key}`} />}
        {!it && <p className="text-xs text-zinc-500">Tap a picture to share it on Instagram, Facebook, X or by text.</p>}
      </div>
    </section>
  );
}
