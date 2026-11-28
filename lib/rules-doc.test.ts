import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { parseRules, plain, readRules, refreshRules } from "./rules-doc";
import { createTestDb } from "./testing/db";

const DOC = `# Scenic City League Rules {#rules}

Welcome to the **League**. Read [the guide](https://x.y).

## Game Length

- Four **8-minute** quarters
- Overtime: 2 minutes
  - Second overtime: sudden death

## Fouls & Free Throws

Bonus at the *7th* team foul.

| Grade | Press allowed |
| :---- | :---- |
| 3rd | No |

### Technical fouls

Two technicals and you're out.

#### A small heading

Stays inside.
`;

describe("A League's rules as a page", () => {
  it("Markdown's marks come off; sections by heading, with list items (indented), table rows and paragraphs", () => {
    expect(plain("**Bold** _it_ `x` [link](https://a.b) 3\\. done {#a}")).toBe("Bold it x link 3. done");
    const s = parseRules(DOC);
    expect(s.map((x) => [x.level, x.title])).toEqual([
      [1, "Scenic City League Rules"],
      [2, "Game Length"],
      [2, "Fouls & Free Throws"],
      [3, "Technical fouls"],
    ]);
    expect(s[0].blocks).toEqual([{ kind: "p", text: "Welcome to the League. Read the guide.", depth: 0 }]);
    expect(s[1].blocks).toEqual([
      { kind: "li", text: "Four 8-minute quarters", depth: 0 },
      { kind: "li", text: "Overtime: 2 minutes", depth: 0 },
      { kind: "li", text: "Second overtime: sudden death", depth: 1 },
    ]);
    expect(s[2].blocks.map((b) => [b.kind, b.text])).toEqual([
      ["p", "Bonus at the 7th team foul."],
      ["row", "Grade · Press allowed"],
      ["row", "3rd · No"],
    ]);
    expect(s[3].blocks.map((b) => b.text)).toEqual(["Two technicals and you're out.", "A small heading", "Stays inside."]);
    expect(s.map((x) => x.id)).toEqual(["scenic-city-league-rules", "game-length", "fouls-free-throws", "technical-fouls"]);
  });

  describe("read from its Google Doc", () => {
    let db: Awaited<ReturnType<typeof createTestDb>>;
    beforeAll(async () => {
      db = await createTestDb();
    }, 180_000);
    afterAll(async () => db?.drop());
    const viewer = { coachId: "5550001", firstName: "Ea", lastName: "E", isDirector: true } as unknown as SessionUser;
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = () => ({ client_email: "app@test.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    // Google, faked: a sign-in, then the Doc (or an answer like Google's when Drive is off or the Doc isn't shared).
    const google = (doc: { status: number; body: string }) =>
      (async (url: string) =>
        url.startsWith("https://oauth2.googleapis.com/token")
          ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }))
          : new Response(doc.body, { status: doc.status })) as unknown as typeof fetch;

    it("kept when refreshed; shown to anyone; clear answers when Google won't send it", async () => {
      const id = (
        await db.pool.query<{ id: string }>(
          `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by, rules_url)
           values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-01-31', 't', 't', 'https://docs.google.com/document/d/1_47RvmPehQM5Z2ZfmOcf11vvTg9j9jaLe93Bv2c11IA/edit')
           returning id::text`,
        )
      ).rows[0].id;
      const deps = (doc: { status: number; body: string }) => ({ pool: db.pool, now: () => new Date("2026-11-28T15:00:00Z"), key, fetch: google(doc) });
      expect(await readRules(db.pool, id)).toBeNull();
      expect(await refreshRules(deps({ status: 403, body: '{"error":{"status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}' }), viewer, id)).toEqual({
        ok: false,
        message: "Google Drive isn't turned on for the app's Google account yet.",
      });
      expect(await refreshRules(deps({ status: 404, body: "{}" }), viewer, id)).toMatchObject({ ok: false, message: /app@test\.iam\.gserviceaccount\.com as a Viewer/ });
      expect(await refreshRules(deps({ status: 200, body: DOC }), viewer, id)).toEqual({ ok: true, sections: 4 });
      const page = await readRules(db.pool, id);
      expect(page).toMatchObject({ name: "Winter", org: "scenic-city", updatedAt: "2026-11-28T15:00:00.000Z" });
      expect(page!.sections[1].title).toBe("Game Length");
      // No Doc link: nothing to read.
      await db.pool.query("update scenic_programs set rules_url = null where id = $1", [id]);
      expect(await refreshRules(deps({ status: 200, body: DOC }), viewer, id)).toMatchObject({ ok: false, message: /Google Doc link first/ });
    });
  });
});
