import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import {
  addClubTeam,
  clubAbbr,
  importClubTeams,
  listClubImports,
  outsideClubs,
  previewClubImport,
  undoClubImport,
} from "./scenic-club-teams";
import { listScenicTeams, setScenicCoachEmail, updateScenicTeam } from "./scenic-teams";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const dee = person("9913694", "Dee"); // Scenic City Director of Teams
const fay = person("5550004", "Fay"); // Scenic City Director of Facilities only

describe("Scenic City: outside clubs' teams", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") });
  let baylor = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Dee', 'X', '4239913694'), ('5550004', 'Fay', 'X', '4235550004'), ('5550005', 'Lee', 'Harris', '4235550005')`,
    );
    await grant(db.pool, "9913694 scenic-city Director", "5550004 scenic-city Director", "5550005 scenic-city Coach");
    await db.pool.query(
      `insert into director_areas (coach_id, org, area, granted_by) values
         ('9913694', 'scenic-city', 'teams', 'test'), ('5550004', 'scenic-city', 'facilities', 'test')`,
    );
    const p = await db.pool.query<{ id: string }>(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values
         ('Baylor School', 'School', false, true, true, 'test') returning id::text`,
    );
    baylor = p.rows[0].id;
    await db.pool.query(
      "insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('Thunder Basketball', 'Organization', true, true, true, 'test', 'thunder')",
    );
  });

  it("+ Add: a Director of Teams adds a club's team, named with the club's Abbreviation; others can't", async () => {
    expect(clubAbbr("Hixson Hoops & Co")).toBe("HHC");
    expect((await outsideClubs(db.pool)).map((c) => [c.name, c.abbr])).toEqual([["Baylor School", "BS"]]);
    const input = { club: baylor, gender: "Boys", grades: ["5"], level: "REC", headCoach: "user:5550005", altName: "Bolts" };
    expect(await addClubTeam(deps(), fay, input)).toMatchObject({ ok: false });
    expect(await addClubTeam(deps(), dee, input)).toMatchObject({ ok: true, name: "BS 5B Harris" });
    // The same name again: both numbered.
    expect(await addClubTeam(deps(), dee, { ...input, level: "COMP", altName: "" })).toMatchObject({
      ok: true,
      name: "BS 5B Harris 2",
    });

    // A new club (with its Abbreviation), no coach yet: TBD, numbered.
    const hh = {
      club: { name: "Hixson Hoops", abbr: "hh" },
      gender: "Girls",
      grades: ["3", "4"],
      level: "COMP",
      headCoach: "none",
    };
    expect(await addClubTeam(deps(), dee, hh)).toMatchObject({ ok: true, name: "HH 4G TBD" });
    expect(await addClubTeam(deps(), dee, hh)).toMatchObject({ ok: true, name: "HH 4G TBD 2" }); // the 1st is "HH 4G TBD 1"
    // An organization on CourtCaptain adds its own teams.
    expect(await addClubTeam(deps(), dee, { ...hh, club: { name: "thunder basketball" } })).toMatchObject({
      ok: false,
      message: "Thunder Basketball is on CourtCaptain: they add and register their own teams.",
    });

    const list = (await listScenicTeams(deps(), dee, "Director"))!.teams;
    expect(list.map((t) => [t.name, t.partnerName, t.altName, t.divisionLow])).toEqual([
      ["BS 5B Harris 2", "Baylor School", null, null], // COMP first
      ["BS 5B Harris 1", "Baylor School", "Bolts", null],
      ["HH 4G TBD 1", "Hixson Hoops", null, null],
      ["HH 4G TBD 2", "Hixson Hoops", null, null],
    ]);
  });

  it("Import: a coach with no cell waits on the team (named for them); Edit adds the cell; then their email", async () => {
    const text =
      "Organization,Gender,Grade,Level,Coach First,Coach Last\nTemp,Boys,5,COMP,Alex,Campbell\nTemp,Boys,5,REC,Alex,Campbell";
    const pre = await previewClubImport(deps(), dee, text);
    expect(pre).toMatchObject({ ok: true });
    expect((pre as { rows: { name: string; status: string }[] }).rows.map((r) => `${r.name}:${r.status}`)).toEqual([
      "T 5B Campbell 1 · Temp (new club):new",
      "T 5B Campbell 2 · Temp (new club):new",
    ]);
    expect(await importClubTeams(deps(), dee, text)).toMatchObject({
      added: ["T 5B Campbell 1 · Temp", "T 5B Campbell 2 · Temp"],
    });
    const teams = async () => (await listScenicTeams(deps(), dee, "Director"))!.teams.filter((t) => t.partnerName === "Temp");
    const [t] = await teams();
    expect(t).toMatchObject({ coachId: null, coachFirst: "Alex", coachLast: "Campbell", coachCell: null, waitingCoach: true });
    const edit = {
      name: t.name,
      gender: "Boys",
      level: t.level,
      grade: "5",
      coachFirst: "Alex",
      coachLast: "Campbell",
      coachCell: "4235550123",
    };
    expect(await updateScenicTeam(deps(), dee, t.id, edit as Parameters<typeof updateScenicTeam>[3])).toMatchObject({
      ok: true,
      newLogin: true,
    });
    expect((await teams()).find((x) => x.id === t.id)).toMatchObject({
      coachCell: "4235550123",
      coachEmail: null,
      waitingCoach: false,
    });
    expect(await setScenicCoachEmail(deps(), fay, t.id, "alex@example.com")).toMatchObject({ ok: false });
    expect(await setScenicCoachEmail(deps(), dee, t.id, "alex@example.com")).toEqual({ ok: true });
    expect((await teams()).find((x) => x.id === t.id)).toMatchObject({ coachEmail: "alex@example.com" });
  });

  it("Import: preview, add (new clubs made), skip what's there or wrong, and undo", async () => {
    const text = [
      "Organization,Gender,Grade,Level,Coach First,Coach Last,Coach Cell,Alternate Name",
      "Hixson Hoops,Boys,5th,REC,Sam,Lee,423-555-0101,Bolts",
      "Baylor School,Girls,3rd/4th,COMP,,,,Stars",
      "Thunder Basketball,Boys,5,REC,,,,",
      "=cmd,Boys,5,REC,,,,",
    ].join("\n");
    expect(await previewClubImport(deps(), fay, text)).toMatchObject({ ok: false });
    const p = await previewClubImport(deps(), dee, text);
    if (!p.ok) throw new Error(p.message);
    expect(p.rows.map((r) => [r.name, r.status])).toEqual([
      ["HH 5B Lee · Hixson Hoops (new club)", "new"],
      ["BS 4G TBD · Baylor School", "new"],
      ["TB 5B TBD · Thunder Basketball", "error"],
      ["=cmd", "error"],
    ]);

    const r = await importClubTeams(deps(), dee, text);
    expect(r).toMatchObject({ ok: true, added: ["HH 5B Lee · Hixson Hoops", "BS 4G TBD · Baylor School"] });
    if (!r.ok) return;
    expect(r.skipped).toHaveLength(2);
    // Again: both already there.
    const again = await previewClubImport(deps(), dee, text);
    expect(again.ok && again.rows.slice(0, 2).map((x) => x.status)).toEqual(["exists", "exists"]);

    const [imp] = (await listClubImports(deps(), dee))!;
    expect(imp).toMatchObject({ teams: 2, left: 2, importedBy: "Dee X" });
    expect(await undoClubImport(deps(), fay, imp.id)).toMatchObject({ ok: false });
    expect(await undoClubImport(deps(), dee, imp.id)).toEqual({ ok: true, removed: ["HH 5B Lee", "BS 4G TBD"], kept: [] });
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams).toEqual([]);
    expect(await listClubImports(deps(), dee)).toEqual([]); // undone: no longer listed
  });
});
