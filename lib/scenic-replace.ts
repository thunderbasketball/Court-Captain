// Asking first: a change that would leave games to correct throws AskFirst with each game (lib/league-team-change's Play in).

// Thrown to undo the change and ask first: each game it would leave to correct.
export class AskFirst extends Error {
  constructor(public readonly warn: string[]) {
    super("It has games: look at them first.");
  }
}
