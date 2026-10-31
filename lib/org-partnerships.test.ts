import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { decideHosting, hostingOffers, hostingRequests, requestHosting } from "./org-partnerships";
import { getPartner, openCourtsByDay, partnerHours } from "./scenic-partners";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
});
const tee = person("5550001", "Tee"); // Thunder Director of Facilities
const tia = person("5550002", "Tia"); // Thunder Director of Teams only
const sue = person("5550003", "Sue"); // Scenic City Director of Facilities
const sal = person("5550004", "Sal"); // Scenic City Admin

describe("organizations partnering to host games", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550001', 'Tee', 'X', '4235550001'), ('5550002', 'Tia', 'X', '4235550002'),
         ('5550003', 'Sue', 'X', '4235550003'), ('5550004', 'Sal', 'X', '4235550004')`,
    );
    await grant(
      db.pool,
      "5550001 thunder Director",
      "5550002 thunder Director",
      "5550003 scenic-city Director",
      "5550004 scenic-city Director",
      "5550004 scenic-city Admin",
    );
    await db.pool.query(
      `insert into director_areas (coach_id, org, area, granted_by) values
         ('5550001', 'thunder', 'facilities', 't'), ('5550002', 'thunder', 'teams', 't'), ('5550003', 'scenic-city', 'facilities', 't')`,
    );
  });

  it("Thunder's Directors of Facilities see who wants hosting sites and ask to host; others can't", async () => {
    expect(await hostingOffers(deps(), tee, "thunder")).toEqual([
      { org: "scenic-city", name: "Scenic City Basketball", status: "none", requestedBy: null, decidedBy: null },
    ]);
    expect(await hostingOffers(deps(), tia, "thunder")).toBeNull();
    expect(await requestHosting(deps(), tia, "thunder", "scenic-city")).toEqual({
      ok: false,
      message: "Only a Thunder Admin or Director of Facilities can do that.",
    });
    expect(await requestHosting(deps(), sue, "scenic-city", "thunder")).toMatchObject({ ok: false }); // Scenic City offers no hosting
    expect(await requestHosting(deps(), tee, "thunder", "scenic-city")).toEqual({ ok: true });
    expect(await requestHosting(deps(), tee, "thunder", "scenic-city")).toEqual({
      ok: false,
      message: "You've already asked Scenic City Basketball.",
    });
    expect((await hostingOffers(deps(), tee, "thunder"))![0]).toMatchObject({ status: "pending", requestedBy: "Tee X" });
  });

  it("Scenic City approves: Thunder becomes a hosting partner linked to its organization (its old partner record reused)", async () => {
    await db.pool.query(
      "insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values ('Thunder Basketball', 'Organization', false, true, false, 'x')",
    );
    await requestHosting(deps(), tee, "thunder", "scenic-city");
    const [req] = (await hostingRequests(deps(), sue, "scenic-city"))!;
    expect(req).toMatchObject({ hostOrg: "thunder", name: "Thunder Basketball", status: "pending", requestedBy: "Tee X" });
    expect(await hostingRequests(deps(), tee, "scenic-city")).toBeNull();
    expect(await decideHosting(deps(), tee, req.id, true)).toMatchObject({ ok: false }); // not Scenic City's
    expect(await decideHosting(deps(), sue, req.id, true)).toEqual({ ok: true });
    expect(await decideHosting(deps(), sal, req.id, false)).toEqual({ ok: false, message: "That request was already answered." });

    const p = await db.pool.query("select name, org_slug, hosts_games, registers_teams, approved from partners");
    expect(p.rows).toEqual([
      { name: "Thunder Basketball", org_slug: "thunder", hosts_games: true, registers_teams: true, approved: true },
    ]);
    expect((await hostingOffers(deps(), tee, "thunder"))![0]).toMatchObject({ status: "approved", decidedBy: "Sue X" });
  });

  it("a declined request can be sent again; approving with no partner record makes one", async () => {
    await requestHosting(deps(), tee, "thunder", "scenic-city");
    let [req] = (await hostingRequests(deps(), sal, "scenic-city"))!;
    expect(await decideHosting(deps(), sal, req.id, false)).toEqual({ ok: true });
    expect((await hostingOffers(deps(), tee, "thunder"))![0]).toMatchObject({ status: "declined", decidedBy: "Sal X" });
    expect(await requestHosting(deps(), tee, "thunder", "scenic-city")).toEqual({ ok: true });
    [req] = (await hostingRequests(deps(), sal, "scenic-city"))!;
    expect(req).toMatchObject({ status: "pending", decidedBy: null });
    expect(await decideHosting(deps(), sal, req.id, true)).toEqual({ ok: true });
    const p = await db.pool.query("select name, kind, org_slug, hosts_games, approved from partners");
    expect(p.rows).toEqual([
      { name: "Thunder Basketball", kind: "Organization", org_slug: "thunder", hosts_games: true, approved: true },
    ]);
  });

  it("once approved, Thunder's gyms marked Partner Games on Scenic City game days are its open courts there (one per gym)", async () => {
    await requestHosting(deps(), tee, "thunder", "scenic-city");
    const [req] = (await hostingRequests(deps(), sue, "scenic-city"))!;
    await decideHosting(deps(), sue, req.id, true);
    const partnerId = (await db.pool.query<{ id: string }>("select id::text from partners where org_slug = 'thunder'")).rows[0]
      .id;
    const gyms = await db.pool.query<{ id: string }>(
      "insert into gyms (name) values ('Action Church'), ('East Ridge MS') returning id::text",
    );
    const [ac, er] = gyms.rows.map((r) => r.id);
    const days = await db.pool.query<{ id: string }>(
      "insert into game_days (day, created_by) values ('2026-12-05', 'x'), ('2026-12-12', 'x') returning id::text",
    );
    const [dec5, dec12] = days.rows.map((r) => r.id);
    await db.pool.query(
      `insert into gym_availability (gym_id, day, use, starts, ends, set_by) values
         ($1, '2026-12-05', 'partner', '09:00', '21:00', 'Tee X'), ($2, '2026-12-05', 'partner', '10:00', '18:00', 'Tee X'),
         ($1, '2026-12-12', 'practice', '09:00', '21:00', 'Tee X'), ($2, '2026-12-19', 'partner', '09:00', '21:00', 'Tee X')`,
      [ac, er],
    );
    // An old hand-typed gym on Thunder's partner record doesn't count twice.
    const g = await db.pool.query<{ id: string }>(
      "insert into partner_gyms (partner_id, name, created_by) values ($1, 'Typed', 'x') returning id::text",
      [partnerId],
    );
    const c = await db.pool.query<{ id: string }>(
      "insert into partner_courts (gym_id, name, created_by) values ($1, '1', 'x') returning id::text",
      [g.rows[0].id],
    );
    await db.pool.query(
      "insert into court_hours (court_id, game_day_id, starts, ends, set_by) values ($1, $2, '09:00', '21:00', 'x')",
      [c.rows[0].id, dec5],
    );

    expect(await openCourtsByDay(deps(), sue)).toEqual({ [dec5]: 2 }); // Dec 12 is Practice; Dec 19 isn't a game day
    const h = (await partnerHours(deps(), sal, partnerId))!;
    expect(h.courts).toEqual([
      { id: ac, gym: "Action Church", name: "Whole gym" },
      { id: er, gym: "East Ridge MS", name: "Whole gym" },
    ]);
    expect(h.hours).toEqual({
      [`${ac}:${dec5}`]: { starts: "09:00", ends: "21:00", setBy: "Tee X" },
      [`${er}:${dec5}`]: { starts: "10:00", ends: "18:00", setBy: "Tee X" },
    });
    expect(dec12).toBeTruthy();
    const p = (await getPartner(deps(), sal, partnerId))!;
    expect(p).toMatchObject({ managedBy: "Thunder Basketball", canEditGyms: false, canEnterHours: false, gyms: 2, courts: 2 });
    expect(p.gymList.map((x) => x.name)).toEqual(["Action Church", "East Ridge MS"]);
  });
});
