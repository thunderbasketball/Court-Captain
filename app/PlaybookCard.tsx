"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { LibraryPlay, Play } from "@/lib/playbook";
import { PLAY_KINDS, playKindLabel, playbookPanel, visibilityLabel, type PlayKind, type Visibility } from "@/lib/play-kinds";
import { CardPanel, closeCardPanel } from "./CardIcons";
import { Alert, PopUp } from "./client-ui";
import { MAX_VIDEOS, videoPlayer } from "@/lib/play-video";
import { fieldLabel, inputCls, primaryBtn } from "./ui";
import { addTeamPlay, changeTeamPlay, copyLibraryPlay, draftTeamPlay, removePlayFormation, removeTeamPlay, savePlayFormation } from "./playbook/actions";
import { FORMATION_KINDS, formationsFor, fromFormation, isBuiltIn, type Formation, type FormationKind } from "@/lib/play-formations";
import { GearIcon } from "./OrgSettings";
import { PanelIcon } from "./CardIcons";
import SubCard from "./SubCard";
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

// Who sees a play: its tag on the play's row and its choices in the form (the organization's own plays have no Team).
const visTint: Record<Visibility, string> = {
  private: "bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300",
  team: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
  org: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200",
  public: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
};
const visHint: Record<Visibility, string> = {
  private: "Only you.",
  team: "This team's coaches, players and parents.",
  org: "The organization's coaches can see and copy it.",
  public: "Coaches in every organization with CourtPlaybook can see and copy it.",
};
const visIcon: Record<Visibility, string> = { private: "🔒 ", team: "", org: "", public: "🌐 " };
function VisTag({ v }: { v: Visibility }) {
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${visTint[v]}`}>
      {visIcon[v]}
      {visibilityLabel[v]}
    </span>
  );
}

// A play's name, type and notes: adding one (the round + on the Playbook card's title line) or changing one.
function PlayForm({
  org,
  teamId,
  play,
  onDone,
  own,
  preset,
}: {
  org: string;
  teamId: string;
  play?: Play;
  onDone: () => void;
  own: Formation[]; // the playbook's own formations (with the built-ins, what Offense and Defense plays start from)
  preset?: { kind: PlayKind; formation?: string | null }; // added from a type's or formation's card
}) {
  const router = useRouter();
  const [name, setName] = useState(play?.name ?? "");
  const [kind, setKind] = useState<PlayKind>(play?.kind ?? preset?.kind ?? "Offense");
  const [formation, setFormation] = useState<string | null>(play ? play.formation : (preset?.formation ?? null));
  const hasFormation = kind === "Offense" || kind === "Defense";
  const choicesF = hasFormation ? formationsFor(kind as FormationKind, own, formation ? [formation] : []) : [];
  const picked = choicesF.find((f) => f.name.toLowerCase() === (formation ?? "").toLowerCase()) ?? null;
  const [notes, setNotes] = useState(play?.notes ?? "");
  const [frames, setFrames] = useState<Frame[]>(play?.frames ?? []); // its drawing ([] = not drawn)
  // Who sees it: a new play starts as Team (the organization's own: Org). Private only for the person who made it.
  const [visibility, setVisibility] = useState<Visibility>(play?.visibility ?? (teamId ? "team" : "org"));
  // Links to videos of it being run (one box to start; + Add another link, up to 5).
  const [videos, setVideos] = useState<string[]>(play?.videos.length ? play.videos : [""]);
  // ✨ Draft from description: Claude draws a first version from the coach's words.
  const [drafting, setDrafting] = useState(false);
  const [described, setDescribed] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftMsg, setDraftMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const choices = (["private", "team", "org", "public"] as const).filter(
    (v) => (teamId || v !== "team") && (v !== "private" || !play || play.mine || play.visibility === "private"),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="space-y-3 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const input = { name, kind, notes, frames, visibility, formation: hasFormation ? formation : null, videos };
        const r = play ? await changeTeamPlay(org, teamId, play.id, input) : await addTeamPlay(org, teamId, input);
        setBusy(false);
        if (!r.ok) return setMsg(r.message);
        if (!play) {
          setName("");
          setNotes("");
          setFrames([]);
          setVisibility(teamId ? "team" : "org");
          setFormation(preset?.formation ?? null);
          setVideos([""]);
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
      {hasFormation && (
        <fieldset>
          <legend className={fieldLabel}>Base formation</legend>
          <div className="flex flex-wrap gap-1.5">
            {[...choicesF.map((f) => f.name), null].map((n) => (
              <button
                key={n ?? ""}
                type="button"
                aria-pressed={formation === n}
                onClick={() => {
                  setFormation(n);
                  // An untouched drawing (one frame, no lines) moves to the new formation's spots.
                  const f = choicesF.find((x) => x.name === n);
                  if (frames.length === 1 && !frames[0].lines.length) setFrames([f ? fromFormation(f) : startFrame()]);
                }}
                className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ${
                  formation === n ? "bg-thunder-blue text-white ring-thunder-blue" : "text-zinc-600 ring-zinc-950/15 dark:text-zinc-300 dark:ring-white/20"
                }`}
              >
                {n ?? "Other"}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset>
        <legend className={fieldLabel}>Who sees it</legend>
        <div className="flex flex-wrap gap-1.5">
          {choices.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={visibility === v}
              onClick={() => setVisibility(v)}
              className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ${
                visibility === v ? "bg-thunder-blue text-white ring-thunder-blue" : "text-zinc-600 ring-zinc-950/15 dark:text-zinc-300 dark:ring-white/20"
              }`}
            >
              {visIcon[v]}
              {visibilityLabel[v]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500">{visHint[visibility]}</p>
      </fieldset>
      {/* Its drawing on a half court. */}
      <div>
        <span className={fieldLabel}>Diagram</span>
        {drafting ? (
          <div className="mb-3 space-y-2 rounded-xl bg-violet-50 p-3 dark:bg-violet-500/10">
            <p className="text-xs text-violet-900 dark:text-violet-200">
              Say who starts where and what each player does, in order. Claude draws a first version for you to check and fix.
            </p>
            <textarea
              className={`${inputCls} min-h-24`}
              value={described}
              maxLength={1500}
              onChange={(e) => setDescribed(e.target.value)}
              placeholder="Horns. 1 dribbles to the right wing, 5 sets a ball screen, 4 pops to the top, 2 cuts baseline to the left corner."
            />
            {draftMsg && <Alert tone={draftMsg.ok ? "green" : "red"}>{draftMsg.text}</Alert>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={draftBusy || described.trim().length < 10}
                onClick={async () => {
                  setDraftBusy(true);
                  setDraftMsg(null);
                  const r = await draftTeamPlay(org, teamId, {
                    description: described,
                    kind,
                    formation: hasFormation ? formation : null,
                    start: frames[0] ?? (picked ? fromFormation(picked) : null),
                  });
                  setDraftBusy(false);
                  if (!r.ok) return setDraftMsg({ ok: false, text: r.message });
                  setFrames(r.frames);
                  if (!notes.trim() && r.notes) setNotes(r.notes);
                  setDraftMsg({ ok: true, text: `Drafted ✓ ${r.frames.length} frame${r.frames.length === 1 ? "" : "s"}. Check it below, fix anything, then save.` });
                }}
                className="rounded-full bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {draftBusy ? "Drafting… (up to a minute)" : frames.length ? "✨ Draft it (replaces the drawing)" : "✨ Draft it"}
              </button>
              <button type="button" onClick={() => setDrafting(false)} className="text-sm text-zinc-500 hover:underline">
                Close
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => (setDrafting(true), setDraftMsg(null))}
            className="mb-2 mr-2 rounded-full px-3 py-1 text-sm font-medium text-violet-700 ring-1 ring-violet-500/40 dark:text-violet-300"
          >
            ✨ Draft from description
          </button>
        )}
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
            onClick={() => setFrames([picked ? fromFormation(picked) : startFrame()])}
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
      <div>
        <span className={fieldLabel}>Video links (optional)</span>
        <p className="mb-1.5 text-xs text-zinc-500">Examples of the play being run: a YouTube, Vimeo or other video link.</p>
        <div className="space-y-1.5">
          {videos.map((v, n) => (
            <div key={n} className="flex items-center gap-2">
              <input
                className={inputCls}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                value={v}
                maxLength={500}
                onChange={(e) => setVideos(videos.map((x, k) => (k === n ? e.target.value : x)))}
                placeholder="https://youtu.be/…"
              />
              {(videos.length > 1 || v) && (
                <button
                  type="button"
                  aria-label="Remove this link"
                  onClick={() => setVideos(videos.length > 1 ? videos.filter((_, k) => k !== n) : [""])}
                  className="shrink-0 px-1 text-lg text-zinc-400 hover:text-red-600"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {videos.length < MAX_VIDEOS && videos.every((v) => v.trim()) && (
          <button type="button" onClick={() => setVideos([...videos, ""])} className="mt-1.5 text-sm font-medium text-thunder-blue hover:underline">
            + Add another link
          </button>
        )}
      </div>
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

// One play: its name, type and who sees it; a tap opens its drawing, notes, who added it, Edit (who sees it is set there)
// and Delete (asked right here).
function PlayRow({ org, teamId, play, own }: { org: string; teamId: string; play: Play; own: Formation[] }) {
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
            {play.videos.length > 0 && <span className="ml-2 text-xs font-normal text-zinc-500">▶ {play.videos.length}</span>}
            <VisTag v={play.visibility} />
          </span>
          <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="space-y-2 px-4 pb-3 text-sm">
          {editing ? (
            <PlayForm org={org} teamId={teamId} play={play} own={own} onDone={() => setEditing(false)} />
          ) : (
            <>
              {play.frames.length > 0 && <PlayViewer frames={play.frames} name={play.name} />}
              <Videos name={play.name} links={play.videos} />
              {play.notes ? <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{play.notes}</p> : <p className="text-zinc-500">No notes yet.</p>}
              <p className="text-xs text-zinc-500">
                Added by {play.addedBy}
                {play.changedBy && ` · changed by ${play.changedBy}`}
                {play.sharedBy && ` · made ${visibilityLabel[play.visibility]} by ${play.sharedBy}`}
              </p>
              {msg && <Alert tone="red">{msg}</Alert>}
              <div className="flex flex-wrap gap-3 text-sm font-medium">
                <button type="button" onClick={() => setEditing(true)} className="text-thunder-blue hover:underline">
                  Edit
                </button>
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

// A play in a library (the organization's, or another organization's Public play): its drawing and notes, whose it is,
// and Copy (to this team, or into the organization's playbook).
function LibraryRow({ org, teamId, play }: { org: string; teamId: string; play: LibraryPlay }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate text-sm font-medium">
            {play.name}
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {play.orgName ? `${play.orgName}${play.teamId ? ` · ${play.team}` : ""}` : (play.teamId ? play.team : "Organization")}
            </span>
          </span>
          <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="space-y-2 px-4 pb-3 text-sm">
          {play.frames.length > 0 && <PlayViewer frames={play.frames} name={play.name} />}
          <Videos name={play.name} links={play.videos} />
          {play.notes ? <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{play.notes}</p> : <p className="text-zinc-500">No notes.</p>}
          <p className="text-xs text-zinc-500">
            {play.formation && `${play.formation} · `}
            {play.teamId ? `${play.team}'s play` : `${play.orgName ?? "The organization"}'s play`}, added by {play.addedBy}
            {play.sharedBy && ` · made ${visibilityLabel[play.visibility]} by ${play.sharedBy}`}
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

// The Playbook card's inside (CourtPlaybook), a team's or (teamId "") the organization's own, as cards: **Offense** and
// **Defense** (each opening to a card per Base Formation with its plays; the round + on the type's title line adds a
// formation, a formation's + adds a play in it, its gear changes where the players stand), then **Inbounds** and
// **Drills** (their plays; + adds one). The round + on the Playbook card's own title line adds any play (on Home it's put
// there with `slot`). Then the libraries to copy from.
export default function PlaybookCard({
  org,
  teamId,
  plays,
  library = [],
  formations = [],
  slot,
}: {
  org: string;
  teamId: string;
  plays: Play[];
  library?: LibraryPlay[];
  formations?: Formation[];
  slot?: string;
}) {
  const id = playbookPanel(teamId);
  const row = (p: Play) => <PlayRow key={p.id} org={org} teamId={teamId} play={p} own={formations} />;
  return (
    <div>
      {slot && (
        <CardSlot slot={slot}>
          <AddIcon id={id} label="Add a play" className={PLUS_BTN} />
        </CardSlot>
      )}
      <CardPanel id={id}>
        <PlayForm org={org} teamId={teamId} own={formations} onDone={() => closeCardPanel(id)} />
      </CardPanel>
      <div className="space-y-2 px-3 pt-1 pb-3">
        {FORMATION_KINDS.map((k) => (
          <KindCard key={k} org={org} teamId={teamId} kind={k} plays={plays.filter((p) => p.kind === k)} own={formations} row={row} />
        ))}
        {(["Inbounds", "Drill"] as const).map((k) => {
          const mine = plays.filter((p) => p.kind === k);
          const pid = `${id}-${k}`;
          return (
            <SubCard key={k} title={playKindLabel(k)} count={mine.length} action={<AddIcon id={pid} label={`Add ${k === "Drill" ? "a drill" : "an Inbounds play"}`} />}>
              <div className="-m-3">
                <CardPanel id={pid}>
                  <PlayForm org={org} teamId={teamId} own={formations} preset={{ kind: k }} onDone={() => closeCardPanel(pid)} />
                </CardPanel>
                {mine.length ? (
                  <ul className="divide-y divide-zinc-100 dark:divide-white/5">{mine.map(row)}</ul>
                ) : (
                  <p className="px-4 py-3 text-sm text-zinc-500">None yet. Tap + to add one.</p>
                )}
              </div>
            </SubCard>
          );
        })}
      </div>
      {/* The organization's library, then every other organization's Public plays. */}
      <Library
        title={teamId ? "From the organization" : "Shared by teams"}
        tone="text-violet-800 dark:text-violet-200"
        plays={library.filter((p) => !p.orgName)}
        row={(p) => <LibraryRow key={p.id} org={org} teamId={teamId} play={p} />}
      />
      <Library
        title="🌐 Public plays"
        tone="text-emerald-800 dark:text-emerald-200"
        plays={library.filter((p) => p.orgName)}
        row={(p) => <LibraryRow key={p.id} org={org} teamId={teamId} play={p} />}
      />
    </div>
  );
}

// Offense or Defense: a card per Base Formation (built-ins, the playbook's own, and any its plays use), then Other
// (plays with none). The round + on its title line adds a formation.
function KindCard({
  org,
  teamId,
  kind,
  plays,
  own,
  row,
}: {
  org: string;
  teamId: string;
  kind: FormationKind;
  plays: Play[];
  own: Formation[];
  row: (p: Play) => ReactNode;
}) {
  const used = [...new Set(plays.flatMap((p) => (p.formation ? [p.formation] : [])))];
  const list = formationsFor(kind, own, used);
  const inIt = (f: Formation) => plays.filter((p) => p.formation?.toLowerCase() === f.name.toLowerCase());
  const other = plays.filter((p) => !p.formation);
  const pid = `${playbookPanel(teamId)}-new-${kind}`;
  return (
    <SubCard title={kind} count={plays.length} action={<AddIcon id={pid} label={`Add ${kind === "Offense" ? "an Offense" : "a Defense"} formation`} />}>
      <div className="space-y-2">
        <CardPanel id={pid} className="pb-1">
          <FormationForm org={org} teamId={teamId} kind={kind} onDone={() => closeCardPanel(pid)} />
        </CardPanel>
        {list.map((f) => (
          <FormationCard key={f.name} org={org} teamId={teamId} formation={f} plays={inIt(f)} own={own} row={row} />
        ))}
        {other.length > 0 && (
          <SubCard title="Other" count={other.length}>
            <ul className="-m-3 divide-y divide-zinc-100 dark:divide-white/5">{other.map(row)}</ul>
          </SubCard>
        )}
      </div>
    </SubCard>
  );
}

// A Base Formation's card: its plays (+ adds one starting from it), where the players start, and (its gear) changing
// that, renaming it, or deleting the playbook's own.
function FormationCard({
  org,
  teamId,
  formation: f,
  plays,
  own,
  row,
}: {
  org: string;
  teamId: string;
  formation: Formation;
  plays: Play[];
  own: Formation[];
  row: (p: Play) => ReactNode;
}) {
  const base = `${playbookPanel(teamId)}-${f.kind}-${encodeURIComponent(f.name.toLowerCase())}`;
  const add = `${base}-add`;
  const gear = `${base}-gear`;
  return (
    <SubCard
      title={f.name}
      count={plays.length}
      action={
        <div className="flex gap-1">
          <PanelIcon id={gear} label={`Change ${f.name}`}>
            <GearIcon className="size-5" />
          </PanelIcon>
          <AddIcon id={add} label={`Add a play in ${f.name}`} />
        </div>
      }
    >
      <div className="-m-3">
        <CardPanel id={gear}>
          <FormationForm org={org} teamId={teamId} kind={f.kind} formation={f} onDone={() => closeCardPanel(gear)} />
        </CardPanel>
        <CardPanel id={add}>
          <PlayForm org={org} teamId={teamId} own={own} preset={{ kind: f.kind, formation: f.name }} onDone={() => closeCardPanel(add)} />
        </CardPanel>
        {plays.length ? (
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">{plays.map(row)}</ul>
        ) : (
          <p className="px-4 py-3 text-sm text-zinc-500">No plays yet. Tap + to add one starting from {f.name}.</p>
        )}
        <details className="group border-t border-zinc-100 dark:border-white/5">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2 text-xs font-medium text-zinc-500 [&::-webkit-details-marker]:hidden">
            Where they start
            <span aria-hidden className="transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="px-4 pb-3">
            <PlayViewer frames={[f.spots]} name={f.name} />
          </div>
        </details>
      </div>
    </SubCard>
  );
}

// A formation's name and where the players stand: adding one, or changing one (a built-in's change makes the playbook's
// own version of it; Delete takes the playbook's own away, back to the built-in when it has one).
function FormationForm({ org, teamId, kind, formation, onDone }: { org: string; teamId: string; kind: FormationKind; formation?: Formation; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(formation?.name ?? "");
  const [frames, setFrames] = useState<Frame[]>([formation ? fromFormation(formation) : kind === "Offense" ? startFrame() : { spots: [], ball: null, lines: [] }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const builtIn = formation ? isBuiltIn(kind, formation.name) : false;
  return (
    <form
      className="space-y-3 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const r = await savePlayFormation(org, teamId, formation?.id ?? null, { kind, name, spots: frames[0] });
        setBusy(false);
        if (!r.ok) return setMsg(r.message);
        if (!formation) {
          setName("");
          setFrames([kind === "Offense" ? startFrame() : { spots: [], ball: null, lines: [] }]);
        }
        router.refresh();
        onDone();
      }}
    >
      <label className="block">
        <span className={fieldLabel}>{kind} formation name</span>
        <input
          className={inputCls}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "Offense" ? "Box" : "Box-and-1"}
          disabled={!!formation && !formation.id && builtIn}
        />
        {formation && !formation.id && builtIn && <span className="mt-1 block text-xs text-zinc-500">Built in: change where they stand to make it your own.</span>}
      </label>
      <div>
        <span className={fieldLabel}>Where they start</span>
        <PlayEditor frames={frames} onChange={setFrames} spotsOnly />
      </div>
      {msg && <Alert tone="red">{msg}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <button className={primaryBtn} disabled={busy}>
          {busy ? "Saving…" : formation ? "Save" : "Add formation"}
        </button>
        {formation && (
          <button type="button" onClick={onDone} className="text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
            Cancel
          </button>
        )}
        {formation?.id &&
          (sure ? (
            <>
              <button
                type="button"
                onClick={async () => {
                  const r = await removePlayFormation(org, teamId, formation.id!);
                  if (!r.ok) return setMsg(r.message);
                  router.refresh();
                }}
                className="text-sm font-medium text-red-600 hover:underline dark:text-red-400"
              >
                {builtIn ? `Yes, back to the usual ${formation.name}` : `Yes, delete ${formation.name}`}
              </button>
              <button type="button" onClick={() => setSure(false)} className="text-sm text-zinc-500 hover:underline">
                Keep it
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setSure(true)} className="text-sm font-medium text-red-600 hover:underline dark:text-red-400">
              {builtIn ? "Back to the usual spots" : "Delete formation"}
            </button>
          ))}
      </div>
      {formation?.id && !builtIn && <p className="text-xs text-zinc-500">Its plays stay, listed under its name.</p>}
    </form>
  );
}

function Library({ title, tone, plays, row }: { title: string; tone: string; plays: LibraryPlay[]; row: (p: LibraryPlay) => ReactNode }) {
  if (!plays.length) return null;
  return (
    <details className="group border-t border-zinc-100 dark:border-white/5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className={`text-sm font-semibold ${tone}`}>
          {title} <span className="font-normal text-zinc-500">({plays.length})</span>
        </span>
        <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="pb-2">
        <ByKind plays={plays} row={(p) => row(p as LibraryPlay)} />
      </div>
    </details>
  );
}

// A play's video links: a ▶ button each (none without links). YouTube, Vimeo and video files play in a pop-up; any other
// link opens in a new tab.
function Videos({ name, links }: { name: string; links: string[] }) {
  if (!links.length) return null;
  const btn = "inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium text-thunder-blue ring-1 ring-thunder-blue/40 hover:bg-blue-50 dark:hover:bg-blue-500/10";
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((url, n) => {
        const v = videoPlayer(url);
        const label = `▶ Video${links.length > 1 ? ` ${n + 1}` : ""}`;
        if (v.kind === "link")
          return (
            <a key={n} href={v.src} target="_blank" rel="noopener noreferrer" className={btn} title={v.label}>
              {label} <span className="text-xs font-normal text-zinc-500">({v.label} ↗)</span>
            </a>
          );
        return (
          <PopUp key={n} label={label} ariaLabel={`${name}: video ${n + 1}`} title={`${name}${links.length > 1 ? ` · Video ${n + 1}` : ""}`} className={btn}>
            {() => (
              <div className="space-y-2">
                <div className="aspect-video w-full overflow-hidden rounded-lg bg-black sm:w-[36rem]">
                  {v.kind === "file" ? (
                    <video src={v.src} controls autoPlay playsInline className="size-full" />
                  ) : (
                    <iframe
                      src={v.src}
                      title={`${name}: video ${n + 1}`}
                      className="size-full"
                      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  )}
                </div>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-thunder-blue hover:underline">
                  Open on {v.label} ↗
                </a>
              </div>
            )}
          </PopUp>
        );
      })}
    </div>
  );
}
