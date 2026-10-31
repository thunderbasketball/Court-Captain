import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import {
  addCourt,
  cleanPlaceName,
  deleteCourt,
  deleteGym,
  getPartner,
  listGameDays,
  listPartners,
  openCourtsByDay,
  partnerHours,
  saveGameDays,
  saveGym,
  setContact,
  contactOptions,
  savePartner,
  setHours,
} from "./scenic-partners";
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
const dee = person("9913694", "Dee"); // Scenic City Director
const pat = person("5550001", "Pat"); // Partner, contact for Baylor
const sam = person("5550002", "Sam"); // Solo

describe("Scenic City partners, gyms, courts and game days", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => db.drop());
  const now = new Date("2026-11-02T15:00:00Z"); // Mon Nov 2, Eastern
  const deps = () => ({ pool: db.pool, now: () => now });
  let baylor = "";
  let other = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Dee', 'X', '4239913694'), ('5550001', 'Pat', 'X', '4235550001'), ('5550002', 'Sam', 'X', '4235550002')`,
    );
    await grant(db.pool, "9913694 scenic-city Director", "5550001 scenic-city Partner", "5550002 scenic-city Solo");
    // Dee is a Director of Facilities (not an Admin): game days, partners, gyms and courts.
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'facilities', 'test')");
    const p = await db.pool.query<{ id: string }>(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values
         ('Baylor School', 'School', true, false, true, 'x'), ('Other Club', 'Organization', false, true, false, 'x') returning id::text`,
    );
    [baylor, other] = p.rows.map((r) => r.id);
    await db.pool.query("insert into partner_contacts (partner_id, coach_id, added_by) values ($1, '5550001', 'x')", [baylor]);
  });

  it("gym and court names: letters, numbers, simple punctuation; never a formula", () => {
    expect(cleanPlaceName("  Main   Gym #2 ")).toBe("Main Gym #2");
    expect(cleanPlaceName("=1+1")).toBeNull();
    expect(cleanPlaceName("")).toBeNull();
  });

  it("Directors see every partner; a contact sees only theirs; others see none", async () => {
    expect((await listPartners(deps(), dee)).partners.map((p) => p.name)).toEqual(["Baylor School", "Other Club"]);
    expect((await listPartners(deps(), pat)).partners.map((p) => p.name)).toEqual(["Baylor School"]);
    expect((await listPartners(deps(), sam)).partners).toEqual([]);
    expect(await getPartner(deps(), pat, other)).toBeNull();
    expect(await getPartner(deps(), sam, baylor)).toBeNull();
    expect(await getPartner(deps(), pat, baylor)).toMatchObject({
      name: "Baylor School",
      contacts: [{ id: "5550001", name: "Pat X" }],
      canEditPartner: false,
      canEditGyms: true,
      canEnterHours: true,
    });
  });

  it("Partner view: a Director shown as a partner sees only the partners they're a contact for", async () => {
    await grant(db.pool, "9913694 scenic-city Partner");
    expect((await listPartners(deps(), dee, false)).partners).toEqual([]);
    expect(await getPartner(deps(), dee, baylor, false)).toBeNull();
    expect(await getPartner(deps(), dee, baylor)).toMatchObject({ canEditPartner: true, canEditGyms: true, canEnterHours: false });
  });

  it("Directors add and remove contacts; adding gives the Partner role", async () => {
    expect((await contactOptions(deps(), dee, baylor)).map((o) => o.name)).toEqual(["Dee X", "Sam X"]);
    expect(await contactOptions(deps(), pat, baylor)).toEqual([]);
    expect(await setContact(deps(), pat, baylor, "5550002", true)).toMatchObject({ ok: false });
    expect(await setContact(deps(), dee, baylor, "5550002", true)).toEqual({ ok: true });
    expect((await db.pool.query("select has_role('5550002', 'scenic-city', 'Partner') as p")).rows[0].p).toBe(true);
    expect((await getPartner(deps(), sam, baylor))?.contacts.map((c) => c.name)).toEqual(["Pat X", "Sam X"]);
    expect(await setContact(deps(), dee, baylor, "5550002", false)).toEqual({ ok: true });
    expect(await getPartner(deps(), sam, baylor)).toBeNull();
  });

  it("only Directors add or edit partners; names stay unique", async () => {
    const input = { name: "Red Bank HS", kind: "School", hostsGames: true, registersTeams: true, approved: true };
    expect(await savePartner(deps(), pat, null, input)).toMatchObject({ ok: false });
    const r = await savePartner(deps(), dee, null, input);
    expect(r).toMatchObject({ ok: true });
    expect(await savePartner(deps(), dee, other, { ...input, name: "baylor school" })).toMatchObject({ ok: false, message: /already a partner/ });
    expect(await savePartner(deps(), dee, other, { ...input, name: "Other Club", approved: true })).toEqual({ ok: true, id: other });
    expect((await listPartners(deps(), dee)).partners.find((p) => p.id === other)).toMatchObject({ approved: true, hostsGames: true });
  });

  it("a contact manages their partner's gyms and courts, in order; others can't", async () => {
    const g = await saveGym(deps(), pat, baylor, null, { name: "Main Gym", address: "171 Baylor School Rd, Chattanooga" });
    expect(g).toMatchObject({ ok: true });
    const gymId = (g as { id: string }).id;
    for (const c of ["Court 10", "Court 2", "Court 1"]) expect(await addCourt(deps(), pat, gymId, c)).toEqual({ ok: true });
    expect(await addCourt(deps(), pat, gymId, "court 1")).toMatchObject({ ok: false, message: /already used/ });
    expect(await saveGym(deps(), pat, baylor, null, { name: "main gym", address: "" })).toMatchObject({ ok: false, message: /already used/ });
    expect(await saveGym(deps(), pat, other, null, { name: "Their Gym", address: "" })).toMatchObject({ ok: false });
    expect(await saveGym(deps(), sam, baylor, null, { name: "X Gym", address: "" })).toMatchObject({ ok: false });
    expect(await addCourt(deps(), sam, gymId, "Court 3")).toMatchObject({ ok: false });
    expect(await saveGym(deps(), pat, baylor, null, { name: "Gym B", address: "=cmd" })).toMatchObject({ ok: false, message: /address/ });

    const p = await getPartner(deps(), dee, baylor);
    expect(p?.gymList).toMatchObject([{ name: "Main Gym", address: "171 Baylor School Rd, Chattanooga" }]);
    expect(p?.gymList[0].courts.map((c) => c.name)).toEqual(["Court 1", "Court 2", "Court 10"]);
    expect(p).toMatchObject({ gyms: 1, courts: 3 });

    expect(await deleteCourt(deps(), sam, p!.gymList[0].courts[0].id)).toMatchObject({ ok: false });
    expect(await deleteCourt(deps(), pat, p!.gymList[0].courts[0].id)).toEqual({ ok: true });
    expect(await deleteGym(deps(), pat, gymId)).toEqual({ ok: true });
    expect((await getPartner(deps(), dee, baylor))?.gymList).toEqual([]);
  });

  it("open hours: one day or a repeat over matching game days; clear; only the partner's courts; past days untouched", async () => {
    const g = (await saveGym(deps(), pat, baylor, null, { name: "Main Gym", address: "" })) as { id: string };
    await addCourt(deps(), pat, g.id, "Court 1");
    await addCourt(deps(), pat, g.id, "Court 2");
    // Game days: Sat Oct 31 (past), Sat Dec 5, Sun Dec 6, Sat Dec 12.
    await db.pool.query("insert into game_days (day, created_by) values ('2026-10-31', 'x')");
    await saveGameDays(deps(), dee, { add: ["2026-12-05", "2026-12-06", "2026-12-12"], remove: [] });
    const h0 = (await partnerHours(deps(), pat, baylor))!;
    expect(h0.days.map((d) => d.day)).toEqual(["2026-12-05", "2026-12-06", "2026-12-12"]);
    expect(h0.courts.map((c) => `${c.gym} ${c.name}`)).toEqual(["Main Gym Court 1", "Main Gym Court 2"]);
    const [c1, c2] = h0.courts.map((c) => c.id);
    const [dec5, dec6, dec12] = h0.days.map((d) => d.id);

    // Saturdays, both courts, 9–9.
    const sat = { courtIds: [c1, c2], repeat: { from: "2026-10-01", to: "2026-12-31", weekdays: [6] }, starts: "09:00", ends: "21:00" };
    expect(await setHours(deps(), pat, baylor, sat)).toEqual({ ok: true, changed: 4 });
    // One day, one court, different hours.
    expect(await setHours(deps(), pat, baylor, { courtIds: [c1], dayId: dec6, starts: "13:00", ends: "18:30" })).toEqual({ ok: true, changed: 1 });
    let h = (await partnerHours(deps(), dee, baylor))!;
    expect(h.hours[`${c1}:${dec5}`]).toEqual({ starts: "09:00", ends: "21:00", setBy: "Pat X" });
    expect(h.hours[`${c1}:${dec6}`]).toMatchObject({ starts: "13:00", ends: "18:30" });
    expect(h.hours[`${c2}:${dec6}`]).toBeUndefined();
    expect(Object.keys(h.hours)).toHaveLength(5);
    // The past game day (Oct 31) was left alone.
    expect((await db.pool.query("select count(*)::int n from court_hours h join game_days d on d.id = h.game_day_id where d.day < '2026-11-02'")).rows[0].n).toBe(0);

    // Mark court 2 closed on Dec 12.
    expect(await setHours(deps(), pat, baylor, { courtIds: [c2], dayId: dec12, starts: null, ends: null })).toEqual({ ok: true, changed: 1 });
    h = (await partnerHours(deps(), pat, baylor))!;
    expect(h.hours[`${c2}:${dec12}`]).toBeUndefined();
    expect(await openCourtsByDay(deps(), dee)).toEqual({ [dec5]: 2, [dec6]: 1, [dec12]: 1 });
    expect(await openCourtsByDay(deps(), pat)).toBeNull();

    // Only the partner's contacts enter gym availability; a Director can't.
    expect(await setHours(deps(), dee, baylor, sat)).toMatchObject({ ok: false, message: /Only this partner's contacts/ });

    // Days tapped on the calendar.
    expect(await setHours(deps(), pat, baylor, { courtIds: [c2], dayIds: [dec6, dec12], starts: "10:00", ends: "22:00" })).toEqual({ ok: true, changed: 2 });
    expect((await partnerHours(deps(), pat, baylor))!.hours[`${c2}:${dec6}`]).toMatchObject({ starts: "10:00", ends: "22:00" });
    expect(await setHours(deps(), pat, baylor, { courtIds: [c2], dayIds: [dec6, dec12], starts: null, ends: null })).toEqual({ ok: true, changed: 2 });
    expect(await setHours(deps(), pat, baylor, { courtIds: [c2], dayIds: [], starts: "10:00", ends: "12:00" })).toMatchObject({ ok: false, message: /Tap the game days/ });

    // Checks: times between 9 AM and 10 PM.
    expect(await setHours(deps(), pat, baylor, { ...sat, starts: "08:30", ends: "12:00" })).toMatchObject({ ok: false, message: /between 9:00 AM and 10:00 PM/ });
    expect(await setHours(deps(), pat, baylor, { ...sat, starts: "18:00", ends: "22:30" })).toMatchObject({ ok: false, message: /between 9:00 AM and 10:00 PM/ });
    expect(await setHours(deps(), pat, baylor, { ...sat, starts: "21:00", ends: "09:00" })).toMatchObject({ ok: false, message: /after the start/ });
    expect(await setHours(deps(), pat, baylor, { ...sat, starts: "9am" })).toMatchObject({ ok: false });
    expect(await setHours(deps(), pat, baylor, { ...sat, courtIds: [] })).toMatchObject({ ok: false, message: /court/ });
    expect(await setHours(deps(), pat, baylor, { ...sat, repeat: { ...sat.repeat, weekdays: [2] } })).toMatchObject({ ok: false, message: /No upcoming/ });
    expect(await setHours(deps(), sam, baylor, sat)).toMatchObject({ ok: false });
    expect(await partnerHours(deps(), sam, baylor)).toBeNull();
    // A court from another partner is refused.
    const og = (await saveGym(deps(), dee, other, null, { name: "Other Gym", address: "" })) as { id: string };
    await addCourt(deps(), dee, og.id, "Court 1");
    const otherCourt = (await partnerHours(deps(), dee, other))!.courts[0].id;
    expect(await setHours(deps(), pat, baylor, { ...sat, courtIds: [c1, otherCourt] })).toMatchObject({ ok: false, message: /no longer exists/ });
  });

  it("game days: Directors add and remove dates from the calendar in one go; never in the past", async () => {
    const add = (a: string[], r: string[] = []) => saveGameDays(deps(), dee, { add: a, remove: r });
    expect(await saveGameDays(deps(), pat, { add: ["2026-12-05"], remove: [] })).toMatchObject({ ok: false });
    expect(await add(["2026-12-05", "2026-12-06", "2026-12-12", "2026-12-05"])).toEqual({ ok: true, added: 3, removed: 0 });
    expect(await add(["2026-12-05", "2026-12-19"], ["2026-12-06"])).toEqual({ ok: true, added: 1, removed: 1 });
    expect(await add(["2026-11-01"])).toMatchObject({ ok: false, message: /past/ });
    expect(await add(["12/5/2026"])).toMatchObject({ ok: false });
    expect(await add([])).toMatchObject({ ok: false, message: /Tap the dates/ });

    const days = await listGameDays(deps(), sam);
    expect(days?.map((d) => d.day)).toEqual(["2026-12-05", "2026-12-12", "2026-12-19"]);
    expect(days?.[0].createdBy).toBe("Dee X");
    expect(await listGameDays(deps(), person("5550009", "Nobody"))).toBeNull();
  });


  it("Scenic City Director tools need Facilities (or Admin)", async () => {
    await db.pool.query("delete from director_areas where coach_id = '9913694'");
    expect(await saveGameDays(deps(), dee, { add: ["2026-12-05"], remove: [] })).toEqual({
      ok: false,
      message: "Only a Scenic City Director of Facilities can do that.",
    });
    expect((await listPartners(deps(), dee)).isDirector).toBe(false);
    await grant(db.pool, "9913694 scenic-city Admin");
    expect(await saveGameDays(deps(), dee, { add: ["2026-12-05"], remove: [] })).toMatchObject({ ok: true });
    expect((await listPartners(deps(), dee)).isDirector).toBe(true);
  });
});
