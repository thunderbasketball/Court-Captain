"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PartnerKind } from "@/lib/scenic";
import { savePartner } from "../actions";
import { Alert, CloseButton, Toast, dialogCls } from "../../client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "../../ui";

type Partner = { id: string; name: string; kind: PartnerKind; hostsGames: boolean; registersTeams: boolean; approved: boolean };

// Scenic City Directors: "+ Add partner" (no partner given) or "Edit" one.
export function PartnerButton({ partner }: { partner?: Partner }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const initial = {
    name: partner?.name ?? "",
    kind: partner?.kind ?? null,
    hostsGames: partner?.hostsGames ?? false,
    registersTeams: partner?.registersTeams ?? false,
    approved: partner?.approved ?? true,
  };
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const r = await savePartner(partner?.id ?? null, f);
      if (!r.ok) return setError(r.message);
      close();
      setDone(`${f.name.trim()} saved.`);
      if (partner) router.refresh();
      else router.push(`/scenic/partners/${r.id}`);
    });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setF(initial);
          setError(null);
          dialog.current?.showModal();
        }}
        className={
          partner
            ? "rounded-full px-3 py-1 text-xs font-medium text-scenic-navy ring-1 ring-scenic-navy/30 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20"
            : "shrink-0 rounded-full bg-scenic-navy px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-scenic-navy"
        }
      >
        {partner ? "Edit" : "+ Add partner"}
      </button>
      {done && <Toast key={done} message={done} />}
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{partner ? "Edit partner" : "Add partner"}</h2>
            <CloseButton onClick={close} />
          </div>
          <label className="block">
            <span className={fieldLabel}>Name</span>
            <input className={inputCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <div>
            <span className={fieldLabel}>Type</span>
            <div className="flex gap-2">
              {(["School", "Organization"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={f.kind === k}
                  className={pillCls(f.kind === k)}
                  onClick={() => setF({ ...f, kind: k })}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className={fieldLabel}>Takes part by</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={f.hostsGames}
                className={pillCls(f.hostsGames)}
                onClick={() => setF({ ...f, hostsGames: !f.hostsGames })}
              >
                Hosting games
              </button>
              <button
                type="button"
                aria-pressed={f.registersTeams}
                className={pillCls(f.registersTeams)}
                onClick={() => setF({ ...f, registersTeams: !f.registersTeams })}
              >
                Registering teams
              </button>
            </div>
          </div>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="size-5 accent-scenic-navy"
              checked={f.approved}
              onChange={(e) => setF({ ...f, approved: e.target.checked })}
            />
            <span className="text-sm font-medium">Approved</span>
          </label>
          {error && <Alert tone="red">{error}</Alert>}
          <button type="submit" className={primaryBtn} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </dialog>
    </>
  );
}
