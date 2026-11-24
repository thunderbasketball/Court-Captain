"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideOwnerRemoval } from "./org-admin/actions";

// Home's Owner removal card, for the Owner someone asked to remove: Approve (asks again) or Keep my role. Nothing changes
// until they approve.
export default function OwnerRemovalCard({ list }: { list: { id: string; orgName: string; requestedBy: string }[] }) {
  const router = useRouter();
  const [sure, setSure] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const answer = (id: string, approve: boolean) =>
    start(async () => {
      setErr(null);
      const r = await decideOwnerRemoval(id, approve);
      if (!r.ok) return setErr(r.message);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      {list.map((x) => (
        <div key={x.id} className="space-y-2 text-sm">
          <p>
            <strong>{x.requestedBy}</strong> asked to remove you as an Owner of <strong>{x.orgName}</strong>. Nothing changes unless you approve it. You&apos;d
            stay an Admin.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => answer(x.id, false)}
              className="rounded-full bg-thunder-blue px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Keep my role
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => (sure === x.id ? answer(x.id, true) : setSure(x.id))}
              className="rounded-full px-4 py-1.5 text-sm font-semibold text-red-600 ring-1 ring-red-600/30 disabled:opacity-50 dark:text-red-400"
            >
              {sure === x.id ? "Yes, remove me as Owner" : "Approve removal…"}
            </button>
          </div>
        </div>
      ))}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}
