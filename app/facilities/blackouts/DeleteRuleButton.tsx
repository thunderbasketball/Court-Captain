"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBlackoutRule } from "../../practice/actions";
import { Toast, useConfirm } from "../../client-ui";

export function DeleteRuleButton({ ruleId, label }: { ruleId: string; label: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const [toast, setToast] = useState<string | null>(null);
  return (
    <>
      {confirmDialog}
      {toast && <Toast key={toast} message={toast} />}
      <button
        type="button"
        disabled={busy}
        className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-red-600 ring-1 ring-red-600/20 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
        onClick={async () => {
          const ok = await confirm({
            title: `Stop blocking ${label} every year?`,
            message: <p>Its upcoming dates are removed and those practice slots open up again. Past dates stay as they were.</p>,
            confirmLabel: "Stop yearly blackout",
            tone: "warning",
          });
          if (!ok) return;
          start(async () => {
            const r = await deleteBlackoutRule(ruleId);
            setToast(r.ok ? `Stopped. ${r.reopened} slot${r.reopened === 1 ? "" : "s"} reopened.` : r.message);
            router.refresh();
          });
        }}
      >
        Remove
      </button>
    </>
  );
}
