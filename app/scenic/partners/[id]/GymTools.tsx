"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Gym } from "@/lib/scenic-partners";
import { addCourt, deleteCourt, deleteGym, saveGym } from "../../actions";
import { Alert, CloseButton, Toast, dialogCls, useConfirm } from "../../../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../../../ui";

// "+ Add gym" (no gym given) or "Edit" one (rename, address, remove).
export function GymButton({ partnerId, gym }: { partnerId: string; gym?: Gym }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [name, setName] = useState(gym?.name ?? "");
  const [address, setAddress] = useState(gym?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, message: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.message ?? "Something went wrong.");
      close();
      setDone(message);
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setName(gym?.name ?? "");
          setAddress(gym?.address ?? "");
          setError(null);
          dialog.current?.showModal();
        }}
        className={
          gym
            ? "shrink-0 rounded-full px-3 py-1 text-xs font-medium text-scenic-navy ring-1 ring-scenic-navy/30 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20"
            : "shrink-0 rounded-full bg-scenic-navy px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-scenic-navy"
        }
      >
        {gym ? "Edit" : "+ Add gym"}
      </button>
      {done && <Toast key={done} message={done} />}
      {confirmDialog}
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => saveGym(partnerId, gym?.id ?? null, { name, address }), `${name.trim()} saved.`);
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{gym ? "Edit gym" : "Add gym"}</h2>
            <CloseButton onClick={close} />
          </div>
          <label className="block">
            <span className={fieldLabel}>Gym name</span>
            <input className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className={fieldLabel}>Address (optional)</span>
            <input
              className={inputCls}
              value={address}
              maxLength={200}
              autoComplete="street-address"
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          {error && <Alert tone="red">{error}</Alert>}
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          {gym && (
            <button
              type="button"
              disabled={busy}
              className="w-full rounded-xl px-4 py-2 text-sm font-medium text-red-600 ring-1 ring-red-600/20 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              onClick={async () => {
                if (
                  await confirm({
                    title: `Remove ${gym.name}?`,
                    message: "Its courts and their open hours are removed too. This can't be undone.",
                    confirmLabel: "Remove",
                  })
                )
                  act(() => deleteGym(gym.id), `${gym.name} removed.`);
              }}
            >
              Remove gym
            </button>
          )}
        </form>
      </dialog>
    </>
  );
}

// "+ Court": type a name (suggests the next number) and add it.
export function AddCourt({ gymId, suggestion }: { gymId: string; suggestion: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestion);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (!open)
    return (
      <button
        type="button"
        onClick={() => {
          setName(suggestion);
          setError(null);
          setOpen(true);
        }}
        className="rounded-full px-3 py-1 text-sm font-medium text-scenic-navy ring-1 ring-scenic-navy/30 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20"
      >
        + Court
      </button>
    );
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addCourt(gymId, name);
          if (!r.ok) return setError(r.message);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <input
        className={`${inputCls} max-w-40 py-2`}
        value={name}
        maxLength={60}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-scenic-navy px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-scenic-navy"
      >
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500">
        Cancel
      </button>
      {error && (
        <div className="w-full">
          <Alert tone="red">{error}</Alert>
        </div>
      )}
    </form>
  );
}

export function RemoveCourt({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Remove ${label}`}
        className="rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-700"
        onClick={async () => {
          if (await confirm({ title: `Remove ${label}?`, message: "Its open hours are removed too.", confirmLabel: "Remove" }))
            start(async () => {
              await deleteCourt(id);
              router.refresh();
            });
        }}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-4">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </button>
      {confirmDialog}
    </>
  );
}
