"use client";

import { useState, useTransition } from "react";
import { nudgeEmail, type NudgeKind, type Recipient } from "@/lib/coach-nudge-text";
import type { NudgeList } from "@/lib/coach-nudges";
import { emailNudges, loadNudges, textNudges } from "./coach-nudges/actions";
import { Alert } from "./client-ui";

const BATCH = 10;
const GROUP = 19; // numbers in one group text
const short = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const plural = (n: number) => `${n} coach${n === 1 ? "" : "es"}`;
const btn = "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset disabled:opacity-50";

// The phone's Messages with these numbers and the words filled in (iPhones and Android phones take different links).
function openText(cells: string[], body: string) {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const b = encodeURIComponent(body);
  window.location.href = apple ? `sms://open?addresses=${cells.join(",")}&body=${b}` : `sms:${cells.join(",")}?body=${b}`;
}

// On Home's coaches-use and rosters-complete cards (Owners and Admins): remind the coaches it counts. Opens right on the card:
// who'd get it (all picked; tap to leave someone out), an optional note, each coach's own email (preview), then Email
// (sent by the app, 10 at a time) or Text (one message, opened in your Messages to send). Loaded only when opened.
export default function CoachNudge({ org, kind, count }: { org: string; kind: NudgeKind; count: number }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<NudgeList | null | "loading">(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"email" | "text" | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState(0); // which coach's email the Send box shows
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const label = kind === "use" ? "Remind coaches not using the app" : "Remind coaches to finish rosters";
  if (!count) return null;

  const load = () =>
    start(async () => {
      setList("loading");
      const l = await loadNudges(org, kind);
      setList(l);
      if (l) {
        setPicked(new Set(l.recipients.map((r) => r.coachId)));
        setText(l.text);
      }
    });
  const chosen = list && list !== "loading" ? list.recipients.filter((r) => picked.has(r.coachId)) : [];
  const withEmail = chosen.filter((r) => r.email);
  const withCell = chosen.filter((r) => r.cell);
  const groups: string[][] = [];
  for (let i = 0; i < withCell.length; i += GROUP) groups.push(withCell.slice(i, i + GROUP).map((r) => r.cell!));

  const send = () =>
    start(async () => {
      if (!list || list === "loading") return;
      setResult(null);
      const ids = withEmail.map((r) => r.coachId);
      let sent = 0;
      const noEmail = chosen.filter((r) => !r.email).map((r) => r.name);
      // A test site sends one test email (to you); the live site each coach their own, 10 at a time.
      const batches = list.live ? Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, i * BATCH + BATCH)) : [ids];
      for (const b of batches) {
        setProgress(`Sending… ${sent} of ${ids.length}`);
        const r = await emailNudges(org, kind, b, note);
        if (!r.ok) {
          setProgress(null);
          return setResult({ ok: false, text: `${sent ? `${sent} sent, then: ` : ""}${r.message}` });
        }
        sent += r.sent;
      }
      setProgress(null);
      setMode(null);
      setResult({
        ok: true,
        text: `${list.live ? `Emailed ${plural(sent)}.` : `Test mode: one test email went to you (on the live site, ${plural(sent)} would each get their own).`}${noEmail.length ? ` No email for ${noEmail.join(", ")}: text them.` : ""}`,
      });
      const l = await loadNudges(org, kind);
      if (l) setList(l);
    });

  const toggle = (id: string) => setPicked((p) => (p.has(id) ? (p.delete(id), new Set(p)) : new Set(p).add(id)));
  const showFor = (r: Recipient) => (list && list !== "loading" ? nudgeEmail(kind, r, list.context, note) : null);

  return (
    <div className="mb-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && list === null) load();
        }}
        className={`${btn} bg-thunder-blue text-white ring-thunder-blue`}
      >
        ✉️ {label}
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5">
          {list === "loading" && <p className="text-sm text-zinc-500">Loading…</p>}
          {list === null && !busy && <p className="text-sm text-zinc-500">Only the organization&apos;s Owners and Admins can send these.</p>}
          {list && list !== "loading" && (
            <>
              <p className="text-sm">
                {list.recipients.length === 0
                  ? "Nobody to remind right now."
                  : kind === "use"
                    ? `${plural(list.recipients.length)} haven't opened the app in the last 7 days.`
                    : `${plural(list.recipients.length)} (Head Coaches and Team Managers) have a roster to finish.`}{" "}
                {list.context.next && <span className="text-zinc-500">Next Game Day: {new Date(`${list.context.next}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}.</span>}
              </p>
              {!list.live && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Test mode: emails go only to you, listing who&apos;d get them. Texts open your Messages as usual.</p>}
              {list.recipients.length > 0 && (
                <>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-semibold">{chosen.length} picked</span>
                    <button type="button" className="text-thunder-blue hover:underline dark:text-blue-400" onClick={() => setPicked(new Set(list.recipients.map((r) => r.coachId)))}>
                      All
                    </button>
                    <button type="button" className="text-thunder-blue hover:underline dark:text-blue-400" onClick={() => setPicked(new Set())}>
                      None
                    </button>
                  </div>
                  <ul className="max-h-80 divide-y divide-zinc-200 overflow-y-auto rounded-lg bg-white text-sm ring-1 ring-zinc-950/10 dark:divide-white/10 dark:bg-zinc-900 dark:ring-white/10">
                    {list.recipients.map((r) => (
                      <li key={r.coachId} className="px-3 py-2">
                        <label className="flex items-start gap-2">
                          <input type="checkbox" className="mt-0.5 size-4 accent-thunder-blue" checked={picked.has(r.coachId)} onChange={() => toggle(r.coachId)} />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                              <span className="font-medium">{r.name}</span>
                              <span className="text-xs text-zinc-500">
                                {!r.email && "no email"}
                                {!r.email && !r.cell && " · "}
                                {!r.cell && "no cell"}
                              </span>
                            </span>
                            <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                              {r.teams.map((t) => (t.missing.length ? `${t.name}: ${t.missing.join(", ")}` : t.name)).join(" · ")}
                            </span>
                            {r.last && (
                              <span className="block text-xs text-zinc-400">
                                {r.last.channel === "email" ? "Emailed" : "Texted"} {short(r.last.at)} by {r.last.by}
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              setPreview(preview === r.coachId ? null : r.coachId);
                            }}
                            className="shrink-0 text-xs text-thunder-blue hover:underline dark:text-blue-400"
                          >
                            {preview === r.coachId ? "Hide" : "Email"}
                          </button>
                        </label>
                        {preview === r.coachId && (
                          <div className="mt-2 rounded-lg bg-zinc-50 p-2 text-xs dark:bg-white/5">
                            <p className="font-semibold">{showFor(r)!.subject}</p>
                            <pre className="mt-1 font-sans whitespace-pre-wrap">{showFor(r)!.text}</pre>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Your note at the top of each email (optional)</span>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} className="w-full rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10" />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy || !withEmail.length} onClick={() => (setStep(0), setMode(mode === "email" ? null : "email"))} className={`${btn} bg-white text-thunder-blue ring-thunder-blue/40 dark:bg-zinc-900 dark:text-blue-400`}>
                      ✉️ Email {plural(withEmail.length)}
                    </button>
                    <button type="button" disabled={busy || !withCell.length} onClick={() => setMode(mode === "text" ? null : "text")} className={`${btn} bg-white text-emerald-700 ring-emerald-600/40 dark:bg-zinc-900 dark:text-emerald-400`}>
                      💬 Text {plural(withCell.length)}
                    </button>
                  </div>
                  {mode === "email" && (
                    <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
                      <p className="text-sm">
                        Each of the {plural(withEmail.length)} gets their own email: their teams,{kind === "rosters" ? " what each roster is missing," : ""} why it matters and by when, copied to their team&apos;s staff and their organization&apos;s Owners, Admins and Directors of Teams. Check them here (‹ › for the next coach), then Send.
                      </p>
                      {/* The email each will get, one coach at a time, exactly as it goes. */}
                      {(() => {
                        const i = Math.min(step, withEmail.length - 1);
                        const r = withEmail[i];
                        const e = r && showFor(r);
                        if (!r || !e) return null;
                        return (
                          <div className="rounded-lg bg-zinc-50 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10">
                            <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-1.5 text-xs dark:border-white/10">
                              <button type="button" aria-label="Previous coach" disabled={i === 0} onClick={() => setStep(i - 1)} className="rounded px-2 py-0.5 text-base leading-none disabled:opacity-30">
                                ‹
                              </button>
                              <span className="min-w-0 truncate text-center">
                                <span className="font-semibold">To: {r.name}</span> <span className="text-zinc-500">&lt;{r.email}&gt; · {i + 1} of {withEmail.length}</span>
                              </span>
                              <button type="button" aria-label="Next coach" disabled={i >= withEmail.length - 1} onClick={() => setStep(i + 1)} className="rounded px-2 py-0.5 text-base leading-none disabled:opacity-30">
                                ›
                              </button>
                            </div>
                            <div className="max-h-96 overflow-y-auto px-3 py-2 text-sm">
                              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                <span className="font-semibold">Cc:</span> {r.cc.length ? r.cc.join(", ") : "nobody (no staff emails on file)"}
                              </p>
                              <p className="mt-1 font-semibold">Subject: {e.subject}</p>
                              <pre className="mt-2 font-sans whitespace-pre-wrap">{e.text}</pre>
                            </div>
                          </div>
                        );
                      })()}
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={send} className={`${btn} bg-thunder-blue text-white ring-thunder-blue`}>
                          {progress ?? `Send ${withEmail.length} email${withEmail.length === 1 ? "" : "s"}`}
                        </button>
                        <button type="button" disabled={busy} onClick={() => setMode(null)} className="text-sm text-zinc-500 hover:underline">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {mode === "text" && (
                    <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
                      <p className="text-sm">One message to all of them, opened in your Messages to send (change the words here first if you like).</p>
                      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="w-full rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10" />
                      <div className="flex flex-wrap gap-2">
                        {groups.map((g, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => {
                              const ids = withCell.slice(i * GROUP, i * GROUP + GROUP).map((r) => r.coachId);
                              void textNudges(org, kind, ids);
                              openText(g, text);
                            }}
                            className={`${btn} bg-emerald-600 text-white ring-emerald-600`}
                          >
                            💬 Open Messages{groups.length > 1 ? ` ${i * GROUP + 1}–${i * GROUP + g.length}` : ""}
                          </button>
                        ))}
                      </div>
                      {groups.length > 1 && <p className="text-xs text-zinc-500">Group texts hold 19 numbers at most, so it&apos;s split into {groups.length} texts.</p>}
                    </div>
                  )}
                </>
              )}
              {result && <Alert tone={result.ok ? "green" : "red"}>{result.text}</Alert>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
