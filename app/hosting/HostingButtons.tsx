"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideHosting, requestHosting } from "./actions";
import { Toast, useConfirm } from "../client-ui";

const btn = "rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

// The hosting organization asks another organization to host its games.
export function RequestHostingButton({
  hostOrg,
  forOrg,
  name,
  again,
}: {
  hostOrg: string;
  forOrg: string;
  name: string;
  again?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-thunder-blue text-white`}
        onClick={() =>
          start(async () => {
            const r = await requestHosting(hostOrg, forOrg);
            setMsg(r.ok ? `Request sent to ${name}.` : r.message);
            if (r.ok) router.refresh();
          })
        }
      >
        {again ? "Ask again" : "Request to host games"}
      </button>
      {msg && <Toast key={msg} message={msg} />}
    </>
  );
}

// The organization that wants hosting sites approves or declines.
export function DecideHostingButtons({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const decide = (approve: boolean) =>
    start(async () => {
      const r = await decideHosting(id, approve);
      setMsg(r.ok ? `${name} ${approve ? "approved as a hosting partner" : "declined"}.` : r.message);
      if (r.ok) router.refresh();
    });
  return (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        disabled={busy}
        className={`${btn} bg-scenic-navy text-white dark:bg-white dark:text-scenic-navy`}
        onClick={() => decide(true)}
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        className={`${btn} text-zinc-700 ring-1 ring-zinc-950/10 dark:text-zinc-200 dark:ring-white/15`}
        onClick={async () => {
          if (await confirm({ title: `Decline ${name}?`, message: "They can ask again later.", confirmLabel: "Decline" }))
            decide(false);
        }}
      >
        Decline
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {confirmDialog}
    </div>
  );
}
