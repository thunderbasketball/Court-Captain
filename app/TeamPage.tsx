import { inName } from "@/lib/team-names";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatCell } from "@/lib/phone";
import { MustBeEntered } from "./TeamRow";
import { ViewAsButton } from "./ViewAsButton";
import { CardPanel, ChatIcon, EmailPanelIcon, PanelIcon, TextIcon } from "./CardIcons";
import { EmailButtons } from "./Contacts";
import ChatPanel from "./ChatPanel";
import { Chip, CollapseCard, EmailLink, JerseyNumber, PersonRow, PhoneLink, card } from "./ui";
import RosterPlayerRow from "./org/thunder/teams/RosterPlayerRow";

const roleTone = { HeadCoach: "green", AsstCoach: "amber", Manager: "blue", TeamParent: "zinc" } as const;
const roleNames: Record<string, string> = { HeadCoach: "Head Coach", AsstCoach: "Assistant Coach", Manager: "Manager", TeamParent: "Team Parent" };

export type TeamStaffRow = { coachId: string; first: string; last: string; role: string; cell: string | null; email: string | null; addedBy: string | null };
export type TeamRosterRow = {
  key: string;
  number?: string | null; // uniform number, in a black box
  first: string;
  last: string;
  chips?: ReactNode; // after the name (e.g. not eligible)
  right?: ReactNode; // grade, age…
  more: ReactNode; // opened by a tap: parents, who added them, Remove
};

// Every organization's team page (SPEC.md section 14), one layout for all: the team's card, Next 7 days, then cards
// that open when tapped, in one order: Staff · Roster · Games · its League programs · Uniforms · Practices · Playbook. Each card
// shows only when the organization has that feature and the person has the role for it; the buttons on their title
// lines are the same everywhere (💬 Text, 🗨️ Chat, ✉️ Email, add). Each address reads its team's data and passes it in.
export default function TeamPage(p: {
  embedded?: boolean; // inside its row on the Teams list: no page frame
  back: string | null; // ← Teams (for those who manage the teams)
  team: {
    id: string;
    name: string;
    altName: string | null;
    gender: string;
    grades: string; // "4th–5th Grade"
    level: string;
    practiceLocations: string[];
    createdBy: string | null; // shown to Owners and Admins
  };
  musts: Parameters<typeof MustBeEntered>[0]["what"][]; // MUST BE ENTERED: COACH INFO, COACH CELL, COACH EMAIL, ROSTER
  edit?: ReactNode; // the team card's tools (Edit, Alternate name)
  next7: ReactNode;
  opened: string; // ?tab=staff|roster|games|programs|uniforms|practices opens that card
  staff: {
    list: TeamStaffRow[];
    waiting: { first: string; last: string; tool?: ReactNode } | null; // a Head Coach named without a cell yet
    chatKey: string | null; // the team's staff chat
    add?: ReactNode; // the Add staff icon (title line)
    addPanel?: ReactNode; // its form, opened at the top of the card
    remove: (s: TeamStaffRow) => ReactNode;
    headEmail: (s: TeamStaffRow) => ReactNode; // a Head Coach without an email: add it
    edit?: (s: TeamStaffRow) => ReactNode; // Owners and Admins: a staff member's name, cell and email
    viewAs: boolean; // Owners and Admins: 👁 and the person's dashboard
    me: string;
  };
  roster: {
    rows: TeamRosterRow[];
    alert: boolean;
    badge?: ReactNode;
    cells: string[]; // 💬 Text parents (or players)
    emails: string[];
    chatKey: string | null; // the parents' chat
    add?: ReactNode;
    note?: ReactNode;
    empty: string;
    after?: ReactNode; // Available players
  };
  games: ReactNode; // the Games card's inside
  gamesCount: number;
  programs?: { title: string; count: number; body: ReactNode } | null; // its League programs
  uniforms?: { count: number; alert: boolean; body: ReactNode } | null;
  practices?: { count: number; action?: ReactNode; body: ReactNode } | null;
  playbook?: { count: number; action?: ReactNode; body: ReactNode } | null; // CourtPlaybook: its coaches' plays
  footer?: ReactNode; // Delete team
}) {
  const t = p.team;
  const hasHead = p.staff.list.some((s) => s.role === "HeadCoach");
  const staffEmails = [...new Set(p.staff.list.flatMap((s) => (s.email ? [s.email.toLowerCase()] : [])))];
  return (
    <main className={p.embedded ? "space-y-4 rounded-2xl bg-zinc-50 p-3 dark:bg-white/5" : "mx-auto w-full max-w-xl flex-1 space-y-4 px-4 py-6"}>
      {p.back && (
        <Link href={p.back} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Teams
        </Link>
      )}
      <section className={`${card} p-5`}>
        <div className="flex items-start gap-3">
          <span
            className={`flex size-12 shrink-0 items-center justify-center rounded-xl text-base font-bold text-white ${
              t.gender === "Boys" ? "bg-thunder-blue" : t.gender === "Coed" ? "bg-emerald-600" : "bg-pink-600"
            }`}
          >
            {t.name.split(" ")[0]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {t.name}
                {t.altName && !inName(t.name, t.altName) && <span className="font-normal text-zinc-500"> · {t.altName}</span>}
              </h1>
              <Chip tone={t.level === "COMP" ? "orange" : "zinc"}>{t.level}</Chip>
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t.gender} · {t.grades}
            </p>
            {t.practiceLocations.length > 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">Practices: {t.practiceLocations.join(", ")}</p>}
            {t.createdBy && <p className="mt-1 text-xs text-zinc-400">Created by {t.createdBy}</p>}
            {p.musts.map((m) => (
              <MustBeEntered key={m} what={m} />
            ))}
          </div>
        </div>
        {p.edit}
      </section>

      {p.next7}

      <CollapseCard
        title="Staff"
        count={p.staff.list.length}
        open={p.opened === "staff"}
        alert={!hasHead}
        actionPad="pr-56"
        action={
          <span className="flex items-center gap-1.5">
            <TextIcon cells={p.staff.list.flatMap((s) => (s.cell ? [s.cell] : []))} label="Text staff" />
            {p.staff.chatKey && (
              <PanelIcon id={`chat-team-${t.id}`} label={`${t.name} team chat`}>
                <ChatIcon />
              </PanelIcon>
            )}
            <EmailPanelIcon id={`email-staff-${t.id}`} emails={staffEmails} label="Email staff" />
            {p.staff.add}
          </span>
        }
      >
        {p.staff.addPanel}
        {/* ✉️ Email staff: the email app, or 📋 Copy emails to paste into web mail. */}
        <CardPanel id={`email-staff-${t.id}`}>
          <div className="pt-3">
            <EmailButtons emails={staffEmails} label="Email staff" pickHint="" />
          </div>
        </CardPanel>
        {p.staff.chatKey && (
          <CardPanel id={`chat-team-${t.id}`}>
            <ChatPanel chatKey={p.staff.chatKey} />
          </CardPanel>
        )}
        {!p.staff.list.length && !p.staff.waiting && <p className="px-4 pb-4 text-sm text-zinc-500">No staff yet.</p>}
        {p.staff.waiting && (
          <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3 dark:border-white/5">
            <span className="min-w-0 text-sm">
              <span className="block font-medium">
                {p.staff.waiting.first} {p.staff.waiting.last}
              </span>
              <span className="block text-xs text-zinc-500">Head Coach · no cell or email yet</span>
            </span>
            {p.staff.waiting.tool}
          </div>
        )}
        <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
          {p.staff.list.map((s) => (
            <PersonRow
              key={`${s.coachId}-${s.role}`}
              first={s.first}
              last={s.last}
              avatarTone={roleTone[s.role as keyof typeof roleTone] ?? "zinc"}
              href={p.staff.viewAs ? (s.coachId === p.staff.me ? "/me" : `/me/${s.coachId}`) : undefined}
              collapsed
              chips={
                <>
                  <Chip tone={roleTone[s.role as keyof typeof roleTone] ?? "zinc"}>{roleNames[s.role] ?? s.role}</Chip>
                  {p.staff.viewAs && s.coachId !== p.staff.me && <ViewAsButton coachId={s.coachId} name={`${s.first} ${s.last}`} />}
                </>
              }
            >
              {s.cell && (
                <p>
                  <PhoneLink cell={s.cell} label={formatCell(s.cell)} />
                </p>
              )}
              {s.email ? (
                <p className="truncate">
                  <EmailLink email={s.email} />
                </p>
              ) : (
                s.role === "HeadCoach" && (
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">No email yet</p>
                    {p.staff.headEmail(s)}
                  </div>
                )
              )}
              {p.staff.edit?.(s)}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs">{s.addedBy && `Added by ${s.addedBy}`}</p>
                {p.staff.remove(s)}
              </div>
            </PersonRow>
          ))}
        </ul>
      </CollapseCard>

      <CollapseCard
        title="Roster"
        count={p.roster.rows.length}
        open={p.opened === "roster"}
        alert={p.roster.alert}
        badge={p.roster.badge}
        actionPad="pr-56"
        action={
          <span className="flex items-center gap-1.5">
            <TextIcon cells={p.roster.cells} label="Text parents" />
            {p.roster.chatKey && (
              <PanelIcon id={`chat-parents-${t.id}`} label={`${t.name} parents chat`}>
                <ChatIcon />
              </PanelIcon>
            )}
            <EmailPanelIcon id={`email-parents-${t.id}`} emails={p.roster.emails} label="Email parents" />
            {p.roster.add}
          </span>
        }
      >
        <CardPanel id={`email-parents-${t.id}`}>
          <div className="pt-3">
            <EmailButtons emails={[...new Set(p.roster.emails.map((e) => e.toLowerCase()))]} label="Email parents" pickHint="" />
          </div>
        </CardPanel>
        {p.roster.chatKey && (
          <CardPanel id={`chat-parents-${t.id}`}>
            <ChatPanel chatKey={p.roster.chatKey} />
          </CardPanel>
        )}
        {p.roster.note}
        {!p.roster.rows.length && <p className="px-4 pb-4 text-sm text-zinc-500">{p.roster.empty}</p>}
        <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
          {p.roster.rows.map((r) => (
            <RosterPlayerRow
              key={r.key}
              className="px-4 py-2.5"
              line={
                <>
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    <span className="truncate font-medium">
                      <JerseyNumber n={r.number} />
                      {r.first} <span className="font-semibold">{r.last}</span>
                    </span>
                    {r.chips}
                  </span>
                  <span className="shrink-0 text-right text-xs text-zinc-400">{r.right}</span>
                </>
              }
              more={r.more}
            />
          ))}
        </ul>
        {p.roster.after}
      </CollapseCard>

      <CollapseCard title="Games" count={p.gamesCount} open={p.opened === "games"}>
        <div className="px-4 pb-4">{p.games}</div>
      </CollapseCard>

      {p.programs && (
        <CollapseCard title={p.programs.title} count={p.programs.count} open={p.opened === "programs"}>
          {p.programs.body}
        </CollapseCard>
      )}

      {p.uniforms && (
        <CollapseCard title="Uniforms" count={p.uniforms.count} open={p.opened === "uniforms"} alert={p.uniforms.alert}>
          {p.uniforms.body}
        </CollapseCard>
      )}

      {p.practices && (
        <CollapseCard title="Practices" count={p.practices.count} open={p.opened === "practices"} action={p.practices.action}>
          {p.practices.body}
        </CollapseCard>
      )}

      {p.playbook && (
        <CollapseCard title="Playbook" count={p.playbook.count} open={p.opened === "playbook"} action={p.playbook.action}>
          {p.playbook.body}
        </CollapseCard>
      )}
      {p.footer}
    </main>
  );
}
