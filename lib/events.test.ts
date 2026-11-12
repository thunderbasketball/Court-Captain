import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { eventName, gradesText } from "./event-names";
import {
  addEventType,
  countMatching,
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  listEventTypes,
  myEventCount,
  refreshPlayers,
  removeEventType,
  setStatus,
} from "./events";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string, isDirector = false): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector,
  isCoach: true,
  requestPending: false,
  hasThunderRole: true,
});
const director = person("9913694", "Earl", true);
const helper = person("5550001", "Hank");
const other = person("5550002", "Amy");

describe("events", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  const now = new Date("2026-10-28T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const tryouts = {
    kind: "Tryouts",
    gender: "Girls",
    date: "2026-11-07",
    time: "09:30",
    location: "Action Church",
    grades: ["4", "5"],
    staff: ["5550001"],
  };
  const reg = (id: string, first: string, gender: string, grade: string) =>
    db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at, imported_by)
       values ($1, $1, $2, 'Kid', $3, $4, $5, 'x', '{}', now(), 'x')`,
      [id, first, gender, grade, grade === "K" ? 0 : Number(grade)],
    );

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell, active) values
         ('9913694', 'Earl', 'X', '4239913694', true),
         ('5550001', 'Hank', 'X', '4235550001', true),
         ('5550002', 'Amy', 'X', '4235550002', true),
         ('5550003', 'Ina', 'X', '4235550003', false)`,
    );
    await grant(db.pool, "9913694 thunder Director", "5550001 thunder Coach", "5550002 thunder Coach", "5550003 thunder Coach");
    await db.pool.query(
      "insert into event_types (name, created_by, created_at) values ('Open Gym', 'x', '2026-01-01'), ('Tryouts', 'x', '2026-01-02')",
    );
    await reg("r1", "Ava", "Girls", "4");
    await reg("r2", "Bea", "Girls", "5");
    await reg("r3", "Cy", "Boys", "4");
    await reg("r4", "Dee", "Girls", "6");
  });

  it("a Session of a program: its players only, tryout sign-up dates checked, kept with the program", async () => {
    const prog = async (name: string, start: string) =>
      (
        await db.pool.query<{ id: string }>(
          "insert into player_programs (org, name, reg_opens, starts_on, ends_on, created_by) values ('thunder', $1, $2, $2, $2::date + 60, 'x') returning id::text",
          [name, start],
        )
      ).rows[0].id;
    const fall = await prog("Fall", "2026-09-01");
    const spring = await prog("Spring", "2027-03-01");
    await db.pool.query("update registrations set program_id = $1", [fall]); // r1–r4 registered for Fall
    await reg("r5", "Eve", "Girls", "4"); // a new registration joins the current (latest) program: Spring
    expect((await db.pool.query("select program_id::text as p from registrations where registrant_id = 'r5'")).rows[0].p).toBe(spring);

    const r = await createEvent(deps(), director, { ...tryouts, programId: fall, signupOpens: "2026-10-30", signupCloses: "2026-11-05" });
    expect(r).toMatchObject({ ok: true, players: 2 }); // Ava and Bea; not Eve (Spring)
    const row = await db.pool.query(
      "select program_id::text as p, to_char(signup_opens, 'YYYY-MM-DD') as o, to_char(signup_closes, 'YYYY-MM-DD') as c from events where id = $1",
      [(r as { id: string }).id],
    );
    expect(row.rows[0]).toEqual({ p: fall, o: "2026-10-30", c: "2026-11-05" });
    expect(await createEvent(deps(), director, { ...tryouts, programId: fall, signupOpens: "2026-11-05", signupCloses: "2026-10-30" })).toMatchObject({
      ok: false,
      message: "Sign-up can't close before it opens.",
    });
    expect(await createEvent(deps(), director, { ...tryouts, programId: "999999" })).toMatchObject({ ok: false });
    // Sign-up dates are for Tryouts only; without a program, Thunder's current one.
    const g = await createEvent(deps(), director, { ...tryouts, kind: "Open Gym", signupOpens: "2026-10-30" });
    const gr = await db.pool.query("select program_id::text as p, signup_opens from events where id = $1", [(g as { id: string }).id]);
    expect(gr.rows[0]).toEqual({ p: spring, signup_opens: null });
  });

  it("creates an event with the matching players, at 9:30 AM Eastern, and checks the input", async () => {
    expect(await countMatching(deps(), director, { genders: ["Girls"], grades: ["4", "5"] })).toBe(2);
    expect(await countMatching(deps(), director, { genders: ["Girls", "Boys"], grades: ["4"] })).toBe(2);
    const r = await createEvent(deps(), director, tryouts);
    expect(r).toMatchObject({ ok: true, players: 2 });
    if (!r.ok) return;
    const e = await getEvent(deps(), director, r.id);
    expect(e).toMatchObject({
      name: "Tryouts – Girls 4th–5th Grade",
      location: "Action Church",
      createdBy: "Earl X",
      staff: ["Hank X"],
      total: 2,
      here: 0,
    });
    expect(e?.startsAt.toISOString()).toBe("2026-11-07T14:30:00.000Z");
    expect(e?.players.map((p) => [p.firstName, p.grade, p.status])).toEqual([
      ["Ava", "4", "unknown"],
      ["Bea", "5", "unknown"],
    ]);

    const bad = async (patch: object) => {
      const x = await createEvent(deps(), director, { ...tryouts, ...patch });
      return x.ok ? "ok" : x.message;
    };
    expect(await bad({ kind: "  " })).toBe("Pick an event type.");
    expect(await bad({ kind: "Pickup" })).toBe("That event type no longer exists. Pick again.");
    expect(await bad({ date: "11/7/2026" })).toBe("Pick a date.");
    expect(await bad({ time: "25:00" })).toBe("Pick a start time.");
    expect(await bad({ gender: "Unisex" })).toBe("Pick Boys, Girls, or Coed.");
    expect(await bad({ grades: [] })).toBe("Pick at least one grade.");
    expect(await bad({ staff: ["5550003"] })).toBe("One of the check-in people is no longer active. Pick again.");
    expect(await createEvent(deps(), helper, tryouts)).toEqual({ ok: false, message: "Only a Director of Programs can manage events." });
  });

  it("only the Director and the event's check-in people can open it or mark players; who marked it is recorded", async () => {
    const r = await createEvent(deps(), director, tryouts);
    if (!r.ok) throw new Error(r.message);
    expect(await getEvent(deps(), other, r.id)).toBeNull();
    expect((await listEvents(deps(), other)).length).toBe(0);
    expect((await listEvents(deps(), helper)).map((e) => e.name)).toEqual(["Tryouts – Girls 4th–5th Grade"]);
    expect(await myEventCount(deps(), helper)).toBe(1);

    expect(await setStatus(deps(), other, { eventId: r.id, registrantId: "r1", status: "here" })).toEqual({
      ok: false,
      message: "You don't run check-in for this event.",
    });
    expect(await setStatus(deps(), helper, { eventId: r.id, registrantId: "r1", status: "here" })).toMatchObject({
      ok: true,
      updatedBy: "Hank X",
    });
    expect(await setStatus(deps(), director, { eventId: r.id, registrantId: "r2", status: "absent" })).toMatchObject({
      ok: true,
      updatedBy: "Earl X",
    });
    expect(await setStatus(deps(), helper, { eventId: r.id, registrantId: "r3", status: "here" })).toEqual({
      ok: false,
      message: "That player isn't on this event.",
    });
    expect(await setStatus(deps(), helper, { eventId: r.id, registrantId: "r1", status: "late" })).toEqual({
      ok: false,
      message: "Unknown status.",
    });

    let e = await getEvent(deps(), helper, r.id);
    expect(e).toMatchObject({ here: 1, absent: 1, total: 2 });
    expect(e?.players[0]).toMatchObject({ status: "here", updatedBy: "Hank X" });

    // Back to ? clears who marked it.
    await setStatus(deps(), helper, { eventId: r.id, registrantId: "r1", status: "unknown" });
    e = await getEvent(deps(), helper, r.id);
    expect(e?.players[0]).toMatchObject({ status: "unknown", updatedBy: null, updatedAt: null });
  });

  it("Coed picks both genders; the name follows the type's spelling", async () => {
    const r = await createEvent(deps(), director, { ...tryouts, kind: "open gym", gender: "Coed", grades: ["5", "4", "K"], staff: [] });
    if (!r.ok) throw new Error(r.message);
    const e = await getEvent(deps(), director, r.id);
    expect(e).toMatchObject({ name: "Open Gym – Coed K, 4th–5th Grade", genders: ["Boys", "Girls"], total: 3 });
  });

  it("event types: the Director adds and removes quick options", async () => {
    expect(await listEventTypes(deps())).toEqual(["Open Gym", "Tryouts"]);
    expect(await addEventType(deps(), director, "  Skills   Clinic ")).toEqual({ ok: true, name: "Skills Clinic" });
    expect(await addEventType(deps(), director, "skills clinic")).toEqual({
      ok: false,
      message: '"skills clinic" is already an event type.',
    });
    expect(await addEventType(deps(), director, "=HYPERLINK()")).toMatchObject({ ok: false });
    expect(await addEventType(deps(), helper, "Camp")).toMatchObject({ ok: false });
    expect(await listEventTypes(deps())).toEqual(["Open Gym", "Tryouts", "Skills Clinic"]);
    expect(await removeEventType(deps(), director, "Open Gym")).toEqual({ ok: true });
    expect(await listEventTypes(deps())).toEqual(["Tryouts", "Skills Clinic"]);
  });

  it("names: grades become ranges", () => {
    expect(gradesText(["4"])).toBe("4th Grade");
    expect(gradesText(["K"])).toBe("Kindergarten");
    expect(gradesText(["1", "2", "3", "11", "12"])).toBe("1st–3rd, 11th–12th Grade");
    expect(gradesText(["K", "1", "2", "3"])).toBe("K–3rd Grade");
    expect(gradesText(["2", "4", "5", "6", "9"])).toBe("2nd, 4th–6th, 9th Grade");
    expect(eventName("Open Run", "Coed", ["7", "8"])).toBe("Open Run – Coed 7th–8th Grade");
  });

  it("update player list adds new registrations without touching check-ins; delete removes it", async () => {
    const r = await createEvent(deps(), director, tryouts);
    if (!r.ok) throw new Error(r.message);
    await setStatus(deps(), helper, { eventId: r.id, registrantId: "r1", status: "here" });
    await reg("r5", "Eve", "Girls", "5");
    expect(await refreshPlayers(deps(), helper, r.id)).toMatchObject({ ok: false });
    expect(await refreshPlayers(deps(), director, r.id)).toEqual({ ok: true, added: 1 });
    expect(await refreshPlayers(deps(), director, r.id)).toEqual({ ok: true, added: 0 });
    const e = await getEvent(deps(), director, r.id);
    expect(e?.players.map((p) => [p.firstName, p.status])).toEqual([
      ["Ava", "here"],
      ["Bea", "unknown"],
      ["Eve", "unknown"],
    ]);

    expect(await deleteEvent(deps(), helper, r.id)).toMatchObject({ ok: false });
    expect(await deleteEvent(deps(), director, r.id)).toEqual({ ok: true });
    expect(await getEvent(deps(), director, r.id)).toBeNull();
    expect(await myEventCount(deps(), helper)).toBe(0);
  });
});
