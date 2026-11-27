"use client";

import { useState } from "react";
import { ShareIcon, shareIconBtn } from "./ShareButton";
import SharePanel from "./SharePanel";

// A game coming up on the public pages: Share opens its Game Day picture right here (no pop-up), to hype it.
export default function GameShare({ id, text, v }: { id: string; text: string; v: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        aria-label={open ? "Close" : "Share this game"}
        title={open ? "Close" : "Share this game"}
        className={`${shareIconBtn} ${open ? "bg-blue-50 dark:bg-white/10" : ""}`}
      >
        <ShareIcon />
      </button>
      {open && (
        <span className="mt-1 block w-full">
          <SharePanel at={`/game/${id}`} file={`game-${id}`} text={text} v={v} />
        </span>
      )}
    </>
  );
}
