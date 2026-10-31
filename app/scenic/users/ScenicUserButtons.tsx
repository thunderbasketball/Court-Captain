"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SCENIC_ROLES, type ScenicRole } from "@/lib/orgs";
import { approveRequest, denyRequest, setScenicRoles } from "../actions";
import { Alert, CloseButton, Toast, dialogCls, useConfirm } from "../../client-ui";
import { primaryBtn } from "../../ui";

const ABOUT: Record<ScenicRole, string> = {
  Director: "Runs Scenic City: programs, partners, users",
  Partner: "A school or organization's contact",
  Solo: "Registers and manages their own teams",
  Coach: "Coaches a Scenic City team",
};

const smallBtn = "rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50";

// Approve (as the role asked for) or Deny a join request.
export function RequestButtons({ coachId, name, wants }: { coachId: string; name: string; wants: "Partner" | "Solo" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, message: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) {
        setDone(message);
        router.refresh();
      } else setError(r.message ?? "Something went wrong.");
    });

  return (
    <div className="space-y-2 pt-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          className={`${smallBtn} bg-scenic-navy text-white dark:bg-white dark:text-scenic-navy`}
          onClick={() => act(() => approveRequest(coachId, wants), `${name} approved as ${wants}.`)}
        >
          Approve as {wants}
        </button>
        <button
          type="button"
          disabled={busy}
          className={`${smallBtn} font-medium text-zinc-700 ring-1 ring-zinc-950/10 dark:text-zinc-200 dark:ring-white/15`}
          onClick={async () => {
            if (await confirm({ title: "Deny request?", message: `${name} won't get access to Scenic City.`, confirmLabel: "Deny" }))
              act(() => denyRequest(coachId), `${name}'s request denied.`);
          }}
        >
          Deny
        </button>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      {done && <Toast key={done} message={done} />}
      {confirmDialog}
    </div>
  );
}

// Pop-up to change someone's Scenic City roles.
export function EditScenicRoles({ coachId, name, roles }: { coachId: string; name: string; roles: ScenicRole[] }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [on, setOn] = useState<ScenicRole[]>(roles);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const save = () =>
    start(async () => {
      setError(null);
      if (!on.length && !(await confirm({ title: "Remove from Scenic City?", message: `${name} will have no Scenic City role.`, confirmLabel: "Remove" })))
        return;
      const r = await setScenicRoles(coachId, on);
      if (r.ok) {
        close();
        setDone(`${name} saved.`);
        router.refresh();
      } else setError(r.message);
    });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOn(roles);
          setError(null);
          dialog.current?.showModal();
        }}
        className="rounded-full px-3 py-1 text-xs font-medium text-scenic-navy ring-1 ring-scenic-navy/30 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20 dark:hover:bg-zinc-800"
      >
        Edit
      </button>
      {done && <Toast key={done} message={done} />}
      {confirmDialog}
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{name}: Scenic City roles</h2>
            <CloseButton onClick={close} />
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-white/5">
            {SCENIC_ROLES.filter((r) => r !== "Director").map((r) => {
              return (
                <label key={r} className="flex items-center gap-3 py-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-scenic-navy"
                    checked={on.includes(r)}
                    onChange={(e) => setOn(e.target.checked ? [...on, r] : on.filter((x) => x !== r))}
                  />
                  <span>
                    <span className="block text-sm font-medium">{r}</span>
                    <span className="block text-xs text-zinc-500">{ABOUT[r]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-zinc-500">Directors are added in the Directors section of this page.</p>
          {on.includes("Partner") || !roles.includes("Partner") ? null : (
            <p className="text-xs text-zinc-500">Removing Partner also takes them off their schools/organizations.</p>
          )}
          {error && <Alert tone="red">{error}</Alert>}
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </dialog>
    </>
  );
}
