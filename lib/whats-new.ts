// The app's versions and what's new in each (SPEC.md section 14), newest first. Every change a person would notice gets an
// item here, for the people and features it's for (as in lib/support-library.ts), with what it's for and how to use it.
// A major version (2.0) is a big change to how people work; a minor one (1.1) adds or improves something. Pushing to the live
// site: a new version for what's new since the last push, its date, and package.json's version to match.
// What people see once here isn't edited away: a later version says what changed. Everything so far is Version 1; `history`:
// revisions written up afterwards, never highlighted as new.
import type { Audience, Need } from "./support-library";

export type NewsItem = {
  key: string;
  title: string;
  purpose: string; // what it's for
  how: readonly string[]; // how to use it, step by step
  who: readonly Audience[];
  needs?: readonly Need[];
  areas?: readonly string[];
};
export type Release = { version: string; kind: "major" | "minor"; date: string; title: string; history?: true; items: readonly NewsItem[] };

const managers = ["director", "admin", "owner"] as const;
const everyoneIn = ["coach", "staff", "parent", "official", ...managers] as const;

export const RELEASES: readonly Release[] = [
  {
    version: "1.18",
    kind: "minor",
    date: "2026-11-27",
    title: "Rosters complete; COMP schedules when they're due",
    items: [
      {
        key: "rosters-complete",
        title: "How many rosters are complete",
        purpose: "See at a glance how many teams still have roster work to do, and where: the League by each organization, any other organization by grade.",
        how: [
          "Open Home: it's under the coaches percentage at the top.",
          "A roster is complete with no roster warning: it has players, each with a birthdate and a number, and no number twice.",
          "Tap it to see each organization's (or grade's), the fewest complete first.",
        ],
        who: ["admin", "owner"],
      },
      {
        key: "comp-due-6-days",
        title: "COMP schedules listed when they're due",
        purpose: "A COMP schedule is due 6 days before its Game Day, so To Do no longer lists it earlier.",
        how: ["Home → To Do → Schedules not published shows a Game Day's COMP from 6 days before it; REC as before."],
        who: managers,
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
    ],
  },
  {
    version: "1.17",
    kind: "minor",
    date: "2026-11-27",
    title: "Drag to place, extra games shown",
    items: [
      {
        key: "game-days-card",
        title: "Game Days card",
        purpose: "Everything for each Game Day in one place: the League's rules, scoresheets to print, the schedule at your gyms and your teams' games.",
        how: [
          "Open Home → Game Days.",
          "League rules: read them right there, or tap Print.",
          "Each Game Day is its own card: At our gyms (the schedule at your hosting gyms) and Our teams by grade.",
          "From the Friday before, Print scoresheets shows for each of your gyms with games.",
        ],
        who: ["director", "admin", "owner"],
        needs: ["has-teams"],
        areas: ["teams", "facilities"],
      },
      {
        key: "rules-link",
        title: "League rules as a link",
        purpose: "Directors of Programs can give the League's rules as a Google Doc link instead of a PDF; organizations read it on their Game Days card and print it as a PDF.",
        how: ["Programs → the League → its gear → Rules → Or a link to the rules.", "Share the Google Doc as \"Anyone with the link can view\"."],
        who: ["director", "admin", "owner"],
        needs: ["court-teams"],
        areas: ["programs"],
      },
      {
        key: "drag-to-place",
        title: "Drag to move: taps only show",
        purpose: "No more games or teams moved by a stray tap, on the Grid or in Matchups.",
        how: [
          "Grid: tap a game to see where it fits; drag it to the slot to place it.",
          "Matchups: tap a team to see who it already plays; drag it to move or swap it (or onto the other side of its game to switch home and away).",
          "On a phone, press and hold, then slide.",
        ],
        who: ["director", "admin", "owner"],
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "play-in-level",
        title: "Move a team between REC and COMP",
        purpose: "The League can place a registered team in REC or COMP, not just another division or grade, without changing the team.",
        how: ["League → Teams → open the team (↗) → Play in another division.", "Pick a REC or COMP pool (each choice says which), give the reason, Save. Its games that day are shown first, then become Games to correct.", "Matchups, the Grid and publishing then treat it as the level it plays in."],
        who: ["director", "admin", "owner"],
        needs: ["court-teams"],
        areas: ["teams"],
      },
      {
        key: "home-percent",
        title: "Home share on the matchup cards",
        purpose: "See how often each team is home this season, so home games stay fair.",
        how: ["The home team's badge shows its share of home games this season (\"66% H\").", "An away team that can host but is home in under 25% of its games gets a red badge (\"20% H\"). Only teams whose school or organization has a court open that day for their division show a share."],
        who: ["director", "admin", "owner"],
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "grade-first",
        title: "Teams play their own grade first",
        purpose: "Create matchups pairs each team with every team in its grade, twice over the season, before it's paired with another grade.",
        how: ["Create REC or COMP matchups as before.", "A third game against the same team still comes after playing another grade."],
        who: ["director", "admin", "owner"],
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "tag-scenic-city",
        title: "@ScenicCityBBall in every game you share",
        purpose: "Shared games and finals tag the League on Instagram.",
        how: ["Tap a game's or final's share icon, then Share picture.", "The caption, with @ScenicCityBBall, is copied: paste it into your Instagram post (Instagram doesn't let apps add it themselves)."],
        who: ["coach", "staff", "parent", "director", "admin", "owner"],
      },
      {
        key: "extra-game-dates",
        title: "Extra games on the matchup cards",
        purpose: "See at a glance which teams already played an extra game, and when, before picking another fill-in.",
        how: ["Open a division in Matchups: a team that filled in for a TBD shows \"Extra game: Dec 5\" in purple under its name."],
        who: ["director", "admin", "owner"],
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
    ],
  },
  {
    version: "1.16",
    kind: "minor",
    date: "2026-11-26",
    title: "Schedulers schedule; Matchups at a glance",
    items: [
      {
        key: "schedulers-only",
        title: "Only Directors of Scheduling change the schedule",
        purpose: "Admins and Owners still see every scheduling page, view only, so the schedule changes in one set of hands.",
        how: ["Directors of Scheduling: nothing changes for you.", "Admins and Owners: open the Scheduler or Scheduler View to look; it says View only, and its buttons are off.", "To schedule, an Owner or Admin gives themselves the Scheduling area as a Director."],
        who: ["admin", "owner", "director"],
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "game-day-picture",
        title: "Hype a game: Game Day pictures",
        purpose: "Share any upcoming game as a picture: both teams with their organizations' logos, home and away, the day, time and gym, and the League.",
        how: [
          "Find the game: a public page's schedule, a team you follow, or (coaches) your team page's Next 10 days and Games.",
          "Tap the share icon at the right of the game, then Share picture (Instagram, Facebook, X or Messages) or Save picture.",
          "It shows once the game has a time and its day is published, until it's played.",
        ],
        who: ["coach", "staff", "parent", "director", "admin", "owner"],
      },
      {
        key: "delete-team-in-card",
        title: "Delete team moved",
        purpose: "Delete team is now inside Edit team, instead of at the bottom of the team's page.",
        how: ["Open the team and tap Edit team (Edit on the League's Teams page).", "Delete team is at the bottom, below Save."],
        who: ["director", "admin", "owner"],
        needs: ["has-teams"],
        areas: ["teams"],
      },
      {
        key: "public-teams-by-grade",
        title: "Teams by grade on your public page",
        purpose: "Families find their team faster: your public page groups teams in a card per gender and grade (Coed, Boys, then Girls, youngest first).",
        how: ["Open your public page (tap your logo) and its Teams card.", "Open one (Boys · 3rd grade) to see its teams; ☆ still follows a team on this phone."],
        who: ["coach", "staff", "parent", "director", "admin", "owner"],
      },
      {
        key: "division-cards",
        title: "Matchups by division, at a glance",
        purpose: "Each division's card says how it's going, youngest first, and only one is open at a time.",
        how: [
          "Open Matchups: divisions are in grade order. Opening one moves it to the bottom, below the others.",
          "Green: every matchup made and every game scheduled. Red: something to look at (a TBD, games at the same time for a team or coach, games to correct, teams short of games).",
          "Teams playing an extra game are listed on the card.",
          "Create REC or COMP matchups inside each division; only the button you press says Working….",
          "A team with two games that day is home in both or away in both when matchups are created.",
          "A TBD's Pick a team lists only teams of the same gender a grade above or below at most (REC or COMP), never one it already plays this season.",
        ],
        who: ["director", "admin", "owner"],
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
    ],
  },
  {
    version: "1.15",
    kind: "minor",
    date: "2026-11-26",
    title: "Smarter scheduling and roster warnings",
    items: [
      {
        key: "smart-scheduler",
        title: "Place games faster",
        purpose: "Each game waits under the gym that should host it, and the slots it fits in light up green, so you don't hunt for where it can go.",
        how: [
          "Open the Scheduler's Grid, or tap Scheduler View by your name.",
          "Each gym lists its host's home games. A host with more than one gym has each game under the gym whose courts take its division and that has the most room.",
          "Tap or drag a game: green slots fit at the home team's gym, amber ones fit at another host's gym, red ones can't (why shows in the slot). A game with no home gym leaves the slots it fits white.",
          "A game with no home gym is suggested at one gym whose courts take it, where its coach or team already plays that day when there is one.",
          "TBD stands out in yellow, with a dashed outline.",
          "A team or coach at another gym: back to back is red (not allowed), one game's break yellow, two or more green.",
          "The games causing it are outlined in pink, tagged Same team or Same coach.",
          "Every change in Matchups (a drag, a swap, a team picked for a TBD) is saved at once, and the Grid shows it right away.",
          "Times a team asked not to play (schedule requests) show red too. If a drop is ever refused, the reason shows at the bottom of the screen.",
        ],
        who: managers,
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "conflict-why",
        title: "Players on two rosters: why it isn't allowed",
        purpose: "When a player looks like they're on two rosters against the League's rules, the organization, the coaches and the player's family see it, with the rule in plain words.",
        how: [
          "Organizations: Home → To Do → Roster conflicts. Each one says why it isn't allowed.",
          "Coaches: the red warning at the top of your team page, with why and how to fix it.",
          "Families: a red note on your player's team card, under Your players.",
          "Each one names the other organization and team.",
        ],
        who: [...managers, "coach", "staff", "parent"],
      },
      {
        key: "host-half",
        title: "Home games balanced in each division",
        purpose: "In every division, about half of each hosting organization's teams' games are at home, even when its gym only takes some divisions.",
        how: ["Create REC matchups, then Create COMP matchups, as before.", "Look for the green H: each host's teams in a division should be home about half the time."],
        who: managers,
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "switch-home",
        title: "Switch home and away",
        purpose: "Make the other team home in a matchup when you know better.",
        how: ["Open the Game Day's Matchups.", "Drag one team onto the other side of the same game, its opponent or TBD (or tap one, then the other). It shows at once.", "It's saved at once, with who did it. A game already on the Grid stays put: move it to the new home team's gym if needed."],
        who: managers,
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "play-in",
        title: "Place a team in another division",
        purpose: "When a team needs to play up a grade, or a Girls team needs to play with the Boys, the League places it there without changing the team. Organizations change anything about their own teams; a registered team's division only changes when the League moves it.",
        how: ["League → Teams → open the team (↗) → Play in another division.", "Pick where it plays and say why. Its organization sees \"Plays in …\" with the reason.", "Pick its own division to put it back."],
        who: managers,
        needs: ["court-teams"],
        areas: ["teams"],
      },
      {
        key: "coed-division",
        title: "Coed divisions",
        purpose: "Make a division Coed so Boys and Girls teams of those grades play together.",
        how: ["Programs → the League → a division.", "Set Division for to Coed (Boys and Girls). Its teams stay."],
        who: managers,
        needs: ["court-teams"],
        areas: ["programs"],
      },
      {
        key: "busy-coaches",
        title: "Coaches on more than 2 teams",
        purpose: "A warning when one of your Head or Assistant Coaches is on 3 or more of your teams, so you can check they can make every game and practice.",
        how: ["Open Home → To Do, or Teams → Warnings.", "Each coach is listed with their teams; tap a team to open it."],
        who: ["admin", "owner", "director"],
        needs: ["has-teams"],
        areas: ["teams"],
      },
      {
        key: "warnings-that-apply",
        title: "Only the warnings that apply",
        purpose: "Teams → Warnings lists only the warnings catching something right now.",
        how: ["Open Teams → Warnings. Nothing to fix shows \"No warnings right now ✓\"."],
        who: ["admin", "owner", "director"],
        needs: ["has-teams"],
        areas: ["teams"],
      },
      {
        key: "coach-use-breakdown",
        title: "Coaches' use, by organization or team",
        purpose: "See where coaches aren't using the app yet: the League by each organization, any other organization by each team.",
        how: ["Open Home and tap the coaches percentage at the top.", "The fewest using are listed first."],
        who: ["admin", "owner"],
      },
    ],
  },
  {
    version: "1.14",
    kind: "major",
    date: "2026-11-25",
    title: "Support for everyone, public pages and parents' teams",
    items: [
      {
        key: "support",
        title: "Support made for you",
        purpose: "Answers and step-by-step guides for what you do, by your role and your organization's features. It's on every page now.",
        how: ["Tap ? Support at the top, or the Support card.", "Pick Questions or How to, or search.", "Can't find it? Start a chat under Chats."],
        who: everyoneIn,
      },
      {
        key: "whats-new",
        title: "What's New",
        purpose: "Each time the app changes for you, this says what changed, why, and how to use it.",
        how: ["A yellow What's New card, just above Support, shows when there's something new.", "Later, find every version in Support, under What's New."],
        who: everyoneIn,
      },
      {
        key: "public-page",
        title: "A new public page for your organization",
        purpose: "Draw interest: a banner in your color, season numbers, programs, teams, gyms and help for parents. No login needed, and never any contact information.",
        how: ["Tap your logo at the top to see it.", "Share it with the share icon by your organization's name.", "On a phone, Log in is one row under the banner."],
        who: [...managers, "coach", "staff"],
      },
      {
        key: "share-news",
        title: "Pictures to share on social media",
        purpose: "Post about your season in seconds: registration, the countdown, standings, schedules and more, in your colors and always up to date.",
        how: ["Open your public page and swipe through Share the news.", "Tap a picture, then Share picture.", "Pick Instagram, Facebook, X or Messages, or Save picture."],
        who: [...managers, "coach", "staff", "parent"],
      },
      {
        key: "share-final",
        title: "Final scores you can see and share",
        purpose: "Families can see each final on the public page and share it as a picture.",
        how: ["Open the public page and find the game (My teams, Teams or Schedule).", "Tap the share icon by the Final. It appears 10 minutes after the score is entered."],
        who: everyoneIn,
      },
      {
        key: "league-gyms",
        title: "The League's gyms",
        purpose: "Every gym the League plays in, with its address, Directions and host, and its game dates once published.",
        how: ["Open the League on a public page.", "Open Gyms and tap Directions."],
        who: ["coach", "staff", "parent", "official", ...managers],
      },
      {
        key: "league-columns",
        title: "More of the League at a glance",
        purpose: "On a computer, divisions, grades, games and gyms use the whole screen in columns.",
        how: ["Open the League and its Teams.", "Open a division, then REC or COMP, then a grade: Standings beside the Schedule.", "← Back returns you to where you came from."],
        who: ["coach", "staff", "parent", ...managers],
      },
      {
        key: "new-teams-only",
        title: "Register is for new teams; find yours first",
        purpose: "Keeps a team its organization already manages from being registered twice.",
        how: ["Open Register new teams on the League's page.", "Type the coach's last name: teams show as you type.", "Tap a team for its public view, and contact its organization for help.", "Only a new team taps My team is new."],
        who: [...managers, "coach"],
      },
      {
        key: "uniform-follows",
        title: "A uniform follows its player",
        purpose: "A player who changes teams keeps their number, size and order, so they aren't ordered a second uniform.",
        how: ["Move the player as usual; their uniform moves with them.", "Uniforms shows the order, and the team it was for.", "Really need a new one? Tick Needs a uniform on the team's Uniforms."],
        who: ["coach", "staff", ...managers],
        needs: ["uniforms"],
        areas: ["uniforms", "teams", "players"],
      },
      {
        key: "parent-view",
        title: "See what a parent sees",
        purpose: "Help a family with exactly what they see: their player's team, staff, practices, games and help, even before they've logged in.",
        how: ["Open a team's Roster and tap a player.", "Tap 👁 by a parent: it opens right there, view only.", "Coaches see that parent's players on their own team; Directors and Admins see the whole family."],
        who: ["coach", ...managers],
        needs: ["court-players"],
        areas: ["teams", "players"],
      },
      {
        key: "order-spares",
        title: "Order spare uniforms",
        purpose: "Order extra uniform sets, jerseys, shooting shirts or shorts from the vendor without adding a player.",
        how: ["Open Home → Uniforms and tap Order Spares, top right of the vendor.", "Pick what you need and how many, then each number and size (shorts: how many of each size).", "Tap Add to the next order: they go with it when you Email the vendor."],
        who: managers,
        needs: ["uniforms"],
        areas: ["uniforms"],
      },
      {
        key: "director-of-scores",
        title: "Hosts need a Director of Scores",
        purpose: "Every organization that hosts games must have someone to enter its scores. Home's To Do warns until you do.",
        how: ["Open Home → To Do → No Director of Scores.", "Pick a person (an Owner or Admin is fine) and tap Make Director of Scores."],
        who: ["admin", "owner"],
        needs: ["sync-host"],
      },
      {
        key: "director-of-scheduling",
        title: "Events need a Director of Scheduling",
        purpose: "An organization that runs events must have someone to make and publish its schedule. Home's To Do warns until you do.",
        how: ["Open Home → To Do → No Director of Scheduling.", "Pick a person (an Owner or Admin is fine) and tap Make Director of Scheduling."],
        who: ["admin", "owner"],
        needs: ["court-teams"],
      },
      {
        key: "duplicate-numbers",
        title: "Duplicate uniform numbers are warned",
        purpose: "Two players on a team with the same number now show in red, so it's fixed before game day.",
        how: ["Look for DUPLICATE NUMBERS on the team, and the red number on its Roster.", "Change one on the team's Uniforms or Roster (unlock it first if it was already ordered)."],
        who: ["coach", "staff", ...managers],
        areas: ["teams", "uniforms", "programs"],
      },
      {
        key: "dup-blocked",
        title: "Duplicate numbers can't be ordered",
        purpose: "No one gets a uniform with a teammate's number.",
        how: ["Uniforms holds both players back, marked duplicate number.", "Change one number on the team's Uniforms; both then go in the next order."],
        who: managers,
        needs: ["uniforms"],
        areas: ["uniforms"],
      },
      {
        key: "family-teams",
        title: "Your players' teams",
        purpose: "Everything for your player's team in one place: what's coming, the whole schedule, the staff, the roster and the Parents chat.",
        how: ["Log in with the cell on your player's registration and confirm your email.", "Tap your name: My dashboard has a card for each player, with their team on it.", "Tap ✓ or ✗ to say whether your player is coming.", "💬 at the top is the Parents chat."],
        who: ["parent"],
        needs: ["court-players"],
      },
      {
        key: "families-list",
        title: "Parents' logins are under Families",
        purpose: "Staff lists only staff. A parent who logs in is connected to their players' teams by the cell on the registration.",
        how: ["Open Members → Families, or a player under Members → Players.", "A parent's chip says Login ✓ verified, or not verified.", "Admins: 👁 opens the app as them; Reset login is beside it."],
        who: managers,
        needs: ["court-players"],
        areas: ["players", "teams"],
      },
      {
        key: "pick-staff",
        title: "Directors are picked from your staff",
        purpose: "Choosing a Director of Scores or Scheduling lists yourself first, then your Owners, Admins and Directors.",
        how: ["Home → To Do, or Members → Staff and +.", "Pick Myself or someone on staff; for anyone else pick New person and enter their cell."],
        who: ["admin", "owner"],
      },
      {
        key: "create-by-level",
        title: "Create REC and COMP matchups separately",
        purpose: "Make one level's matchups for a Game Day without touching the other's.",
        how: ["Scheduler → the Game Day → Matchups.", "Tap Create REC matchups or Create COMP matchups, for every division or inside one."],
        who: managers,
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "team-moves",
        title: "Changing a team's grade or level warns about its games",
        purpose: "A registered team goes straight to its new division, and no game is left wrong without someone knowing.",
        how: ["Once a team is registered, only the League changes its gender, grade or level: League → Teams, Edit or Change grade or level.", "Its games that will need correcting are listed first. Change it anyway, or go back.", "Games to correct flashes on Home → To Do and the Scheduler, and the games are red, until each is fixed.", "Put TBD in the team's place, or Remove the game (unpublish that level for the day first)."],
        who: managers,
        needs: ["court-teams"],
        areas: ["teams", "programs", "scheduling"],
      },
      {
        key: "coach-use",
        title: "How many coaches use the app",
        purpose: "The share of your coaches who used the app in the last 7 days, at a glance.",
        how: ["Open Home: it's at the top.", "Coaches' use of the app, below, lists who hasn't been on."],
        who: ["admin", "owner"],
      },
      {
        key: "host-balance",
        title: "Home games shared evenly among hosts",
        purpose: "Organizations that host get home games as even as possible over the whole Game Day, within their open court times. A team whose organization doesn't host visits one that does.",
        how: ["Create REC matchups, then Create COMP matchups: each is made youngest to oldest.", "Every team that day is looked at. A host with fewer open slots, or courts only for some divisions, gets fewer.", "Games wait to be placed in the same order: REC first, then COMP."],
        who: managers,
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "fill-tbd",
        title: "Fill in a TBD, clear a division, empty a gym",
        purpose: "Fix a Game Day quickly without starting over.",
        how: ["In a TBD slot, pick any team playing that day, of any level, grade or division. Teams that already filled in are last, with when.", "Or drag TBD into the New game box and pick both teams.", "Clear REC or Clear COMP matchups in a division clears the ones not on the grid.", "Unschedule all on a gym takes its games off the grid; the matchups stay."],
        who: managers,
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "scheduler-view",
        title: "Scheduler View",
        purpose: "A Game Day on your whole screen: matchups beside every gym's courts, with the numbers and Publish at the top.",
        how: ["Tap Scheduler View by your name.", "Pick the Game Day; drag games onto the courts.", "« Hide the lists gives the courts the whole screen."],
        who: managers,
        needs: ["court-teams"],
        areas: ["scheduling"],
      },
      {
        key: "conflicts-home",
        title: "Roster conflicts open on Home, with why one is allowed",
        purpose: "See both entries side by side, decide right there, and see players on two rosters who are allowed and why.",
        how: ["Open Home → To Do → Roster conflicts.", "Tap Different players, or Allow it and say why (the teams see it).", "Allowed lists the rest, within the rules or by the League."],
        who: ["admin", "owner"],
        needs: ["court-teams"],
      },
      {
        key: "our-conflicts",
        title: "Told when your players are on two rosters",
        purpose: "You see the League's roster conflicts for your teams: not allowed is a warning, allowed is just noted with why. Another organization's player isn't named.",
        how: ["Open Home → To Do → Roster conflicts, or Teams → Warnings. The team's page says so too.", "Tap a team to open its roster.", "Not allowed: take the player off one roster, fix a wrong name or birthdate, or ask the League."],
        who: ["coach", "staff", ...managers],
        needs: ["has-teams"],
        areas: ["teams", "programs"],
      },
    ],
  },
  // ---- Documented afterwards, from what was built when (never highlighted) ----
  {
    version: "1.13",
    kind: "minor",
    date: "2026-11-24",
    title: "Cart, invoices and cleaner rosters",
    history: true,
    items: [
      { key: "cart", title: "Shopping cart and invoices", purpose: "Register several teams and pay for them together, or ask for an invoice.", how: ["Add to cart on each team, then open the cart.", "Pay by card, or Request an invoice where the League allows it.", "Home → Invoices shows what's due."], who: ["coach", ...managers], needs: ["has-teams"], areas: ["teams"] },
      { key: "locked-rosters", title: "League rosters lock at the first game", purpose: "Everyone plays with the roster they started with.", how: ["Open a team: League roster shows the locked list.", "Ask the League to fix a mistake after it's locked."], who: ["coach", "staff", ...managers], needs: ["has-teams"], areas: ["teams", "programs"] },
      { key: "conflicts", title: "Roster conflicts and warnings", purpose: "Finds a player on two of a League's teams, and birthdates that can't be right.", how: ["Adding a player says if they're on another team.", "The League's Roster conflicts card lists them all."], who: managers, areas: ["programs", "teams"] },
      { key: "publish-levels", title: "REC and COMP published separately", purpose: "Families see each level's schedule as soon as it's ready.", how: ["Scheduler: publish REC, COMP or both for a Game Day.", "A published game can't be moved."], who: managers, needs: ["court-teams"], areas: ["scheduling"] },
      { key: "faster", title: "Faster pages", purpose: "The header and each part of a page show as soon as they're ready.", how: ["Nothing to do."], who: everyoneIn },
    ],
  },
  {
    version: "1.12",
    kind: "major",
    date: "2026-11-22",
    title: "Online payments",
    history: true,
    items: [
      { key: "pay", title: "Pay registration fees by card", purpose: "Card, Apple Pay or Google Pay, straight to the League's own account.", how: ["Register a team and pay right there.", "A receipt is emailed; the team is registered once it's paid."], who: ["coach", ...managers], needs: ["has-teams"], areas: ["teams"] },
      { key: "refund", title: "Refunds on the registration", purpose: "A League's Owners send a refund where the payment is, and can cancel the registration with it.", how: ["Open the League's Registrations and the team.", "Under Fee, tap Refund."], who: ["owner"], needs: ["court-teams"] },
      { key: "schedule-requests", title: "Schedule requests", purpose: "Teams tell the League which times they can't play.", how: ["Open your team and its League program.", "Check the times, before requests close."], who: ["coach", ...managers], needs: ["has-teams"], areas: ["teams", "scheduling"] },
      { key: "fastbreak", title: "FastBreak teams and Import players", purpose: "Outside clubs' teams and whole rosters come in without retyping.", how: ["Teams: + Import, paste a list, and say what each column holds."], who: ["coach", ...managers], needs: ["typed-rosters"], areas: ["teams"] },
    ],
  },
  {
    version: "1.11",
    kind: "minor",
    date: "2026-11-20",
    title: "Public pages and Find my player",
    history: true,
    items: [
      { key: "find-player", title: "Find my player's team", purpose: "A parent finds their player's team with their cell and an emailed code, no login.", how: ["Open the League's or organization's public page.", "Tap Find my player and enter your cell, then the code."], who: ["parent", "coach", "staff", ...managers], needs: ["court-players"] },
      { key: "register-form", title: "One Register form", purpose: "An outside organization registers all its teams together.", how: ["Open the League's public page → Register.", "+ Add another team for each one."], who: ["coach", ...managers], needs: ["has-teams"], areas: ["teams"] },
    ],
  },
  {
    version: "1.10",
    kind: "minor",
    date: "2026-11-15",
    title: "CourtPlaybook, programs by type and email tools",
    history: true,
    items: [
      { key: "playbook", title: "CourtPlaybook", purpose: "Draw plays, watch them move, and share them with your team or organization.", how: ["Open a team's Playbook and tap +.", "Draw, then Play to watch it; pick who sees it."], who: ["coach", ...managers], needs: ["court-playbook"] },
      { key: "program-types", title: "Programs by type", purpose: "Seasons, training, Leagues, tournaments and more, each with its own fees and options.", how: ["Home → Programs and +."], who: managers, areas: ["programs", "players"] },
      { key: "email-tools", title: "Email and Copy emails", purpose: "Email coaches, staff or parents from your app, Gmail, or by pasting.", how: ["Tap ✉️ on a team or the Teams card's 📣."], who: ["coach", "staff", ...managers], areas: ["teams"] },
    ],
  },
  {
    version: "1.9",
    kind: "minor",
    date: "2026-11-13",
    title: "Officials and scrimmages",
    history: true,
    items: [
      { key: "officials", title: "CourtOfficials", purpose: "Officials groups list their referees, apply to officiate and assign games.", how: ["Home → Games to officiate, then pick a game's officials.", "Officials accept or decline on My dashboard."], who: ["official", ...managers], needs: ["court-officials"], areas: ["officials"] },
      { key: "scrimmages", title: "Scrimmages", purpose: "Schedule scrimmage games for your teams, with attendance and a scoresheet.", how: ["Open the program's Scrimmages and +."], who: ["coach", "staff", ...managers], needs: ["court-players"], areas: ["programs", "teams"] },
    ],
  },
  {
    version: "1.8",
    kind: "major",
    date: "2026-11-11",
    title: "Home as cards, one team page for everyone",
    history: true,
    items: [
      { key: "home-cards", title: "Home is a stack of cards", purpose: "Everything opens in place, the same in every organization.", how: ["Tap a card to open it; red means something needs you."], who: everyoneIn },
      { key: "team-page", title: "One team page", purpose: "Staff, Roster, Games, Uniforms, Practices and Playbook in the same place for every team.", how: ["Tap a team in Teams."], who: ["coach", "staff", ...managers], areas: ["teams"] },
    ],
  },
  {
    version: "1.7",
    kind: "minor",
    date: "2026-11-10",
    title: "Grade eligibility and own-gym practices",
    history: true,
    items: [
      { key: "eligibility", title: "Grade eligibility", purpose: "Shows players too old or in too high a grade for their team.", how: ["Look for the badge on a roster; set the rules in the organization's gear."], who: ["coach", "staff", ...managers], areas: ["teams"] },
      { key: "own-gym", title: "Own-gym practices", purpose: "Put practices at any gym on the team's schedule, every week if you like.", how: ["Open the team's Practices → Book practices → Own gym."], who: ["coach", "staff", ...managers], areas: ["practices"] },
    ],
  },
  {
    version: "1.6",
    kind: "minor",
    date: "2026-11-08",
    title: "Public League page and features by name",
    history: true,
    items: [
      { key: "public-league", title: "The public League page", purpose: "Anyone can see a League's teams, schedule and standings without logging in.", how: ["Open the organization's public page and the League."], who: everyoneIn },
      { key: "features", title: "CourtCaptain's features", purpose: "Each organization turns on what it needs: CourtPlayers, CourtEvents, CourtSync and more.", how: ["The gear at the top → features."], who: ["admin", "owner"] },
    ],
  },
  {
    version: "1.5",
    kind: "major",
    date: "2026-11-06",
    title: "The Scheduler",
    history: true,
    items: [
      { key: "scheduler", title: "Make a League's schedule", purpose: "Matchups, then a grid of courts and times, with what needs attention for each organization.", how: ["Home → Programs → Scheduler.", "Create matchups, place them on the Grid, then publish."], who: managers, needs: ["court-teams"], areas: ["scheduling"] },
      { key: "search", title: "Search", purpose: "Find a person, team or player from anywhere.", how: ["Tap 🔍 at the top."], who: managers },
    ],
  },
  {
    version: "1.4",
    kind: "minor",
    date: "2026-11-03",
    title: "Home's numbers and the roster board",
    history: true,
    items: [
      { key: "metrics", title: "Home's numbers", purpose: "Registrations by day, who's not on a team, coaches' use of the app and site visits.", how: ["Open Home."], who: ["admin", "owner"] },
      { key: "roster-board", title: "Roster board", purpose: "Drag players onto teams, grade by grade.", how: ["Home → To Do → Not on a team → Roster."], who: managers, needs: ["court-players"], areas: ["teams"] },
      { key: "reset-login", title: "Reset login", purpose: "Help someone who can't get in: their PIN goes back to the starter PIN.", how: ["Members: tap Reset login by the person."], who: ["admin", "owner"] },
    ],
  },
  {
    version: "1.3",
    kind: "major",
    date: "2026-11-01",
    title: "CourtCaptain: every organization together",
    history: true,
    items: [
      { key: "orgs", title: "Organizations, programs and hosting", purpose: "Leagues, clubs and host schools each manage their own teams, staff and gyms, in one app.", how: ["Tap your logo chip at the top to switch organizations."], who: everyoneIn },
      { key: "director-areas", title: "Directors by area", purpose: "Give each Director just their part: teams, scheduling, scores and more.", how: ["Members → Staff and +."], who: ["admin", "owner"] },
      { key: "support-chats", title: "Support chats", purpose: "Ask CourtCaptain for help right in the app.", how: ["Tap ? Support and start a chat."], who: everyoneIn },
    ],
  },
  {
    version: "1.2",
    kind: "minor",
    date: "2026-10-30",
    title: "Uniforms and View as",
    history: true,
    items: [
      { key: "uniforms", title: "Uniform numbers and sizes", purpose: "Coaches set each player's number and size; Directors order from them.", how: ["Open the team's Uniforms."], who: ["coach", "staff", ...managers], needs: ["uniforms"], areas: ["uniforms", "teams"] },
      { key: "view-as", title: "View as", purpose: "See the app as someone else does, view only, to help them.", how: ["Tap 👁 by a person; Stop in the orange bar ends it."], who: ["admin", "owner"] },
    ],
  },
  {
    version: "1.1",
    kind: "major",
    date: "2026-10-28",
    title: "Announcements, chat, events and rosters",
    history: true,
    items: [
      { key: "announcements", title: "Announcements and chat", purpose: "Reach the right people, and talk with your team.", how: ["Tap the bell or the 💬 at the top."], who: ["coach", "staff", ...managers], needs: ["chat"] },
      { key: "events", title: "Events with check-in", purpose: "Track who came to a tryout or a practice.", how: ["Open the event and tap each player: ✓ or ✗."], who: ["coach", "staff", ...managers] },
      { key: "rosters", title: "Rosters and evaluations", purpose: "Put registered players on teams and record how they play.", how: ["Open a team's Roster, or the event's evaluations."], who: ["coach", "staff", ...managers], needs: ["court-players"], areas: ["teams", "players"] },
    ],
  },
  {
    version: "1.0",
    kind: "major",
    date: "2026-10-27",
    title: "Logins, players, teams and practices",
    history: true,
    items: [
      { key: "login", title: "Log in with your cell and a PIN", purpose: "No usernames to remember.", how: ["Enter your cell, then your 4-digit PIN.", "The first time, confirm your email with a code."], who: everyoneIn },
      { key: "players", title: "Players from registration", purpose: "Registered players come in by themselves every few minutes.", how: ["Home → Players."], who: managers, needs: ["court-players"], areas: ["players"] },
      { key: "practice", title: "Practice booking", purpose: "Book practices in the gyms' open times, within each team's limits.", how: ["Open your team's Practices → Book practices."], who: ["coach", "staff", ...managers], needs: ["practice"], areas: ["practices"] },
    ],
  },
];

export const VERSION = RELEASES[0].version;

// Pure: is version a newer than b? ("1.10" is newer than "1.9"; nothing seen: everything is.)
export function newer(a: string, b: string | null): boolean {
  if (!b) return true;
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  return x[0] !== y[0] ? x[0] > y[0] : (x[1] ?? 0) > (y[1] ?? 0);
}

// Pure: the revisions under their version ("1.14" is Version 1's), newest first.
export function versionsOf<R extends { version: string }>(list: readonly R[]): [string, R[]][] {
  const out: [string, R[]][] = [];
  for (const r of list) {
    const v = r.version.split(".")[0];
    const last = out[out.length - 1];
    if (last?.[0] === v) last[1].push(r);
    else out.push([v, [r]]);
  }
  return out;
}
