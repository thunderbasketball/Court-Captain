"use client";

import { useState, useSyncExternalStore } from "react";

const btn = "rounded-full px-3.5 py-2 text-sm font-semibold ring-1 ring-zinc-950/15 hover:bg-zinc-50 dark:ring-white/20 dark:hover:bg-white/5";
const never = () => () => {};
// Can this device's share sheet take a picture (phones, mostly)?
const sharesFiles = () => {
  try {
    return !!navigator.canShare?.({ files: [new File([""], "a.png", { type: "image/png" })] });
  } catch {
    return false;
  }
};

// A computer (a mouse): its share sheet, where there is one, doesn't offer X or Facebook.
const hasMouse = () => window.matchMedia("(pointer: fine)").matches;

// A share picture, opened right on the page: Share picture (the phone's share sheet: Instagram, Facebook, X, Messages…),
// Save picture, and, on a computer or where the sheet can't take a picture, X and Facebook with a link. `at`: its page
// ("/score/12"); its picture is there too, at /image.
export default function SharePanel({ at, v, text, file: name }: { at: string; v: string; text: string; file: string }) {
  const src = `${at}/image?v=${v}`;
  const sheet = useSyncExternalStore(never, sharesFiles, () => false);
  const links = useSyncExternalStore(never, hasMouse, () => false) || !sheet;
  const [file, setFile] = useState<File | null>(null); // fetched as soon as the picture shows, so Share opens at the tap
  const [note, setNote] = useState<string | null>(null);
  const load = async () => {
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error();
      setFile(new File([await r.blob()], `${name}.png`, { type: "image/png" }));
    } catch {
      setNote("The picture didn't load. Please try again.");
    }
  };
  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], text });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote("Sharing didn't work here. Save the picture and post it from the app.");
    }
  };
  const link = () => encodeURIComponent(`${window.location.origin}${at}`);
  const go = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
  return (
    <span className="mt-2 block max-w-xs rounded-xl bg-zinc-50 p-2 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10">
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture made on the fly */}
      <img
        src={src}
        alt={text}
        width={1080}
        height={1080}
        onLoad={load}
        onError={() => setNote("The picture didn't load. Please try again.")}
        className="aspect-square w-full rounded-lg bg-zinc-200 dark:bg-zinc-800"
      />
      <span className="mt-2 flex flex-wrap gap-2">
        {sheet && (
          <button type="button" disabled={!file} onClick={share} className="rounded-full bg-thunder-blue px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-40">
            Share picture
          </button>
        )}
        <a href={src} download={`${name}.png`} className={btn}>
          Save picture
        </a>
        {links && (
          <>
            <button type="button" className={btn} onClick={() => go(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${link()}`)}>
              X
            </button>
            <button type="button" className={btn} onClick={() => go(`https://www.facebook.com/sharer/sharer.php?u=${link()}`)}>
              Facebook
            </button>
          </>
        )}
      </span>
      <span className="mt-1.5 block text-xs text-zinc-500">
        {!links ? "Pick Instagram, Facebook, X or any app." : "Instagram: save the picture and post it from your phone."}
      </span>
      {note && (
        <span role="status" className="mt-1 block text-xs text-red-600">
          {note}
        </span>
      )}
    </span>
  );
}

// "Share" that opens the panel below it.
export function ShareToggle(p: { at: string; v: string; text: string; file: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        className="rounded-full px-2.5 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-white/5"
      >
        {open ? "Close" : "Share"}
      </button>
      {open && <SharePanel {...p} />}
    </span>
  );
}
