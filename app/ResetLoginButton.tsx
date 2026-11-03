"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetMemberLogin } from "./reset-login/actions";
import { Toast, useConfirm } from "./client-ui";
import { eyeBtn } from "./ViewAsButton";

// 🔑 Reset login (asks first): PIN back to 1234, email cleared, logged out everywhere. Shown only to people who may
// reset this person (lib/login-reset.ts); the server checks again.
export function ResetLoginButton({ org, coachId, name }: { org: string; coachId: string; name: string }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Reset ${name}'s login (PIN 1234, clear email)`}
        title={`Reset ${name}'s login (PIN 1234, clear email)`}
        className={eyeBtn}
        onClick={async () => {
          const ok = await confirm({
            title: `Reset ${name}'s login?`,
            message: (
              <>
                <p>
                  Their PIN goes back to <strong className="font-semibold">1234</strong>, their email is cleared, and they&apos;re
                  logged out everywhere.
                </p>
                <p className="mt-2">At their next login they enter an email, confirm it with a code, and choose a new PIN.</p>
              </>
            ),
            confirmLabel: "Reset login",
            tone: "warning",
          });
          if (!ok) return;
          start(async () => {
            const r = await resetMemberLogin(org, coachId);
            setMsg(r.ok ? `${name}'s login was reset.` : r.message);
            if (r.ok) router.refresh();
          });
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-4">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
          />
        </svg>
      </button>
      {msg && <Toast key={msg} message={msg} />}
      {dialog}
    </>
  );
}
