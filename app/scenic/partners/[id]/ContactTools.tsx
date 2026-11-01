"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setContact } from "../../actions";
import { Toast, useConfirm } from "../../../client-ui";
import { inputCls } from "../../../ui";

// Directors: "+ Add contact" picks an active user, who becomes a contact for this partner (and gets the Partner role).
export function AddContact({ partnerId, options }: { partnerId: string; options: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setPick("");
          setError(null);
          setOpen(true);
        }}
        className="rounded-full px-3 py-0.5 text-sm font-medium text-scenic-navy ring-1 ring-scenic-navy/30 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20"
      >
        + Add contact
      </button>
    );
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setContact(partnerId, pick, true);
          if (!r.ok) return setError(r.message);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <select className={`${inputCls} max-w-64 py-2`} value={pick} onChange={(e) => setPick(e.target.value)} autoFocus>
        <option value="" disabled>
          Pick a person…
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy || !pick}
        className="rounded-full bg-scenic-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-scenic-navy"
      >
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500">
        Cancel
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}

export function RemoveContact({
  partnerId,
  coachId,
  name,
  partnerName,
}: {
  partnerId: string;
  coachId: string;
  name: string;
  partnerName: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Remove ${name}`}
        className="rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-700"
        onClick={async () => {
          if (
            await confirm({
              title: `Remove ${name}?`,
              message: `${name} won't be a contact for ${partnerName} any more (and loses the Partner role if it was their only partner).`,
              confirmLabel: "Remove",
            })
          )
            start(async () => {
              const r = await setContact(partnerId, coachId, false);
              if (r.ok) router.refresh();
              else setError(r.message);
            });
        }}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-4">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </button>
      {error && <Toast key={error} message={error} />}
      {confirmDialog}
    </>
  );
}
