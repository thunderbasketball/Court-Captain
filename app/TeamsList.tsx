import { Suspense, type ReactNode } from "react";
import type { AudienceInput } from "@/lib/announcements";
import PageMenus, { MEGAPHONE_BTN, MegaphoneIcon, PLUS_BTN, PlusIcon } from "./PageMenus";
import ChatPanel from "./ChatPanel";
import { NotifyPanel } from "./NotifyButton";
import { TextTeamsPanel } from "./Contacts";
import TeamWarningsCard from "./warnings/TeamWarningsCard";
import TeamsIncluded from "./TeamsIncluded";
import { UndoImportButton } from "./TeamImport";
type Undo = Parameters<typeof UndoImportButton>[0]["undo"];
import { TeamsByLevel } from "./TeamRow";
import { CollapseCard, PageTitle } from "./ui";

// Import teams: the example and help, the same for every organization.
export const IMPORT_EXAMPLE =
  "Gender,Grade,Level,Coach First,Coach Last,Coach Cell,Alternate Name\nBoys,3rd/4th,REC,Sam,Lee,423-555-0101,Bolts\nGirls,5th,COMP,,,,";
export const IMPORT_HELP =
  "One team per row with its Gender, Grade and Level (REC or COMP), and if you have them the Head Coach's name, cell and email and an Alternate name, in any order. Each team is named from its Head Coach (like 4G Epps; 4G TBD until a coach is added; the same name twice gets numbers: 4G Epps 1 and 2). A coach without a cell is fine: add it later on the team. Paste from a spreadsheet or choose a CSV file. Next you'll check which column is which, then see exactly what will be added (we clean up things like 3 & 4 or R).";

export type ImportRow = { id: string; names: string[]; importedAt: Date; teams: number; left: number; importedBy: string };

// Every organization's Teams list (SPEC.md section 14), one layout for all (Thunder and every other organization): its
// title and mix, 📣 (Text coaches, Chat and Alert where they're on) and + (Add a team, Import teams) on the title line,
// the Warnings card, the teams by level, gender and grade (each team's row, flashing up the cards when it needs
// something), the Register card, then Recent imports with Undo. Each address passes its own teams and tools in.
export default function TeamsList<T extends { level: string; gender: string }>(p: {
  slot?: string; // inside Home's Teams card: the 📣 and + sit on its title line
  count: number;
  subtitle: string;
  coaches?: {
    text: { id: string; name: string; gender: string; level: string; grade: number; headCells: string[] }[];
    chatKey?: string | null; // Chat with coaches
    alert?: AudienceInput | null; // Alert coaches
  } | null;
  add?: { add: ReactNode; import: ReactNode } | null; // + Add a team, Import teams
  warnings?: { org: string; base: string } | null;
  empty?: string | null;
  teams: T[];
  view: unknown;
  grade: (t: T) => string;
  warn: (t: T) => boolean;
  gradeAction?: (teams: T[]) => ReactNode;
  register?: { count: number; body: ReactNode } | null;
  row: (t: T) => ReactNode;
  imports?: { list: ImportRow[]; who: boolean; undo: (id: string) => Undo; note: string } | null;
}) {
  const when = (d: Date) =>
    d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <>
      <PageMenus
        slot={p.slot}
        title={<PageTitle title={`Teams (${p.count})`} subtitle={p.subtitle} />}
        menus={[
          ...(p.coaches
            ? [
                {
                  key: "coaches",
                  icon: <MegaphoneIcon />,
                  label: `Coaches: text${p.coaches.chatKey ? ", chat" : ""}${p.coaches.alert ? " or alert" : ""}`,
                  className: MEGAPHONE_BTN,
                  items: [
                    { key: "text", label: "💬 Text coaches", panel: <TextTeamsPanel teams={p.coaches.text} /> },
                    ...(p.coaches.chatKey ? [{ key: "chat", label: "🗨️ Chat with coaches", panel: <ChatPanel chatKey={p.coaches.chatKey} /> }] : []),
                    ...(p.coaches.alert
                      ? [{ key: "alert", label: "🔔 Alert coaches", panel: <NotifyPanel audience={p.coaches.alert} to="all coaches" /> }]
                      : []),
                  ],
                },
              ]
            : []),
          ...(p.add
            ? [
                {
                  key: "add",
                  icon: <PlusIcon />,
                  label: "Add or import teams",
                  className: PLUS_BTN,
                  items: [
                    { key: "add", label: "＋ Add a team", panel: p.add.add },
                    { key: "import", label: "⇪ Import teams", panel: p.add.import },
                  ],
                },
              ]
            : []),
        ]}
      />
      {/* Warnings: the ones this organization turned on (its gear), streamed so the teams show first. */}
      {p.warnings && p.teams.length > 0 && (
        <div className="mb-3">
          <Suspense fallback={null}>
            <TeamWarningsCard org={p.warnings.org} base={p.warnings.base} />
          </Suspense>
        </div>
      )}
      {!p.teams.length && p.empty && <p className="text-sm text-zinc-500">{p.empty}</p>}
      {(p.teams.length > 0 || p.register) && (
        <TeamsByLevel teams={p.teams} view={p.view} register={p.register} grade={p.grade} warn={p.warn} gradeAction={p.gradeAction} row={p.row} />
      )}
      {p.imports && p.imports.list.length > 0 && (
        <div className="mt-4">
          <CollapseCard title="Recent imports" count={p.imports.list.length}>
            <ul className="divide-y divide-zinc-100 px-4 pb-2 dark:divide-white/5">
              {p.imports.list.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <TeamsIncluded
                    names={i.names}
                    summary={
                      <>
                        {when(i.importedAt)} · {i.teams} team{i.teams === 1 ? "" : "s"}
                        {p.imports!.who && ` · by ${i.importedBy}`}
                        {i.left < i.teams && ` · ${i.left} still here`}
                      </>
                    }
                  />
                  {i.left > 0 && <UndoImportButton undo={p.imports!.undo(i.id)} teams={i.left} when={when(i.importedAt)} note={p.imports!.note} />}
                </li>
              ))}
            </ul>
          </CollapseCard>
        </div>
      )}
    </>
  );
}
