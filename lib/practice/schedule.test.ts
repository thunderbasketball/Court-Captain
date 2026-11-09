import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/service";
import { createTestDb } from "../testing/db";
import { weekOf, zonedTime } from "../time";
import { addGym, addSlots } from "./admin";
import { bookSlot } from "./booking";
import { upcomingForTeams, weekGrid } from "./schedule";

const person = (coachId: string, isDirector = false): SessionUser => ({
  coachId,
  firstName: "P",
  lastName: coachId,
  isDirector,
  isCoach: true,
  requestPending: false,
  hasThunderRole: true,
});
const director = person("9913694", true);
const head = person("5550001");
const parent = person("5550002");
const stranger = person("5550009");

describe("week grid", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  let now = zonedTime(2026, 11, 9, 12); // Mon noon
  const deps = () => ({ pool: db.pool, now: () => now });
  let team = "";
  let other = "";
  const week = weekOf(zonedTime(2026, 11, 9, 12)).start;

  beforeEach(async () => {
    await db.reset();
    now = zonedTime(2026, 11, 9, 12);
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001','H','X','4235550001'), ('5550002','P','X','4235550002')`,
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, practice_locations, created_by)
       values ('4G A', 'Girls', '{4}', 4, 'REC', '{Action Church}', 'x'), ('5G B', 'Girls', '{5}', 5, 'REC', '{}', 'x') returning id::text`,
    );
    [team, other] = t.rows.map((r) => r.id);
    await db.pool.query(`insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x'), ($1, '5550002', 'TeamParent', 'x')`, [team]);
    const a = await addGym(deps(), director, { name: "Action Church", courts: ["North", "South"] });
    const b = await addGym(deps(), director, { name: "Heritage HS", courts: ["Main"] });
    if (!a.ok || !b.ok) throw new Error("setup");
    // Mon, Tue, Thu at 6 PM at both gyms.
    for (const gymId of [a.id, b.id]) await addSlots(deps(), director, { gymId, courtId: "all", from: "2026-11-09", to: "2026-11-13", days: [1, 2, 4], hours: [18] });
  });

  const slotAt = async (gym: string, court: string, day: number) =>
    (
      await db.pool.query<{ id: string }>(
        `select s.id::text from slots s join courts c on c.id = s.court_id join gyms g on g.id = c.gym_id
         where g.name = $1 and c.name = $2 and s.starts_at = $3`,
        [gym, court, zonedTime(2026, 11, day, 18)],
      )
    ).rows[0].id;
  const lines = (g: Awaited<ReturnType<typeof weekGrid>>) =>
    g.days.flatMap((d) => d.gyms.flatMap((x) => x.times.flatMap((t) => t.slots.map((s) => `${d.label} ${x.gym} ${s.court} ${s.team ?? (s.canBook ? "BOOK" : "no")}`))));

  it("lists each team's upcoming practices at once (Teams page 📅), soonest first, past ones left out", async () => {
    await bookSlot(deps(), director, { slotId: await slotAt("Heritage HS", "Main", 12), teamId: team });
    await bookSlot(deps(), director, { slotId: await slotAt("Action Church", "North", 10), teamId: team });
    await bookSlot(deps(), director, { slotId: await slotAt("Action Church", "South", 9), teamId: other });
    now = zonedTime(2026, 11, 9, 20); // Monday's practice is over
    const all = await upcomingForTeams(deps(), [team, other]);
    expect(all[team].map((p) => `${p.gym} ${p.court} ${p.startsAt.toISOString()}`)).toEqual([
      `Action Church North ${zonedTime(2026, 11, 10, 18).toISOString()}`,
      `Heritage HS Main ${zonedTime(2026, 11, 12, 18).toISOString()}`,
    ]);
    expect(all[other]).toBeUndefined();
    expect((await upcomingForTeams(deps(), [team], 1))[team]).toHaveLength(1);
    expect(await upcomingForTeams(deps(), [])).toEqual({});
  });

  it("the Director sees everything", async () => {
    await bookSlot(deps(), director, { slotId: await slotAt("Action Church", "North", 9), teamId: other });
    const g = await weekGrid(deps(), director, week, "director");
    expect(g.counts).toEqual({ open: 8, booked: 1, blocked: 0 });
    expect(g.label).toBe("Week of 11/9 – 11/15/2026");
  });

  it("a team sees its gyms: open slots and which teams practice when, but not who booked", async () => {
    await bookSlot(deps(), director, { slotId: await slotAt("Action Church", "North", 10), teamId: other });
    const g = await weekGrid(deps(), head, week, { teamId: team });
    expect(g.team).toMatchObject({ name: "4G A", booked: 0, status: "No practice booked this week. You can book 1." });
    expect(lines(g)).toEqual([
      "Mon, 11/9 Action Church North BOOK",
      "Mon, 11/9 Action Church South BOOK",
      "Tue, 11/10 Action Church North 5G B", // another team's practice is shown. Heritage isn't an approved gym.
      "Tue, 11/10 Action Church South BOOK",
      "Thu, 11/12 Action Church North BOOK",
      "Thu, 11/12 Action Church South BOOK",
    ]);
    const all = g.days.flatMap((d) => d.gyms.flatMap((x) => x.times.flatMap((t) => t.slots)));
    expect(all.every((s) => s.bookedBy === null)).toBe(true);
    expect(all.find((s) => s.team === "5G B")).toMatchObject({ canBook: false, mine: false });
  });

  it("after one booking, only slots within 72 hours stay bookable", async () => {
    await bookSlot(deps(), head, { slotId: await slotAt("Action Church", "North", 9), teamId: team });
    const g = await weekGrid(deps(), head, week, { teamId: team });
    expect(g.team?.booked).toBe(1);
    expect(lines(g)).toEqual([
      "Mon, 11/9 Action Church North 4G A",
      "Mon, 11/9 Action Church South BOOK", // 6 h away
      "Tue, 11/10 Action Church North BOOK", // 30 h away
      "Tue, 11/10 Action Church South BOOK",
      "Thu, 11/12 Action Church North no", // 78 h away
      "Thu, 11/12 Action Church South no",
    ]);
  });

  it("a team parent can view but not book; someone not on the team can't open it", async () => {
    const g = await weekGrid(deps(), parent, week, { teamId: team });
    expect(g.days.flatMap((d) => d.gyms.flatMap((x) => x.times.flatMap((t) => t.slots))).every((s) => !s.canBook && s.reason === "Team parents can view only.")).toBe(true);
    await expect(weekGrid(deps(), stranger, week, { teamId: team })).rejects.toThrow();
    await expect(weekGrid(deps(), head, week, "director")).rejects.toThrow();
  });
});
