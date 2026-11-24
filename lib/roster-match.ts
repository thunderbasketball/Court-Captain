// Whether two roster entries are the same player (SPEC.md section 13, Roster conflicts), from first name, last name and date
// of birth. Pure: no database (tests cover it). Three strengths:
//   Conflict  the same first and last name and birthdate
//   Likely    the name and birthdate nearly agree (a wrong year, month and day swapped, one digit off; a nickname, one letter
//             off or the names swapped with the same birthdate)
//   Check     the same birthdate and one of the names; or the same name with a birthdate missing
// The same name with two clearly different birthdates is two players.

import { schoolYearOf } from "./eligibility";

export type Strength = "Conflict" | "Likely" | "Check";
export type Entry = { first: string; last: string; dob: string | null }; // dob: YYYY-MM-DD

// Letters only, no accents, no Jr / III.
export const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z]/g, "");

const NICKNAMES = [
  "william will bill billy liam",
  "robert rob bob bobby robbie",
  "james jim jimmy jamie",
  "john jack johnny jon",
  "jonathan jon john",
  "michael mike mikey",
  "christopher chris topher",
  "matthew matt",
  "joseph joe joey",
  "thomas tom tommy",
  "benjamin ben benny",
  "samuel sam sammy",
  "nicholas nick nico",
  "alexander alex xander lex",
  "alexandra alex allie lexi",
  "elizabeth liz lizzy beth eliza ellie libby",
  "katherine kate katie kat kathryn catherine",
  "isabella bella izzy",
  "madison maddie maddy",
  "madeline maddie maddy",
  "abigail abby",
  "samantha sam",
  "zachary zach zack",
  "joshua josh",
  "daniel dan danny",
  "david dave davey",
  "andrew drew andy",
  "anthony tony",
  "charles charlie chuck",
  "jacob jake",
  "nathaniel nate nathan",
  "edward eddie ed teddy",
  "theodore theo teddy",
  "gabriel gabe",
  "timothy tim",
  "kenneth ken kenny",
  "cameron cam",
  "maxwell max",
  "oliver ollie",
  "jackson jack jax",
  "patrick pat",
  "richard rich rick ricky",
  "stephen steve steven",
].map((g) => g.split(" "));
const nickname = (a: string, b: string) => a !== b && NICKNAMES.some((g) => g.includes(a) && g.includes(b));

// One letter added, missing, different, or two next to each other swapped (names of 4 letters or more).
export function oneOff(a: string, b: string): boolean {
  if (a === b || Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

const monthDay = (d: string) => d.slice(5);
const dayMonth = (d: string) => `${d.slice(8)}-${d.slice(5, 7)}`;
const digitsOff = (a: string, b: string) => [...a].filter((x, i) => x !== b[i]).length;

// Why they look like the same player, or null.
export function matchPlayers(a: Entry, b: Entry): { strength: Strength; why: string } | null {
  const [af, al, bf, bl] = [normName(a.first), normName(a.last), normName(b.first), normName(b.last)];
  if (!af || !al || !bf || !bl) return null;
  const sameF = af === bf;
  const sameL = al === bl;
  const both = !!a.dob && !!b.dob;
  const sameD = both && a.dob === b.dob;
  if (sameF && sameL) {
    if (sameD) return { strength: "Conflict", why: "Same name and birthdate" };
    if (!both) return { strength: "Check", why: "Same name; a birthdate is missing" };
    if (monthDay(a.dob!) === monthDay(b.dob!)) return { strength: "Likely", why: "Same name, month and day; the year is different" };
    if (a.dob!.slice(0, 4) === b.dob!.slice(0, 4) && monthDay(a.dob!) === dayMonth(b.dob!)) return { strength: "Likely", why: "Same name; month and day swapped" };
    if (digitsOff(a.dob!, b.dob!) === 1) return { strength: "Likely", why: "Same name; birthdate one digit off" };
    return null;
  }
  if (!sameD) return null;
  if (sameL && nickname(af, bf)) return { strength: "Likely", why: "Same last name and birthdate; a nickname" };
  if (af === bl && al === bf) return { strength: "Likely", why: "Same birthdate; first and last name swapped" };
  if ((sameL && oneOff(af, bf)) || (sameF && oneOff(al, bl))) return { strength: "Likely", why: "Same birthdate; a name one letter off" };
  if (sameF) return { strength: "Check", why: "Same birthdate and first name" };
  if (sameL) return { strength: "Check", why: "Same birthdate and last name (possible twins)" };
  return null;
}

export type TeamFacts = { teamId: string; orgKey: string; divisionId: string; level: string };

// A player may be on two teams only in the same organization, in different divisions, and never REC and COMP. What's wrong
// with these two (empty: allowed).
export function rulesBroken(a: TeamFacts, b: TeamFacts): string[] {
  if (a.teamId === b.teamId) return ["Listed twice on the same team"];
  return [
    ...(a.level !== b.level ? ["REC and COMP"] : []),
    ...(a.orgKey !== b.orgKey ? ["Different organizations"] : []),
    ...(a.divisionId === b.divisionId ? ["Same division"] : []),
  ];
}

// What to tell someone entering it, or null. `today`: YYYY-MM-DD.
export function birthdateWarning(dob: string | null, grade: number | null, today: string): string | null {
  const odd = oddBirthdate(dob, grade, schoolYearOf(today));
  return odd ? `${odd}: that can't be right. Check the birthdate.` : null;
}

// A birthdate that can't be right for the grade (K = 0): more than 3 years off the usual age, or no such player yet. Null:
// fine, or nothing to go on. `schoolYear`: the fall it starts (2026 for 2026/27).
export function oddBirthdate(dob: string | null, grade: number | null, schoolYear: number): string | null {
  if (!dob) return null;
  const year = Number(dob.slice(0, 4));
  if (year > schoolYear - 3) return `Born ${year}`;
  if (grade !== null && Math.abs(schoolYear - year - (grade + 6)) > 3) return `Born ${year}, ${grade === -1 ? "Pre-K" : grade === 0 ? "K" : `grade ${grade}`}`;
  return null;
}
