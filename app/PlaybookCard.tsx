"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { LibraryPlay, Play } from "@/lib/playbook";
import { PLAY_KINDS, playKindLabel, playbookPanel, type PlayKind } from "@/lib/play-kinds";
import { CardPanel, closeCardPanel } from "./CardIcons";
import { Alert } from "./client-ui";
import { fieldLabel, inputCls, primaryBtn } from "./ui";
import { addTeamPlay, changeTeamPlay, copyLibraryPlay, removeTeamPlay, shareTeamPlay } from "./playbook/actions";
import CardSlot from "./CardSlot";
import { AddIcon } from "./CardIcons";
import { PLUS_BTN } from "./PageMenus";
import { PlayEditor, PlayViewer, startFrame } from "./PlayCourt";
import type { Frame } from "@/lib/play-diagram";

const tint: Record<PlayKind, string> = {
  Offense: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
  Defense: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200",
  Inbounds: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  Drill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
};

// A play's name, type and notes: adding one (the round + on the Playbook card's title line) or changing one.
function PlayForm({
  org,
  teamId,
  play,
  onDone,
}: {
  org: string;
  teamId: string;
  play?: Play;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(play?.name ?? "");
  const [kind, setKind] = useState<PlayKind>(play?.kind ?? "Offense");
  const [notes, setNotes] = useState(play?.notes ?? "");
  const [frames, setFrames] = useState<Frame[]>(play?.frames ?? []); // its drawing ([] = not drawn)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const input = { name, kind, notes, frames };
        const r = play ? await changeTeamPlay(org, teamId, play.id, input) : await addTeamPlay(org, teamId, input);
        setBusy(false);
        if (!r.ok) return setMsg(r.message);
        if (!play) {
          setName("");
          setNotes("");
          setFrames([]);
        }
        router.refresh();
        onDone();
      }}
    >
      <label className="block">
        <span className={fieldLabel}>Play name</span>
        <input className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Horns" />
      </label>
      <fieldset>
        <legend className={fieldLabel}>Type</legend>
        <div className="flex flex-wrap gap-1.5">
          {PLAY_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ${
                kind === k ? "bg-thunder-blue text-white ring-thunder-blue" : "text-zinc-600 ring-zinc-950/15 dark:text-zinc-300 dark:ring-white/20"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </fieldset>
      {/* Its drawing on a half court. */}
      <div>
        <span className={fieldLabel}>Diagram</span>
        {frames.length ? (
          <>
            <PlayEditor frames={frames} onChange={setFrames} />
            <button type="button" onClick={() => setFrames([])} className="mt-2 text-sm font-medium text-red-600 hover:underline dark:text-red-400">
              Remove the drawing
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setFrames([startFrame()])}
            className="rounded-full px-3 py-1 text-sm font-medium text-thunder-blue ring-1 ring-thunder-blue/40"
          >
            Draw it on a court
          </button>
        )}
      </div>
      <label className="block">
        <span className={fieldLabel}>Notes (optional)</span>
        <textarea
          className={`${inputCls} min-h-24`}
          value={notes}
          maxLength={2000}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Who goes where, the reads, when to call it"
        />
      </label>
      {msg && <Alert tone="red">{msg}</Alert>}
      <div className="flex gap-2">
        <button className={primaryBtn} disabled={busy}>
          {busy ? "Saving…" : play ? "Save" : "Add play"}
        </button>
        {play && (
          <button type="button" onClick={onDone} className="px-3 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// One play: its name and type; a tap opens its drawing, notes, who added it, Edit, Share with the organization (a team's
// play) and Delete (asked right here).
function PlayRow({ org, teamId, play }: { org: string; teamId: string; play: Play }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate text-sm font-medium">
            {play.name}
            {play.frames.length > 1 && <span className="ml-2 text-xs font-normal text-zinc-500">{play.frames.length} frames</span>}
            {play.sharedBy && (
              <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-200">
                Shared
              </span>
            )}
          </span>
          <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="space-y-2 px-4 pb-3 text-sm">
          {editing ? (
            <PlayForm org={org} teamId={teamId} play={play} onDone={() => setEditing(false)} />
          ) : (
            <>
              {play.frames.length > 0 && <PlayViewer frames={play.frames} name={play.name} />}
              {play.notes ? <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{play.notes}</p> : <p className="text-zinc-500">No notes yet.</p>}
              <p className="text-xs text-zinc-500">
                Added by {play.addedBy}
                {play.changedBy && ` · changed by ${play.changedBy}`}
                {play.sharedBy && ` · shared with the organization by ${play.sharedBy}`}
              </p>
              {msg && <Alert tone="red">{msg}</Alert>}
              <div className="flex flex-wrap gap-3 text-sm font-medium">
                <button type="button" onClick={() => setEditing(true)} className="text-thunder-blue hover:underline">
                  Edit
                </button>
                {teamId && (
                  <button
                    type="button"
                    onClick={async () => {
                      const r = await shareTeamPlay(org, teamId, play.id, !play.sharedBy);
                      if (!r.ok) return setMsg(r.message);
                      router.refresh();
                    }}
                    className="text-violet-700 hover:underline dark:text-violet-300"
                  >
                    {play.sharedBy ? "Stop sharing" : "Share with the organization"}
                  </button>
                )}
                {sure ? (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        const r = await removeTeamPlay(org, teamId, play.id);
                        if (!r.ok) return setMsg(r.message);
                        router.refresh();
                      }}
                      className="text-red-600 hover:underline dark:text-red-400"
                    >
                      Yes, delete {play.name}
                    </button>
                    <button type="button" onClick={() => setSure(false)} className="text-zinc-500 hover:underline">
                      Keep it
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setSure(true)} className="text-red-600 hover:underline dark:text-red-400">
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </details>
    </li>
  );
}

// A play in the organization's library: its drawing and notes, whose it is, and Copy (to this team, or into the
// organization's playbook).
function LibraryRow({ org, teamId, play }: { org: string; teamId: string; play: LibraryPlay }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate text-sm font-medium">
            {play.name}
            <span className="ml-2 text-xs font-normal text-zinc-500">{play.team ?? "Organization"}</span>
          </span>
          <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="space-y-2 px-4 pb-3 text-sm">
          {play.frames.length > 0 && <PlayViewer frames={play.frames} name={play.name} />}
          {play.notes ? <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{play.notes}</p> : <p className="text-zinc-500">No notes.</p>}
          <p className="text-xs text-zinc-500">
            {play.team ? `${play.team}'s play, shared by ${play.sharedBy}` : `The organization's play, added by ${play.addedBy}`}
          </p>
          {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
          <button
            type="button"
            onClick={async () => {
              const r = await copyLibraryPlay(org, teamId, play.id);
              if (!r.ok) return setMsg({ ok: false, text: r.message });
              setMsg({ ok: true, text: `Copied ✓ ${play.name} is in ${teamId ? "this team's" : "the organization's"} playbook.` });
              router.refresh();
            }}
            className="text-sm font-medium text-thunder-blue hover:underline"
          >
            {teamId ? "Copy to this team" : "Add to the organization's playbook"}
          </button>
        </div>
      </details>
    </li>
  );
}

function ByKind({ plays, row }: { plays: Play[]; row: (p: Play) => ReactNode }) {
  return (
    <>
      {PLAY_KINDS.filter((k) => plays.some((p) => p.kind === k)).map((k) => (
        <section key={k}>
          <p className="px-4 pt-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tint[k]}`}>
              {playKindLabel(k)} ({plays.filter((p) => p.kind === k).length})
            </span>
          </p>
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">{plays.filter((p) => p.kind === k).map(row)}</ul>
        </section>
      ))}
    </>
  );
}

// The Playbook card's inside (CourtPlaybook), a team's or (teamId "") the organization's own: the add form (opened by
// the round + on its title line; on Home it's put there with `slot`), then the plays by type (Offense, Defense,
// Inbounds, Drills), each sorted by name; then the organization's library to copy from (a team's card: the
// organization's plays and other teams' shared ones; Home: the plays its teams shared).
export default function PlaybookCard({
  org,
  teamId,
  plays,
  library = [],
  slot,
}: {
  org: string;
  teamId: string;
  plays: Play[];
  library?: LibraryPlay[];
  slot?: string;
}) {
  const id = playbookPanel(teamId);
  return (
    <div>
      {slot && (
        <CardSlot slot={slot}>
          <AddIcon id={id} label="Add a play" className={PLUS_BTN} />
        </CardSlot>
      )}
      <CardPanel id={id}>
        <PlayForm org={org} teamId={teamId} onDone={() => closeCardPanel(id)} />
      </CardPanel>
      {plays.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-zinc-500">No plays yet. Tap + to add the first one.</p>
      ) : (
        <div className="pb-2">
          <ByKind plays={plays} row={(p) => <PlayRow key={p.id} org={org} teamId={teamId} play={p} />} />
        </div>
      )}
      {library.length > 0 && (
        <details className="group border-t border-zinc-100 dark:border-white/5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-sm font-semibold text-violet-800 dark:text-violet-200">
              {teamId ? "From the organization" : "Shared by teams"} <span className="font-normal text-zinc-500">({library.length})</span>
            </span>
            <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="pb-2">
            <ByKind plays={library} row={(p) => <LibraryRow key={p.id} org={org} teamId={teamId} play={p as LibraryPlay} />} />
          </div>
        </details>
      )}
    </div>
  );
}
