"use client";

import { useEffect, useState, useTransition } from "react";
import { useConfirm } from "../client-ui";
import { previewGuide, sendGuideNow } from "./actions";

type Preview = Extract<Awaited<ReturnType<typeof previewGuide>>, { ok: true }>;

const when = (d: Date) =>
  new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

// One list of addresses (To, Cc or Bcc), closed to start; opened to review each.
function Addresses({ title, list }: { title: string; list: string[] }) {
  return (
    <details className="rounded-lg ring-1 ring-zinc-950/10 dark:ring-white/10">
      <summary className="cursor-pointer list-none px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">{title}</span> <span className="text-zinc-500">({list.length})</span>
      </summary>
      <ul className="max-h-48 overflow-y-auto border-t border-zinc-100 px-3 py-1.5 text-xs text-zinc-600 dark:border-white/5 dark:text-zinc-300">
        {list.length ? list.map((e) => <li key={e}>{e}</li>) : <li>(none)</li>}
      </ul>
    </details>
  );
}

const GUIDES = [
  { kind: "season", title: "Season Guide", about: "To everyone associated with the League: team staff, organizations, hosting sites and officials." },
  { kind: "hosting", title: "Hosting Guide", about: "To the staff of the organizations hosting games." },
] as const;

// The Teams page's Standard emails card, for an organization that runs Leagues: each email a card, built only once
// opened (its addresses and text come from the server).
export function StandardEmails({ org }: { org: string }) {
  return (
    <div className="space-y-2">
      {GUIDES.map((g) => (
        <GuideCard key={g.kind} org={org} {...g} />
      ))}
    </div>
  );
}

function GuideCard({ org, kind, title, about }: { org: string; kind: string; title: string; about: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 select-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block font-semibold">{title}</span>
          <span className="block text-xs text-zinc-500">{about}</span>
        </span>
        <span aria-hidden className={`text-xs text-zinc-400 transition ${open ? "rotate-90" : ""}`}>
          ▶
        </span>
      </summary>
      {open && (
        <div className="border-t border-zinc-100 p-3 dark:border-white/5">
          <GuidePanel org={org} kind={kind} title={title} />
        </div>
      )}
    </details>
  );
}

// One standard email: whether this is the live site or test mode, every address, the email itself, and the last send.
// Send asks first (a pop-up). Live: to everyone; test mode: only to you, listing the addresses. Checked on the server.
function GuidePanel({ org, kind, title }: { org: string; kind: string; title: string }) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => {
    let live = true;
    previewGuide(org, kind).then((r) => {
      if (!live) return;
      if (r.ok) setP(r);
      else setErr(r.message);
    });
    return () => {
      live = false;
    };
  }, [org, kind]);

  async function send() {
    if (!p) return;
    const ok = await confirm({
      title: p.live ? `Send the ${title} to ${p.bcc.length + p.cc.length + 1} people?` : "Send the test email to you?",
      message: p.live ? (
        <>
          To you{p.cc.length > 0 && `, Cc ${p.cc.length} organization staff`}, Bcc {p.bcc.length} {kind === "hosting" ? "hosting staff" : "team staff"}.
          {p.last?.live && ` It was last sent ${when(p.last.at)} by ${p.last.by}.`} This can&apos;t be unsent.
        </>
      ) : (
        <>Test mode: only you ({p.to}) get it, with every address it would go to on the live site. Nobody else gets anything.</>
      ),
      confirmLabel: p.live ? "Send to everyone" : "Send to me",
      tone: "warning",
    });
    if (!ok) return;
    start(async () => {
      setErr(null);
      const r = await sendGuideNow(org, kind);
      if (!r.ok) return setErr(r.message);
      setDone(
        r.live
          ? `Sent: to you, Cc ${r.cc}, Bcc ${r.bcc} (${r.emails} email${r.emails === 1 ? "" : "s"}).`
          : `Test email sent to ${r.to} with the ${r.cc + r.bcc} addresses it would go to. Check your inbox (and Spam).`,
      );
    });
  }

  if (!p) return err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p> : <p className="text-sm text-zinc-500">Getting the email ready…</p>;
  return (
    <div className="space-y-3">
      {confirmDialog}
      {p.live ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">
          <strong>Live:</strong> this goes to everyone listed below.
        </p>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <strong>Test mode:</strong> it goes only to you ({p.to}), listing these addresses. On the live site it goes to all of them.
        </p>
      )}
      <p className="text-sm">
        {p.about}
      </p>
      <div className="space-y-1.5">
        <Addresses title="To (you)" list={[p.to]} />
        {kind === "season" && <Addresses title={p.ccLabel} list={p.cc} />}
        <Addresses title={p.bccLabel} list={p.bcc} />
      </div>
      {p.last && (
        <p className="text-xs text-zinc-500">
          Last {p.last.live ? "sent" : "test"} {when(p.last.at)} by {p.last.by}.
        </p>
      )}
      <div className="rounded-xl ring-1 ring-zinc-950/10 dark:ring-white/10">
        <p className="border-b border-zinc-100 px-3 py-2 text-sm font-semibold dark:border-white/5">{p.subject}</p>
        {/* Built on the server from escaped text only (lib/season-guide). */}
        <div className="max-h-96 overflow-y-auto bg-white px-3 py-2 text-zinc-900" dangerouslySetInnerHTML={{ __html: p.html }} />
      </div>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {done ? (
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{done}</p>
      ) : (
        <button type="button" disabled={busy} onClick={send} className="w-full rounded-full bg-thunder-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Sending…" : p.live ? `Send to everyone (${p.bcc.length + p.cc.length + 1})…` : "Send the test to me…"}
        </button>
      )}
    </div>
  );
}
