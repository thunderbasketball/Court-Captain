import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { userContexts } from "./contexts";
import { getSessionUser } from "./auth/service";
import { sha256 } from "./auth/crypto";
import { addGym } from "./practice/admin";
import { addPlayers } from "./rosters";
import {
  directorAreas,
  directorsPanel,
  hasArea,
  isOrgAdmin,
  orgAreas,
  setAdmin,
  setDirectorAreas,
  setOwner,
  addPersonFor,
} from "./org-admin";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string, isDirector = false): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector,
  isCoach: false,
  requestPending: false,
  hasThunderRole: isDirector,
});
const ada = person("5550001", "Ada", true); // Thunder Admin
const bo = person("5550002", "Bo", true); // Thunder Director (not Admin)
const cy = person("5550003", "Cy");

describe("Admins and Director areas", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-10-31T12:00:00Z") });
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550001', 'Ada', 'X', '4235550001'), ('5550002', 'Bo', 'X', '4235550002'), ('5550003', 'Cy', 'X', '4235550003')`,
    );
    await grant(
      db.pool,
      "5550001 thunder Admin",
      "5550001 thunder Director",
      "5550002 thunder Director",
      "5550003 thunder Request",
    );
  });

  it("offers only the areas whose features the organization has", async () => {
    expect((await orgAreas(db.pool, "thunder")).map((a) => a.key)).toEqual([
      "teams",
      "players",
      "uniforms",
      "facilities",
      "practices",
      "events",
      "support",
    ]);
    expect((await orgAreas(db.pool, "scenic-city")).map((a) => a.key)).toEqual([
      "teams",
      "facilities",
      "programs",
      "scheduling",
      "officials",
      "support",
    ]);
  });

  it("Admins have every area; Directors only theirs", async () => {
    expect(await isOrgAdmin(db.pool, ada.coachId, "thunder")).toBe(true);
    expect(await isOrgAdmin(db.pool, ada.coachId, "scenic-city")).toBe(false);
    expect(await directorAreas(db.pool, ada.coachId, "thunder")).toEqual([
      "teams",
      "players",
      "uniforms",
      "facilities",
      "practices",
      "events",
      "support",
    ]);
    expect(await directorAreas(db.pool, bo.coachId, "thunder")).toEqual([]);
    expect(await setDirectorAreas(deps(), ada, "thunder", bo.coachId, ["events", "players", "players"])).toEqual({ ok: true });
    expect(await directorAreas(db.pool, bo.coachId, "thunder")).toEqual(["players", "events"]);
  });

  it("an Admin adds a Director with areas (clears their Request), changes them, and removes them", async () => {
    expect(await setDirectorAreas(deps(), ada, "thunder", cy.coachId, ["facilities"])).toEqual({ ok: true });
    const roles = async () =>
      (
        await db.pool.query<{ role: string }>(
          "select role from org_roles where coach_id = '5550003' and org = 'thunder' order by role",
        )
      ).rows.map((r) => r.role);
    expect(await roles()).toEqual(["Director"]);
    const who = await db.pool.query("select granted_by from director_areas where coach_id = '5550003'");
    expect(who.rows).toEqual([{ granted_by: "Ada X" }]);

    const panel = await directorsPanel(deps(), ada, "thunder");
    expect(panel!.directors.map((d) => `${d.name}:${d.admin}:${d.areas.join("+")}`)).toEqual([
      "Ada X:true:",
      "Bo X:false:",
      "Cy X:false:facilities",
    ]);
    expect(panel!.options).toEqual([]);

    expect(await setDirectorAreas(deps(), ada, "thunder", cy.coachId, [])).toEqual({ ok: true });
    expect(await roles()).toEqual([]);
    expect(await directorAreas(db.pool, cy.coachId, "thunder")).toEqual([]);
  });

  it("only that organization's Admins can, and not on Admins or areas it doesn't offer", async () => {
    expect(await directorsPanel(deps(), bo, "thunder")).toBeNull();
    expect(await setDirectorAreas(deps(), bo, "thunder", cy.coachId, ["players"])).toEqual({
      ok: false,
      message: "Only a Thunder Admin can do that.",
    });
    expect(await setDirectorAreas(deps(), ada, "scenic-city", cy.coachId, ["teams"])).toMatchObject({ ok: false });
    expect(await setDirectorAreas(deps(), ada, "thunder", ada.coachId, [])).toEqual({
      ok: false,
      message: "Admins have every area.",
    });
    expect(await setDirectorAreas(deps(), ada, "thunder", cy.coachId, ["officials"])).toEqual({
      ok: false,
      message: "Thunder doesn't have that area.",
    });
    expect(await setDirectorAreas(deps(), ada, "thunder", cy.coachId, ["rockets"])).toMatchObject({ ok: false });
    expect(await setDirectorAreas(deps(), ada, "thunder", "nobody", ["players"])).toMatchObject({ ok: false });
  });

  it("an Admin's Director chip says Admin", async () => {
    expect((await userContexts(db.pool, ada)).find((c) => c.key === "director")?.label).toBe("Admin");
    expect((await userContexts(db.pool, bo)).find((c) => c.key === "director")?.label).toBe("Director");
  });

  it("the session carries Thunder areas, read fresh each request, and they limit what a Director can do", async () => {
    const now = new Date("2026-10-31T12:00:00Z");
    for (const [token, id] of [
      ["t-ada", "5550001"],
      ["t-bo", "5550002"],
    ])
      await db.pool.query(
        "insert into sessions (token_hash, coach_id, created_at, expires_at) values ($1, $2, $3, $3::timestamptz + interval '1 day')",
        [sha256(token), id, now],
      );
    const session = async (token: string) => (await getSessionUser({ ...deps(), sendEmail: async () => {} }, token))!;
    expect((await session("t-ada")).thunderAreas).toEqual([
      "teams",
      "players",
      "uniforms",
      "facilities",
      "practices",
      "events",
      "programs",
      "scheduling",
      "officials",
      "support",
    ]);
    expect((await session("t-bo")).thunderAreas).toEqual([]);

    await setDirectorAreas(deps(), ada, "thunder", bo.coachId, ["facilities"]);
    const boNow = await session("t-bo");
    expect(boNow.thunderAreas).toEqual(["facilities"]);
    expect(hasArea(boNow, "facilities")).toBe(true);
    expect(hasArea(boNow, "teams", "players")).toBe(false);
    expect(hasArea({ ...boNow, isDirector: false }, "facilities")).toBe(false);

    // Facilities: can add a gym; can't change rosters.
    expect(await addGym(deps(), boNow, { name: "North Gym", courts: ["A", "B"] })).toMatchObject({ ok: true });
    expect(await addPlayers(deps(), boNow, "1", ["r1"])).toEqual({
      ok: false,
      message: "Only a Director of Teams can change rosters.",
    });
    expect(await addGym(deps(), await session("t-ada"), { name: "South Gym", courts: ["A"] })).toMatchObject({ ok: true });
  });

  it("Owners add and remove Admins; Admins can't, and an Owner's Admin stays", async () => {
    await grant(db.pool, "5550001 thunder Owner");
    expect(await setAdmin(deps(), bo, "thunder", cy.coachId, true)).toEqual({
      ok: false,
      message: "Only a Thunder Owner can do that.",
    });
    await grant(db.pool, "5550002 thunder Admin");
    expect(await setAdmin(deps(), bo, "thunder", cy.coachId, true)).toMatchObject({ ok: false }); // an Admin isn't enough

    expect(await setAdmin(deps(), ada, "thunder", cy.coachId, true)).toEqual({ ok: true });
    const roles = async () =>
      (
        await db.pool.query<{ role: string }>(
          "select role from org_roles where coach_id = '5550003' and org = 'thunder' order by role",
        )
      ).rows.map((r) => r.role);
    expect(await roles()).toEqual(["Admin", "Director"]); // Request cleared
    expect((await directorsPanel(deps(), ada, "thunder"))!.canManageAdmins).toBe(true);
    expect((await directorsPanel(deps(), bo, "thunder"))!.canManageAdmins).toBe(false);

    expect(await setAdmin(deps(), ada, "thunder", cy.coachId, false)).toEqual({ ok: true });
    expect(await roles()).toEqual(["Director"]);
    expect(await setAdmin(deps(), ada, "thunder", ada.coachId, false)).toEqual({
      ok: false,
      message: "Owners are always Admins.",
    });
    expect((await userContexts(db.pool, ada)).find((c) => c.key === "director")?.label).toBe("Owner");
  });

  it("Owners add other Owners (also Admin and Director) and remove them; at least one Owner stays", async () => {
    await grant(db.pool, "5550001 thunder Owner", "5550002 thunder Admin");
    expect(await setOwner(deps(), bo, "thunder", cy.coachId, true)).toEqual({
      ok: false,
      message: "Only a Thunder Owner can do that.",
    });
    expect((await directorsPanel(deps(), ada, "thunder"))!.ownerOptions.map((o) => o.name)).toEqual(["Bo X", "Cy X"]);
    expect(await setOwner(deps(), ada, "thunder", cy.coachId, true)).toEqual({ ok: true });
    const roles = async (id: string) =>
      (
        await db.pool.query<{ role: string }>(
          "select role from org_roles where coach_id = $1 and org = 'thunder' order by role",
          [id],
        )
      ).rows.map((r) => r.role);
    expect(await roles("5550003")).toEqual(["Admin", "Director", "Owner"]); // Request cleared
    // The new Owner can remove the first; the last one can't go.
    expect(await setOwner(deps(), cy, "thunder", ada.coachId, false)).toEqual({ ok: true });
    expect(await roles("5550001")).toEqual(["Admin", "Director"]);
    expect(await setOwner(deps(), cy, "thunder", cy.coachId, false)).toEqual({
      ok: false,
      message: "Thunder needs at least one Owner.",
    });
  });

  it("Admins add a new person (found by cell, or a login made) to give a role", async () => {
    expect(await addPersonFor(deps(), bo, "thunder", { first: "Nia", last: "New", cell: "4235550055" })).toMatchObject({
      ok: false,
    });
    expect(await addPersonFor(deps(), ada, "thunder", { first: "Nia", last: "", cell: "4235550055" })).toMatchObject({
      ok: false,
    });
    expect(await addPersonFor(deps(), ada, "thunder", { first: "Nia", last: "New", cell: "(423) 555-0055" })).toEqual({
      ok: true,
      coachId: "5550055",
      name: "Nia New",
      newLogin: true,
    });
    expect(await addPersonFor(deps(), ada, "thunder", { first: "Nia", last: "New", cell: "4235550055" })).toMatchObject({
      newLogin: false,
    });
    expect(await setDirectorAreas(deps(), ada, "thunder", "5550055", ["teams"])).toEqual({ ok: true });
  });
});
