import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AREAS } from "./org-admin";
import type { For } from "./support";
import { AUDIENCES, NEEDS } from "./support-library";
import { createTestDb } from "./testing/db";
import { RELEASES, VERSION, newer, type Release } from "./whats-new";
import { markSeen, newsFor, releasesFor } from "./whats-new-seen";

const as = (who: string[], has: string[] = [], areas: string[] = []): For => ({ who: new Set(who), has: new Set(has), areas: new Set(areas) });

describe("versions", () => {
  it("newest first, each complete, and the app's own version matches", () => {
    for (let i = 1; i < RELEASES.length; i++) expect(newer(RELEASES[i - 1].version, RELEASES[i].version)).toBe(true);
    expect(JSON.parse(readFileSync("package.json", "utf8")).version).toBe(`${VERSION}.0`);
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+$/);
      expect(["major", "minor"]).toContain(r.kind);
      if (r.version.endsWith(".0")) expect(r.kind).toBe("major");
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Set(r.items.map((x) => x.key)).size).toBe(r.items.length);
      for (const x of r.items) {
        expect(x.purpose.length > 20 && x.how.length > 0 && x.who.length > 0, x.key).toBe(true);
        for (const w of x.who) expect(AUDIENCES).toContain(w);
        for (const n of x.needs ?? []) expect(Object.keys(NEEDS)).toContain(n);
        for (const a of x.areas ?? []) expect(AREAS.map((y) => y.key)).toContain(a);
      }
    }
    expect([newer("1.10", "1.9"), newer("2.0", "1.99"), newer("1.0", "1.0"), newer("1.0", null)]).toEqual([true, true, false, true]);
  });

  it("each person sees only their changes; a version with none of theirs isn't there", () => {
    const item = (key: string, who: Release["items"][number]["who"], needs?: Release["items"][number]["needs"]) => ({ key, title: key, purpose: "p", how: ["h"], who, needs });
    const list: Release[] = [
      { version: "1.1", kind: "minor", date: "2026-12-01", title: "t", items: [item("a", ["owner"])] },
      { version: "1.0", kind: "major", date: "2026-11-25", title: "t", items: [item("b", ["coach", "owner"]), item("c", ["coach"], ["court-playbook"])] },
    ];
    const keys = (f: For) => releasesFor([f], list).map((r) => `${r.version}:${r.items.map((x) => x.key)}`);
    expect(keys(as(["coach"]))).toEqual(["1.0:b"]);
    expect(keys(as(["coach"], ["court-playbook"]))).toEqual(["1.0:b,c"]);
    expect(keys(as(["owner"]))).toEqual(["1.1:a", "1.0:b"]);
    expect(keys(as(["official"]))).toEqual([]);
  });

  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("highlighted until they open it, still there the rest of that login, then only in Support; never for a newer login", async () => {
    let now = new Date("2026-11-26T15:00:00Z");
    const deps = { pool: db.pool, now: () => now };
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell, created_at, last_login_at) values
         ('5550301', 'Cy', 'X', '4235550301', '2026-11-01', '2026-11-26T14:00:00Z'), ('5550302', 'Newt', 'X', '4235550302', '2027-01-01', '2027-01-01')`,
    );
    const coach = [as(["coach"])];
    expect(await newsFor(deps, "5550301", coach)).toMatchObject({ fresh: releasesFor(coach).filter((r) => !r.history).map((r) => r.version), highlight: true, show: true });
    await markSeen(deps, "5550301");
    expect(await newsFor(deps, "5550301", coach)).toMatchObject({ fresh: [], highlight: false, show: true }); // this login
    now = new Date("2026-11-30T15:00:00Z");
    await db.pool.query("update users set last_login_at = '2026-11-30T15:00:00Z' where coach_id = '5550301'");
    const later = await newsFor(deps, "5550301", coach);
    expect(later).toMatchObject({ highlight: false, show: false });
    expect(later.releases.length).toBe(releasesFor(coach).length); // still in Support
    if (!RELEASES.some((r) => r.date > "2027-01-01")) expect(await newsFor(deps, "5550302", coach)).toMatchObject({ highlight: false, show: false });
    expect(await newsFor(deps, "5550301", [as(["nobody"])])).toMatchObject({ releases: [], show: false });
    expect(await newsFor(deps, "0000000", coach)).toMatchObject({ show: false });
  }, 60_000);
});
