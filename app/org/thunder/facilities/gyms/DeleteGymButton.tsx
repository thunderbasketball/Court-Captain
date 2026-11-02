"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteGym } from "../../practice/actions";
import { Toast, useConfirm } from "../../../../client-ui";

// Delete a gym after "Are you sure?". The server refuses while it has upcoming booked practices, and keeps a gym with past
// practices (hidden) so their history stays.
export function DeleteGymButton({ id, name, openSlots }: { id: string; name: string; openSlots: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="rounded-full px-3 py-1 text-xs font-medium text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 disabled:opacity-50 dark:ring-red-400/30 dark:hover:bg-red-500/10"
        onClick={async () => {
          const slots = openSlots ? ` Its ${openSlots} upcoming open slot${openSlots === 1 ? "" : "s"} go too.` : "";
          if (
            !(await confirm({
              title: `Delete ${name}?`,
              message: `Are you sure?${slots} This can't be undone.`,
              confirmLabel: "Delete gym",
            }))
          )
            return;
          start(async () => {
            const r = await deleteGym(id);
            setMsg(r.ok ? (r.kept ? `${name} removed (kept for its past practices).` : `${name} deleted.`) : r.message);
            if (r.ok) router.refresh();
          });
        }}
      >
        Delete
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {confirmDialog}
    </>
  );
}
