import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { scorerCount, setAssigner, setDirectorRoleActive } from "./org-admin";
import { orgMetrics } from "./org-metrics";
import { scoresFor } from "./scores";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string) => ({ coachId, firstName, lastName: "X" }) as SessionUser;
const olive = person("5550201", "Olive"); // Owner
const nate = person("5550202", "Nate"); // one of its people

describe("a host needs a Director of Scores", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("warned only when it hosts and has a gym; an Owner or someone new can be named; switched off counts as none", async () => {
    const deps = { pool: db.pool, now: () => new Date("2026-11-25T15:00:00Z") };
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550201', 'Olive', 'X', '4235550201'), ('5550202', 'Nate', 'X', '4235550202');
       insert into organizations (slug, name, short_name, kind) values ('high', 'High School', 'High', 'School');
       insert into org_role_types (org, role) values ('high', 'Owner'), ('high', 'Admin'), ('high', 'Director'), ('high', 'Request') on conflict do nothing;`,
    );
    await grant(db.pool, "5550201 high Owner", "5550201 high Admin", "5550201 high Director", "5550202 high Request");
    const warned = async () => (await orgMetrics(deps, olive, "high"))?.missingRoles.find((r) => r.area === "scores") ?? null;

    expect(await scorerCount(db.pool, "high")).toBeNull(); // doesn't host
    await db.pool.query("insert into org_features (org, feature, source, turned_on_by) values ('high', 'court-sync', 'setup', 't')");
    expect(await scorerCount(db.pool, "high")).toBeNull(); // no gym
    expect(await warned()).toBeNull();
    await db.pool.query("insert into gyms (name, org) values ('Main', 'high')");
    expect(await scorerCount(db.pool, "high")).toBe(0); // an Owner isn't one until named
    expect((await warned())?.options).toEqual([{ id: "5550201", name: "Olive X", me: true }]); // its staff only (Nate coaches), and yourself
    // CourtCaptain staff holding a role here see themselves, first; nobody else does.
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550209', 'Zed', 'Z', '4235550209')");
    await db.pool.query("insert into platform_admins (coach_id, granted_by, granted_at) values ('5550209', 't', now())");
    await grant(db.pool, "5550209 high Owner", "5550209 high Admin");
    const zed = { ...olive, coachId: "5550209", firstName: "Zed", lastName: "Z" };
    expect((await orgMetrics(deps, zed, "high"))!.missingRoles[0].options.map((o) => [o.name, o.me])).toEqual([["Zed Z", true], ["Olive X", false]]);
    expect((await warned())?.options.map((o) => o.name)).toEqual(["Olive X"]);
    expect(await orgMetrics(deps, nate, "high")).toBeNull(); // only Owners and Admins see it

    // Only an Admin names one; a host with no CourtPlayers or CourtEvents can too, and its Owner can be it.
    expect(await setAssigner(deps, nate, "high", "5550202", true, "scores")).toMatchObject({ ok: false });
    expect(await setAssigner(deps, olive, "high", "5550202", true, "players")).toMatchObject({ ok: false });
    expect(await setAssigner(deps, olive, "high", "5550202", true, "officials")).toMatchObject({ ok: false }); // no CourtOfficials
    expect(await setAssigner(deps, olive, "high", "5550201", true, "scores")).toEqual({ ok: true });
    expect(await scorerCount(db.pool, "high")).toBe(1);
    expect(await warned()).toBeNull();
    expect(await setAssigner(deps, olive, "high", "5550201", false, "scores")).toEqual({ ok: true });
    expect(await scorerCount(db.pool, "high")).toBe(0);
    expect(await setAssigner(deps, olive, "high", "5550202", true, "scores")).toEqual({ ok: true });
    expect(await scoresFor(db.pool, nate, "high")).toBe(true);
    expect(await scorerCount(db.pool, "high")).toBe(1);

    expect(await setDirectorRoleActive(deps, olive, "high", "scores", false)).toEqual({ ok: true });
    expect(await scorerCount(db.pool, "high")).toBe(0);
    expect(await warned()).toMatchObject({ off: true });
    expect(await setAssigner(deps, olive, "high", "5550201", true, "scores")).toMatchObject({ ok: false });
  }, 60_000);
});
