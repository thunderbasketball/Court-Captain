"use client";
// Small client-side pieces shared by the pop-up forms.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const dialogCls =
  "m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-zinc-950/40 backdrop:backdrop-blur-sm dark:bg-zinc-900 dark:text-zinc-100";

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className="-mr-2 rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-5">
        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
      </svg>
    </button>
  );
}

export function Alert({ tone, children }: { tone: "red" | "green"; children: ReactNode }) {
  const cls =
    tone === "red"
      ? "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300"
      : "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300";
  return (
    <p role={tone === "red" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ring-1 ring-inset ${cls}`}>
      {children}
    </p>
  );
}

// A short confirmation at the bottom of the screen; fades out after 5 seconds.
export function Toast({ message }: { message: string }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShown(false), 5000);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <p
      role="status"
      className="fixed inset-x-4 bottom-4 z-30 mx-auto max-w-md rounded-xl toast bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-white dark:text-zinc-900"
    >
      {message}
    </p>
  );
}

type ConfirmOptions = { title: string; message: ReactNode; confirmLabel: string; tone?: "danger" | "warning" };

// An in-app "are you sure?" box in place of the browser's confirm().
// Usage: const [confirm, confirmDialog] = useConfirm(); ... if (await confirm({...})) ...; render {confirmDialog}.
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const ref = useRef<HTMLDialogElement>(null);
  const resolve = useRef<((ok: boolean) => void) | null>(null);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);

  const ask = (o: ConfirmOptions) =>
    new Promise<boolean>((res) => {
      resolve.current = res;
      setOpts(o);
      requestAnimationFrame(() => ref.current?.showModal());
    });
  const answer = (ok: boolean) => {
    resolve.current?.(ok);
    resolve.current = null;
    ref.current?.close();
  };

  const danger = (opts?.tone ?? "danger") === "danger";
  const element = (
    <dialog
      ref={ref}
      className={`${dialogCls} max-w-sm`}
      onClose={() => answer(false)}
      onClick={(e) => e.target === e.currentTarget && answer(false)}
    >
      {opts && (
        <div className="p-6 text-center">
          <span
            className={`mx-auto flex size-12 items-center justify-center rounded-full ${
              danger
                ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
                : "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="size-6">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0 3.75h.008M10.34 3.94 1.82 18.7A1.88 1.88 0 0 0 3.45 21.5h17.1a1.88 1.88 0 0 0 1.63-2.8L13.66 3.94a1.88 1.88 0 0 0-3.32 0Z"
              />
            </svg>
          </span>
          <h2 className="mt-4 text-lg font-semibold">{opts.title}</h2>
          <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{opts.message}</div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              autoFocus
              onClick={() => answer(false)}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-950/10 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/15 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => answer(true)}
              className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-sm ${
                danger ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"
              }`}
            >
              {opts.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
  return [ask, element];
}

// Renders its children at the end of the page (document.body), e.g. a pop-up opened from a menu that hides itself.
export function OnPage({ children }: { children: ReactNode }) {
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return ready ? createPortal(children, document.body) : null;
}
