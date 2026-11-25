import { describe, expect, it } from "vitest";
import type { PublicLeague } from "./public-league";
import { cardVersion, groupCard, shareCards, type ShareInput } from "./share-cards";
import { groupKey } from "./share-keys";

const base: ShareInput = {
  org: "scenic-city",
  name: "Scenic City Basketball",
  today: "2026-11-24",
  own: [],
  leagues: [],
  teams: 0,
  counts: { teams: 0, divisions: 0, orgs: 0 },
  gyms: [],
  hosting: false,
  recruiting: [],
  openable: false,
  week: null,
};
const winter = { id: "7", name: "Winter", startsOn: "2026-12-05", endsOn: "2027-02-28", regCloses: "2027-02-14", register: true, recLimited: true, divisions: ["Boys 4th–5th", "Girls 6th–8th"] };
const keys = (h: ShareInput) => shareCards(h).map((c) => c.key);

describe("an organization's share pictures", () => {
  it("a League taking teams: registration, divisions, countdown, numbers, follow, officials", () => {
    const h = { ...base, own: [winter], counts: { teams: 110, divisions: 8, orgs: 6 }, recruiting: ["Scenic City Officials"], openable: true };
    const cards = shareCards(h);
    expect(cards.map((c) => c.key)).toEqual(["register", "divisions", "tipoff", "numbers", "follow", "officials"]);
    expect(cards[0]).toMatchObject({ href: "/register-team/scenic-city?program=7", text: "Scenic City Basketball: Winter team registration is open through Feb 14." });
    expect(cards[0].lines).toContainEqual({ text: "REC", side: "Invited organizations" });
    expect(cards[2].big).toEqual({ value: "11", label: "days to go" });
    expect(cards[3].tiles.map((t) => t.value)).toEqual([110, 8, 6]);
    expect(cards[5].text).toBe("Scenic City Officials is looking for youth basketball officials. Apply online.");
  });

  it("registration closed and under way: no registration or countdown pictures", () => {
    expect(keys({ ...base, today: "2026-12-05", own: [{ ...winter, register: false }], counts: { teams: 4, divisions: 1, orgs: 1 }, openable: true })).toEqual(["numbers", "follow"]);
  });

  it("other organizations: their teams in a League, a host's gyms; nothing to say, nothing to share", () => {
    const league = { name: "Winter", orgName: "Scenic City", startsOn: "2026-12-05" };
    expect(keys({ ...base, org: "thunder", leagues: [league], teams: 23, gyms: [{ name: "Gym", address: null, map: null }], hosting: true, openable: true })).toEqual([
      "tipoff",
      "teams",
      "follow",
      "gyms",
    ]);
    expect(keys({ ...base, leagues: [{ ...league, startsOn: "2027-06-01" }] })).toEqual([]); // too far off
    expect(keys({ ...base, gyms: [{ name: "Gym", address: null, map: null }] })).toEqual([]); // hosts nothing now
    expect(keys(base)).toEqual([]);
  });

  it("Games of the Week only with games; a changed picture gets a new version", () => {
    const t = (name: string) => ({ id: name, name, w: 2, l: 1, pi: 500 });
    const g = { day: "2026-12-12", starts: "09:00", gym: null, court: null, map: null, group: "5th Boys COMP", program: "Winter", home: t("A"), away: t("B") };
    const cards = shareCards({ ...base, week: { day: "2026-12-12", rec: [], comp: [g] } });
    expect(cards.map((c) => c.key)).toEqual(["games-comp"]);
    expect(cards[0].lines[0].text).toBe("B (2–1) at A (2–1)");
    expect(cardVersion(cards[0])).toBe(cardVersion({ ...cards[0] }));
    expect(cardVersion(cards[0])).not.toBe(cardVersion({ ...cards[0], title: "x" }));
  });

  it("a grade group's standings once a team has played, its games once published; anything else is nothing", () => {
    const team = (name: string, w: number, l: number) => ({ id: name, name, tag: "HH", pi: 500, w, l });
    const game = { starts: "10:00", gym: null, court: null, map: null, group: "5th Boys COMP", home: "Aces", away: "Bolts", homeId: "1", awayId: "2", final: null };
    const league = {
      id: "7",
      name: "Winter",
      groups: [{ label: "5th Boys COMP", division: "Boys 4th–5th", level: "COMP", grade: "5th Grade", teams: [team("Aces", 2, 0), team("Bolts", 0, 2)] }],
      schedule: [
        { date: "2026-11-21", games: [game], soon: [] },
        { date: "2026-12-05", games: [game], soon: [] },
      ],
    } as unknown as PublicLeague;
    const st = groupKey("standings", "7", "5th Boys COMP");
    const sc = groupKey("schedule", "7", "5th Boys COMP");
    expect([st, sc]).toEqual(["standings.7.5th-boys-comp", "schedule.7.5th-boys-comp"]);
    expect(groupCard("scenic-city", league, st, "2026-11-24")?.lines).toEqual([
      { text: "1. Aces", side: "2–0" },
      { text: "2. Bolts", side: "0–2" },
    ]);
    expect(groupCard("scenic-city", league, sc, "2026-11-24")).toMatchObject({ title: "Saturday, December 5", lines: [{ text: "Bolts at Aces", side: "10:00 AM" }] });
    expect(groupCard("scenic-city", league, sc, "2026-12-06")).toBeNull(); // nothing coming
    expect(groupCard("scenic-city", { ...league, schedule: null }, sc, "2026-11-24")).toBeNull(); // not published
    const fresh = { ...league, groups: [{ ...league.groups[0], teams: [team("Aces", 0, 0)] }] };
    expect(groupCard("scenic-city", fresh, st, "2026-11-24")).toBeNull();
    for (const bad of ["standings.7.nope", "x", "standings..", "rosters.7.5th-boys-comp"]) expect(groupCard("scenic-city", league, bad, "2026-11-24")).toBeNull();
  });
});
