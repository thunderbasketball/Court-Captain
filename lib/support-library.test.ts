import { describe, expect, it } from "vitest";
import { FEATURES, abilitiesFrom, syncPart } from "./features";
import { AREAS } from "./org-admin";
import { articlesFor, isFor, needsMet, type For, type SupportArticle } from "./support";
import { AUDIENCES, LIBRARY, NEEDS, TOPICS } from "./support-library";

const all = LIBRARY.map((a, i): SupportArticle => ({ id: a.key, key: a.key, kind: a.kind, topic: a.topic, title: a.title, body: a.body, sort: i, audiences: [...a.who], features: [...(a.needs ?? [])], areas: [...(a.areas ?? [])], changed: false, hidden: false }));
const has = (...keys: string[]) => needsMet(new Set([...keys, "court-club", "court-facilities", "alerts"]), abilitiesFrom, syncPart).add("has-teams");
const as = (who: string[], h: Set<string>, areas: string[] = []): For => ({ who: new Set([...who, "everyone"]), has: h, areas: new Set(areas) });
const keys = (...f: For[]) => new Set(articlesFor(all, f).map((a) => a.key));

const players = has("court-players");
const league = has("court-teams", "court-sync");
const host = has("court-sync");
const club = has();

describe("Support's library", () => {
  it("every article is complete: its own key, a real topic, people, features and areas, and short enough", () => {
    expect(new Set(LIBRARY.map((a) => a.key)).size).toBe(LIBRARY.length);
    for (const a of LIBRARY) {
      expect(a.key).toMatch(/^[a-z0-9-]{2,60}$/);
      expect(TOPICS).toContain(a.topic);
      expect(a.who.length).toBeGreaterThan(0);
      for (const w of a.who) expect(AUDIENCES).toContain(w);
      for (const n of a.needs ?? []) expect(Object.keys(NEEDS)).toContain(n);
      for (const x of a.areas ?? []) expect(AREAS.map((y) => y.key)).toContain(x);
      expect(a.title.length).toBeLessThanOrEqual(120);
      expect(a.body.length).toBeLessThanOrEqual(4000);
      if (a.kind === "howto") expect(a.body.split("\n").length, a.key).toBeGreaterThan(1);
    }
  });

  it("covers every feature for those who run it, every Director's area, and every kind of person", () => {
    const admin = (h: Set<string>) => articlesFor(all, [as(["admin", "director"], h, ["*"])]);
    const sets: Record<string, Set<string>> = { "court-officials": has("court-officials"), "court-playbook": has("court-playbook"), "court-practice": has("court-practice"), "court-players": players, "court-teams": league, "court-sync": host };
    for (const f of FEATURES) {
      const without = new Set(admin(club).map((a) => a.key));
      const withIt = admin(sets[f.key] ?? club);
      if (sets[f.key]) expect(withIt.filter((a) => !without.has(a.key)).length, f.key).toBeGreaterThan(0);
    }
    for (const a of AREAS) if (a.key !== "support") expect(LIBRARY.some((x) => x.areas?.includes(a.key)), a.key).toBe(true);
    for (const w of AUDIENCES) expect(LIBRARY.some((x) => x.who.includes(w)), w).toBe(true);
    for (const n of Object.keys(NEEDS)) if (n !== "court-sync" && n !== "team-chat" && n !== "court-club") expect(LIBRARY.some((x) => x.needs?.some((y) => y === n)), n).toBe(true);
  });

  it("a coach sees coaching, by what their organization has: rosters placed (CourtPlayers) or typed in", () => {
    const thunder = keys(as(["coach"], players));
    const clubCoach = keys(as(["coach"], club));
    expect(thunder.has("roster-players") && thunder.has("evaluate") && thunder.has("book-practice") && thunder.has("set-uniforms")).toBe(true);
    expect(thunder.has("type-roster")).toBe(false);
    expect(clubCoach.has("type-roster")).toBe(true);
    for (const k of ["roster-players", "evaluate", "book-practice", "set-uniforms", "add-play"]) expect(clubCoach.has(k), k).toBe(false);
    for (const k of ["give-role", "connect-stripe", "new-league", "order-uniforms", "make-schedule", "parent-fees"]) expect(thunder.has(k), k).toBe(false);
  });

  it("parents, the public page, officials and new accounts each see theirs, never how the organization is run", () => {
    const parent = keys(as(["parent"], players));
    expect(parent.has("parent-fees") && parent.has("parent-find-team") && parent.has("follow-team")).toBe(true);
    const pub = articlesFor(all, [{ who: new Set(["public"]), has: league, areas: new Set() }]).map((a) => a.key);
    expect(pub).toContain("register-public");
    expect(pub).toContain("follow-team");
    expect(pub).not.toContain("parent-find-team"); // Scenic City has no CourtPlayers
    expect(pub).not.toContain("who-sees-me-admin");
    const official = keys(as(["official"], new Set()));
    expect(official.has("official-answer")).toBe(true);
    for (const s of [parent, new Set(pub), official, keys(as(["start"], new Set(["court-teams"])))])
      for (const k of ["give-role", "reset-login", "view-as", "enter-scores", "refunds", "org-prices"]) expect(s.has(k), k).toBe(false);
  });

  it("CourtSync: hosts, Schedulers and Officials Groups each see their own part", () => {
    const admin = (h: Set<string>) => keys(as(["admin", "director"], h, ["*"]));
    expect(admin(host).has("ask-to-host") && admin(host).has("need-scorer")).toBe(true);
    expect(admin(host).has("approve-hosts") || admin(host).has("make-schedule")).toBe(false);
    expect(admin(league).has("approve-hosts") && admin(league).has("make-schedule")).toBe(true);
    expect(admin(league).has("ask-to-host")).toBe(false);
    const group = needsMet(new Set(["court-officials", "court-sync", "alerts"]), abilitiesFrom, syncPart);
    expect(admin(group).has("officiate-league") && admin(group).has("assign-officials")).toBe(true);
    expect(admin(group).has("ask-to-host") || admin(group).has("add-team")).toBe(false);
    expect(admin(club).has("ask-to-host")).toBe(false);
    // A host school with no teams: nothing about teams, carts or invoices, but how to add one.
    const bare = new Set(host);
    bare.delete("has-teams");
    for (const k of ["cart", "invoices", "register-all", "roster-red", "team-names"]) expect(admin(bare).has(k), k).toBe(false);
    expect(admin(bare).has("add-team") && admin(bare).has("enter-scores") && admin(bare).has("ask-to-host")).toBe(true);
  });

  it("a Director sees only their areas' articles; an Owner adds the Owner's", () => {
    const teams = keys(as(["director"], players, ["teams"]));
    expect(teams.has("add-team") && teams.has("eval-teams")).toBe(true);
    for (const k of ["order-uniforms", "practice-setup", "enter-scores", "give-role", "connect-stripe"]) expect(teams.has(k), k).toBe(false);
    expect(keys(as(["director"], players, ["uniforms"])).has("order-uniforms")).toBe(true);
    expect(keys(as(["admin", "director"], players, ["*"])).has("connect-stripe")).toBe(false);
    expect(keys(as(["owner", "admin", "director"], players, ["*"])).has("connect-stripe")).toBe(true);
    // Two roles in different organizations don't mix: a coach at one isn't shown the other's features as a coach.
    expect(keys(as(["coach"], club), as(["admin", "director"], players, ["*"])).has("evaluate")).toBe(false);
    expect(isFor({ audiences: ["director"], features: [], areas: ["teams"] }, as(["director"], club, ["players"]))).toBe(false);
  });
});
