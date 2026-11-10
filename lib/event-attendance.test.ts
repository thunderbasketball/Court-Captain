import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testing/db";
import { eventRoster, myPlayers, rsvpsFor, setEventMark, setRsvp, takesAttendance } from "./event-attendance";
import { addOwnPractice, upcomingOwnPractices } from "./team-practices";

describe("team events attendance", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  let now = new Date("2026-11-11T23:50:00Z"); // 10 minutes before the booked practice (Nov 11, 7 PM Eastern)
  const deps = () => ({ pool: db.pool, now: () => now });
  const person = (coachId: string, extra: object = {}) =>
    ({ coachId, firstName: "P", lastName: coachId, isDirector: false, thunderAreas: [], ...extra }) as never;
  const coach = person("5550001");
  const stranger = person("5550002");
  const max = person("5550004");
  let team = "";
  let other = "";
  let er = "";
  let slot = "";

  beforeEach(async () => {
    now = new Date("2026-11-11T23:50:00Z");
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550001', 'P', '5550001', '4235550001'), ('5550002', 'P', '5550002', '4235550002'), ('5550004', 'P', '5550004', '4235550004')`,
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x'), ('5B B', 'Boys', '{5}', 5, 'REC', 'x') returning id::text`,
    );
    [team, other] = t.rows.map((r) => r.id);
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'TeamParent', 'x')", [team]);
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, 'r1', 'Ava', 'Smith', 'Girls', '4', 4, 'x', now()), ($1, 'r2', 'Bea', 'Adams', 'Girls', '4', 4, 'x', now()),
              ($2, 'r3', 'Cal', 'Other', 'Boys', '5', 5, 'x', now())`,
      [team, other],
    );
    const g = await db.pool.query<{ id: string }>("insert into gyms (name) values ('Action Church') returning id::text");
    const c = await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'Goal #1') returning id::text", [g.rows[0].id]);
    slot = (
      await db.pool.query<{ id: string }>(
        "insert into slots (court_id, starts_at, created_by, team_id, booked_by) values ($1, '2026-11-12T00:00:00Z', 'x', $2, 'x') returning id::text",
        [c.rows[0].id, team],
      )
    ).rows[0].id;
    await db.pool.query("delete from organizations where slug = 'east-ridge'");
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('east-ridge', 'East Ridge', 'ER', 'Organization')");
    er = (
      await db.pool.query<{ id: string }>(
        "insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('east-ridge', '5B Ace', 'Boys', 5, 5, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550004', 'HeadCoach', 'x')", [er]);
    await db.pool.query("insert into org_team_players (team_id, first_name, last_name, grade, added_by) values ($1, 'Dee', 'Doe', 5, 'x')", [er]);
  });

  it("the team's staff mark booked practices (the same marks as Events check-in) and own-gym practices", async () => {
    const T = { org: "thunder", teamId: team };
    expect(await takesAttendance(db.pool, coach, T)).toBe(true);
    expect(await takesAttendance(db.pool, stranger, T)).toBe(false);
    expect(await eventRoster(deps(), stranger, T, "slot", slot)).toBeNull();

    const list = (await eventRoster(deps(), coach, T, "slot", slot))?.players;
    expect(list?.map((p) => `${p.lastName}:${p.status}`)).toEqual(["Adams:unknown", "Smith:unknown"]);
    expect(await setEventMark(deps(), coach, T, { kind: "slot", eventId: slot, player: "r1", status: "here" })).toEqual({ ok: true });
    expect(await setEventMark(deps(), coach, T, { kind: "slot", eventId: slot, player: "r2", status: "absent" })).toEqual({ ok: true });
    const pa = await db.pool.query("select registrant_id, status, updated_by from practice_attendance order by registrant_id");
    expect(pa.rows).toEqual([
      { registrant_id: "r1", status: "here", updated_by: "P 5550001" },
      { registrant_id: "r2", status: "absent", updated_by: "P 5550001" },
    ]);
    // Tapping the lit one clears it.
    await setEventMark(deps(), coach, T, { kind: "slot", eventId: slot, player: "r1", status: "unknown" });
    expect((await eventRoster(deps(), coach, T, "slot", slot))?.players.find((p) => p.player === "r1")).toMatchObject({
      status: "unknown",
      statusBy: null,
    });

    const director = person("5550009", { isDirector: true, thunderAreas: ["teams"] });
    await addOwnPractice(deps(), director, T, { location: "Masters Gym", date: "2026-11-16", time: "18:00", minutes: 90 });
    const [own] = await upcomingOwnPractices(deps(), T);
    // Too early: opens 15 minutes before its start.
    expect(await setEventMark(deps(), coach, T, { kind: "own", eventId: own.id, player: "r2", status: "here" })).toMatchObject({ ok: false });
    expect((await eventRoster(deps(), coach, T, "own", own.id))?.closed).toBe("Attendance opens 15 minutes before the start.");
    now = new Date("2026-11-16T23:00:00Z");
    expect(await setEventMark(deps(), coach, T, { kind: "own", eventId: own.id, player: "r2", status: "here" })).toEqual({ ok: true });
    expect((await eventRoster(deps(), coach, T, "own", own.id))?.players.map((p) => p.status)).toEqual(["here", "unknown"]);
    // Parents' answers show beside the name.
    await db.pool.query("insert into event_attendance (kind, event_id, team, player, rsvp, rsvp_by) values ('own', $1, $2, 'r1', 'no', 'Mom')", [
      own.id,
      `t${team}`,
    ]);
    expect((await eventRoster(deps(), coach, T, "own", own.id))?.players.find((p) => p.player === "r1")).toMatchObject({
      rsvp: "no",
      status: "unknown",
    });
  });

  it("refuses another team's player or event, and a stranger", async () => {
    const T = { org: "thunder", teamId: team };
    expect(await setEventMark(deps(), coach, T, { kind: "slot", eventId: slot, player: "r3", status: "here" })).toMatchObject({ ok: false });
    expect(await setEventMark(deps(), stranger, T, { kind: "slot", eventId: slot, player: "r1", status: "here" })).toMatchObject({ ok: false });
    const O = { org: "thunder", teamId: other };
    const director = person("5550009", { isDirector: true, thunderAreas: ["teams"] });
    expect(await eventRoster(deps(), director, O, "slot", slot)).toBeNull(); // not that team's practice
    expect(await setEventMark(deps(), coach, T, { kind: "slot", eventId: slot, player: "r1", status: "maybe" })).toMatchObject({ ok: false });
  });

  it("every organization's teams: its coaches mark its players on its own-gym practices", async () => {
    const E = { org: "east-ridge", teamId: er };
    await addOwnPractice(deps(), max, E, { location: "Gym", date: "2026-11-16", time: "18:00", minutes: 60 });
    const [own] = await upcomingOwnPractices(deps(), E);
    now = new Date("2026-11-16T23:30:00Z");
    const list = (await eventRoster(deps(), max, E, "own", own.id))?.players;
    expect(list?.map((p) => p.firstName)).toEqual(["Dee"]);
    expect(await setEventMark(deps(), max, E, { kind: "own", eventId: own.id, player: list![0].player, status: "absent" })).toEqual({ ok: true });
    expect((await eventRoster(deps(), max, E, "own", own.id))?.players[0].status).toBe("absent");
    expect(await eventRoster(deps(), coach, E, "own", own.id)).toBeNull();
    expect(await eventRoster(deps(), max, E, "slot", slot)).toBeNull(); // booked practices are Thunder's
  });

  it("only the player's parent answers (a staff member who is a parent too), until the start; attendance stays staff-only", async () => {
    const T = { org: "thunder", teamId: team };
    await db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at,
                                  imported_by, parent1_first, parent1_last, parent1_cell)
       values ('r1', 'r1', 'Ava', 'Smith', 'Girls', '4', 4, 'x', '{}', now(), 'x', 'P', 'One', '4235550001'),
              ('r2', 'r2', 'Bea', 'Adams', 'Girls', '4', 4, 'x', '{}', now(), 'x', 'P', 'Two', '4235550002')`,
    );
    expect(await myPlayers(db.pool, coach, T)).toEqual([{ player: "r1", firstName: "Ava" }]);
    expect(await setRsvp(deps(), coach, T, { kind: "slot", eventId: slot, player: "r1", rsvp: "no" })).toEqual({ ok: true });
    expect(await setRsvp(deps(), coach, T, { kind: "slot", eventId: slot, player: "r2", rsvp: "yes" })).toMatchObject({ ok: false });
    // Bea's parent isn't staff: they answer, but can't take attendance.
    expect(await setRsvp(deps(), stranger, T, { kind: "slot", eventId: slot, player: "r2", rsvp: "yes" })).toEqual({ ok: true });
    expect(await setEventMark(deps(), stranger, T, { kind: "slot", eventId: slot, player: "r2", status: "here" })).toMatchObject({ ok: false });
    expect(await rsvpsFor(db.pool, T, [{ kind: "slot", id: slot }], ["r1", "r2"])).toEqual({ [`slot${slot}`]: { r1: "no", r2: "yes" } });
    expect((await eventRoster(deps(), coach, T, "slot", slot))?.players.map((p) => p.rsvp)).toEqual(["yes", "no"]);
    // Answers close at the start.
    now = new Date("2026-11-12T00:00:00Z");
    expect(await setRsvp(deps(), coach, T, { kind: "slot", eventId: slot, player: "r1", rsvp: "yes" })).toEqual({
      ok: false,
      message: "Answers close when the event starts.",
    });
  });
});
