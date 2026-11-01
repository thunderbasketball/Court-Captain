"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserListItem } from "@/lib/users";
import { addUser, approveJoin, deleteUser, denyRequest, resetLogin, updateUser } from "./actions";
import { Alert, CloseButton, OnPage, Toast, dialogCls, useConfirm } from "../client-ui";
import { fieldLabel, inputCls, primaryBtn } from "../ui";

// An on/off switch row: label on the left, toggle on the right.
function Toggle({
  label,
  hint,
  on,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 py-2 ${disabled ? "opacity-50" : ""}`}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-thunder-blue" : "bg-zinc-300 dark:bg-zinc-700"}`}
      >
        <span
          className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`}
        />
      </button>
    </label>
  );
}

export function EditUserButton({
  user,
  isSelf,
  deleteBlocker,
}: {
  user: UserListItem;
  isSelf: boolean;
  deleteBlocker: string | null;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const initial = {
    first: user.firstName,
    last: user.lastName,
    email: user.email ?? "",
    active: user.active,
    coach: user.coach,
    director: user.director,
  };
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const pending = user.request && !user.coach && !user.director;
  const [confirm, confirmDialog] = useConfirm();

  const finish = (message: string) => {
    close();
    setDone(message);
    router.refresh();
  };
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, message: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.ok) finish(message);
      else setError(r.message ?? "Something went wrong.");
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
        className="rounded-full px-3 py-1 text-xs font-medium text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
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
            act(() => updateUser(user.coachId, f), `${f.first} ${f.last} saved.`);
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Edit user</h2>
            <CloseButton onClick={close} />
          </div>

          {pending && (
            <div className="space-y-2 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Requested access</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white"
                  onClick={() =>
                    act(() => updateUser(user.coachId, { ...f, coach: true }), `${f.first} ${f.last} approved as Coach.`)
                  }
                >
                  Approve as Coach
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-full px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-950/10 dark:text-zinc-200 dark:ring-white/15"
                  onClick={() => act(() => denyRequest(user.coachId), `${f.first} ${f.last}'s request denied.`)}
                >
                  Deny
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabel}>First name</span>
              <input className={inputCls} value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} />
            </label>
            <label className="block">
              <span className={fieldLabel}>Last name</span>
              <input className={inputCls} value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabel}>Email</span>
            <input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            {f.email.trim().toLowerCase() !== (user.email ?? "") && f.email.trim() && (
              <span className="mt-1 block text-xs text-zinc-500">
                They&apos;ll confirm the new email with a code at their next login.
              </span>
            )}
          </label>
          <p className="text-sm text-zinc-500">
            Cell {user.cell.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")} · CoachID {user.coachId}
          </p>

          <div className="divide-y divide-zinc-100 rounded-xl px-4 ring-1 ring-zinc-950/5 dark:divide-white/5 dark:ring-white/10">
            <Toggle
              label="Active"
              hint={isSelf ? "You can't deactivate yourself." : "Inactive people can't log in."}
              on={f.active}
              disabled={isSelf}
              onChange={(v) => setF({ ...f, active: v })}
            />
            <Toggle label="Coach" on={f.coach} onChange={(v) => setF({ ...f, coach: v })} />
          </div>
          {user.teams.length > 0 && (
            <p className="text-xs text-zinc-500">
              On teams: {user.teams.join(", ")}. Team roles are changed on each team&apos;s page.
            </p>
          )}
          {user.updatedBy && <p className="text-xs text-zinc-400">Last changed by {user.updatedBy}</p>}

          {error && <Alert tone="red">{error}</Alert>}
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy ? "Saving…" : "Save"}
          </button>

          <div className="space-y-3 border-t border-zinc-100 pt-4 dark:border-white/5">
            {!isSelf && (
              <div>
                <button
                  type="button"
                  disabled={busy}
                  className="text-sm font-medium text-amber-700 hover:underline dark:text-amber-400"
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Reset ${user.firstName} ${user.lastName}'s login?`,
                      message: (
                        <>
                          <p>
                            Their PIN goes back to <strong className="font-semibold">1234</strong>, their email is cleared, and
                            they&apos;re logged out everywhere.
                          </p>
                          <p className="mt-2">
                            At their next login they enter an email, confirm it with a code, and choose a new PIN.
                          </p>
                        </>
                      ),
                      confirmLabel: "Reset login",
                      tone: "warning",
                    });
                    if (ok) act(() => resetLogin(user.coachId), `${user.firstName} ${user.lastName}'s login was reset.`);
                  }}
                >
                  Reset login (PIN 1234, clear email)
                </button>
              </div>
            )}
            {deleteBlocker ? (
              <p className="text-xs text-zinc-500">Can&apos;t delete: {deleteBlocker}</p>
            ) : (
              <button
                type="button"
                disabled={busy}
                className="text-sm font-medium text-red-600 hover:underline dark:text-red-400"
                onClick={async () => {
                  const ok = await confirm({
                    title: `Delete ${user.firstName} ${user.lastName}?`,
                    message: (
                      <>
                        <p>
                          This permanently removes their login.{" "}
                          <strong className="font-semibold text-red-600 dark:text-red-400">It can&apos;t be undone.</strong>
                        </p>
                        <p className="mt-2">To keep their record, turn off Active instead.</p>
                      </>
                    ),
                    confirmLabel: "Delete permanently",
                  });
                  if (ok) act(() => deleteUser(user.coachId), `${user.firstName} ${user.lastName} deleted.`);
                }}
              >
                Delete user
              </button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}

const blank = { first: "", last: "", cell: "", email: "", coach: true };

// `label` / `className`: shown as an item in the Users page's "+ Add" menu.
export function AddUserButton({ label = "+ Add user", className }: { label?: string; className?: string } = {}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setF(blank);
          setError(null);
          dialog.current?.showModal();
        }}
        className={
          className ??
          "shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
        }
      >
        {label}
      </button>
      {done && <Toast key={done} message={done} />}
      <OnPage>
        <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
          <form
            className="space-y-4 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const r = await addUser(f);
                if (!r.ok) return setError(r.message);
                close();
                setDone(`${f.first} ${f.last} added. They can log in with PIN 1234.`);
                router.refresh();
              });
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add user</h2>
              <CloseButton onClick={close} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={fieldLabel}>First name</span>
                <input
                  className={inputCls}
                  autoComplete="off"
                  value={f.first}
                  onChange={(e) => setF({ ...f, first: e.target.value })}
                />
              </label>
              <label className="block">
                <span className={fieldLabel}>Last name</span>
                <input
                  className={inputCls}
                  autoComplete="off"
                  value={f.last}
                  onChange={(e) => setF({ ...f, last: e.target.value })}
                />
              </label>
            </div>
            <label className="block">
              <span className={fieldLabel}>Cell</span>
              <input
                className={inputCls}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="(423) 555-1234"
                value={f.cell}
                onChange={(e) => setF({ ...f, cell: e.target.value })}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>Email (for their login code)</span>
              <input
                className={inputCls}
                type="email"
                autoComplete="off"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </label>
            <div className="divide-y divide-zinc-100 rounded-xl px-4 ring-1 ring-zinc-950/5 dark:divide-white/5 dark:ring-white/10">
              <Toggle label="Coach" on={f.coach} onChange={(v) => setF({ ...f, coach: v })} />
            </div>
            <p className="text-xs text-zinc-500">They start with PIN 1234 and choose their own at first login.</p>
            {error && <Alert tone="red">{error}</Alert>}
            <button type="submit" disabled={busy || !f.first || !f.last || !f.cell} className={primaryBtn}>
              {busy ? "Adding…" : "Add user"}
            </button>
          </form>
        </dialog>
      </OnPage>
    </>
  );
}

// A team staff sign-up for a listed team: one tap puts them on that team in the role they asked for.
export function ApproveJoinButton({ coachId, label }: { coachId: string; label: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className="rounded-full bg-thunder-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const r = await approveJoin(coachId);
            setMsg(r.message);
            if (r.ok) router.refresh();
          })
        }
      >
        {label}
      </button>
      {msg && <Toast key={msg} message={msg} />}
    </>
  );
}
