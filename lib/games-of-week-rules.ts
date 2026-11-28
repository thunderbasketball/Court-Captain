// How Games of the Week are picked, in words (shown on public pages; lib/games-of-week picks them). No imports: safe in
// the browser.
export const GOTW_RULES = [
  "Both teams have played at least one game this season with a score entered.",
  "Ranked by the two teams' combined winning percentage (best first),",
  "then how even their records are (closer is better),",
  "then games played (more is better), then the two teams' combined Power Index (PI).",
  "The top 5 REC and top 5 COMP games of the coming Game Day.",
];
export const RECAP_RULES = [
  "From noon on Game Day through Monday: that Game Day's games with their final scores.",
  "The Upcoming Game Highlights games first (once their scores are in),",
  "then the closest finals, up to 5 REC and 5 COMP.",
];
