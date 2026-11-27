"use client";

import { withTag } from "@/lib/social";
import { useRef, useState, useSyncExternalStore } from "react";
import { ShareIcon, shareIconBtn } from "./ShareButton";

// Round icon buttons, each with its name for screen readers and as a tooltip.
const icon =
  "grid size-11 shrink-0 place-items-center rounded-full ring-1 ring-zinc-950/15 hover:bg-zinc-100 disabled:opacity-40 dark:ring-white/20 dark:hover:bg-white/10";
const Svg = ({
  children,
  fill = false,
}: {
  children: React.ReactNode;
  fill?: boolean;
}) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden
    className="size-5"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);
const SaveIcon = () => (
  <Svg>
    <path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Svg>
);
const InstagramIcon = () => (
  <Svg>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
  </Svg>
);
const FacebookIcon = () => (
  <Svg fill>
    <path d="M14 8.5V6.8c0-.8.5-1.3 1.3-1.3H17V2.2h-2.6C11.7 2.2 10.4 4 10.4 6.5v2H8v3.4h2.4V22H14V11.9h2.7l.4-3.4H14Z" />
  </Svg>
);
const XIcon = () => (
  <Svg fill>
    <path d="M17.8 2.5h3.1l-6.8 7.8 8 10.6h-6.3l-4.9-6.4-5.6 6.4H2.2l7.3-8.3L1.8 2.5h6.4l4.4 5.9 5.2-5.9Zm-1.1 16.5h1.7L7.3 4.3H5.5L16.7 19Z" />
  </Svg>
);
const never = () => () => {};
// Can this device's share sheet take a picture (phones, mostly)?
const sharesFiles = () => {
  try {
    return !!navigator.canShare?.({
      files: [new File([""], "a.png", { type: "image/png" })],
    });
  } catch {
    return false;
  }
};

// A share picture, opened right on the page, with icon buttons: Share (the phone's share sheet, where it takes a picture),
// Save, Instagram (the share sheet; on a computer: saved, caption copied, Instagram opened), Facebook and X (with a link). `at`: its page
// ("/score/12"); its picture is there too, at /image.
// tag: an Instagram handle put in the caption (copied when sharing, to paste into the post).
export default function SharePanel({
  at,
  v,
  text: plain,
  file: name,
  tag,
}: {
  at: string;
  v: string;
  text: string;
  file: string;
  tag?: string;
}) {
  const text = withTag(plain, tag);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      if (tag)
        setNote(
          `Caption copied with @${tag}: paste it into your Instagram post.`,
        );
    } catch {
      /* no clipboard here */
    }
  };
  const src = `${at}/image?v=${v}`;
  const sheet = useSyncExternalStore(never, sharesFiles, () => false);
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
    await copy();
    try {
      await navigator.share({ files: [file], text });
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setNote(
          "Sharing didn't work here. Save the picture and post it from the app.",
        );
    }
  };
  const save = useRef<HTMLAnchorElement>(null);
  // Instagram: the phone's share sheet (pick Instagram); on a computer, save the picture, copy the caption and open Instagram.
  const instagram = async () => {
    if (sheet && file) return share();
    save.current?.click();
    setNote(
      tag
        ? `Picture saved. Caption copied with @${tag}: post it on Instagram.`
        : "Picture saved: post it on Instagram.",
    );
    window.open("https://www.instagram.com/", "_blank", "noopener,noreferrer");
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
          <button
            type="button"
            disabled={!file}
            onClick={share}
            aria-label="Share picture"
            title="Share picture"
            className={`${icon} bg-thunder-blue text-white ring-thunder-blue hover:bg-thunder-blue/90`}
          >
            <ShareIcon className="size-5" />
          </button>
        )}
        <a
          ref={save}
          href={src}
          download={`${name}.png`}
          onClick={() => void copy()}
          aria-label="Save picture"
          title="Save picture"
          className={icon}
        >
          <SaveIcon />
        </a>
        <button
          type="button"
          disabled={sheet && !file}
          onClick={instagram}
          aria-label="Instagram"
          title="Instagram"
          className={`${icon} text-[#d62976]`}
        >
          <InstagramIcon />
        </button>
        <button
          type="button"
          onClick={() =>
            go(`https://www.facebook.com/sharer/sharer.php?u=${link()}`)
          }
          aria-label="Facebook"
          title="Facebook"
          className={`${icon} text-[#1877f2]`}
        >
          <FacebookIcon />
        </button>
        <button
          type="button"
          onClick={() =>
            go(
              `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${link()}`,
            )
          }
          aria-label="X"
          title="X"
          className={icon}
        >
          <XIcon />
        </button>
      </span>
      {tag && (
        <span className="mt-1.5 block text-xs text-zinc-500">
          The caption with @{tag} is copied for you: paste it into your post.
        </span>
      )}
      {note && (
        <span
          role="status"
          className={`mt-1 block text-xs ${note.startsWith("Caption copied") || note.startsWith("Picture saved") ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}
        >
          {note}
        </span>
      )}
    </span>
  );
}

// "Share" that opens the panel below it.
export function ShareToggle(p: {
  at: string;
  v: string;
  text: string;
  file: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="block">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        aria-label={open ? "Close" : `Share: ${p.text}`}
        title={open ? "Close" : "Share"}
        className={`${shareIconBtn} ${open ? "bg-blue-50 dark:bg-white/10" : ""}`}
      >
        <ShareIcon />
      </button>
      {open && <SharePanel {...p} />}
    </span>
  );
}
