// CourtPlaybook ✨ Draft from description (SPEC.md section 14): a coach describes a play in words ("Horns. 1 dribbles to
// the right wing, 5 ball-screens…") and Claude drafts its drawing: where the players start and each frame's lines. The
// coach then checks and fixes it in the editor; nothing is saved until they save the play. The answer is checked by the
// same rules as a hand-drawn play (cleanFrames), and each next frame starts where the last one ends (nextFrame), so a
// draft can't be drawn wrong. Whoever may change the playbook may ask; 25 drafts a person a day.
import Anthropic from "@anthropic-ai/sdk";
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { canUsePlaybook, type TeamRef } from "./playbook";
import { DEFENSE, LINE_KINDS, MAX_FRAMES, MAX_LINES, OFFENSE, cleanFrames, nextFrame, type Frame, type PlayLine, type Spot } from "./play-diagram";
import { PLAY_KINDS } from "./play-kinds";

export const DAILY_DRAFTS = 25;
const MODEL = "claude-opus-5-5";

// The part of the Anthropic client a draft uses (tests pass a fake).
export type DraftClient = { beta: { messages: { create: Anthropic["beta"]["messages"]["create"] } } };
type Deps = { pool: Pool; now: () => Date; claude?: DraftClient | null };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type DraftInput = { description?: unknown; kind?: unknown; formation?: unknown; start?: unknown };

const IDS = [...OFFENSE, ...DEFENSE];
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["start", "ball", "frames", "notes"],
  properties: {
    start: {
      type: "array",
      description: "Every player on the court at the start, each once.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "x", "y"],
        properties: { id: { type: "string", enum: IDS }, x: { type: "number" }, y: { type: "number" } },
      },
    },
    ball: { type: "string", enum: [...OFFENSE, ""], description: "Who has the ball at the start (\"\" for no one)." },
    frames: {
      type: "array",
      description: `One entry per step of the play, in order (1 to ${MAX_FRAMES}). Each step's lines start from where the players stand after the steps before it.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["lines"],
        properties: {
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "from", "x", "y", "curved", "bx", "by"],
              properties: {
                kind: { type: "string", enum: [...LINE_KINDS] },
                from: { type: "string", enum: IDS },
                x: { type: "number" },
                y: { type: "number" },
                curved: { type: "boolean" },
                bx: { type: "number", description: "When curved: a point the line passes through halfway. Otherwise 0." },
                by: { type: "number", description: "When curved: a point the line passes through halfway. Otherwise 0." },
              },
            },
          },
        },
      },
    },
    notes: { type: "string", description: "A short coaching note for the play (2-4 sentences, plain words), or \"\"." },
  },
} as const;

const SYSTEM = `You draw basketball plays for a youth coaching app, on a high school half court seen from above.

Court: x runs 0 (left sideline) to 500 (right sideline); y runs 0 (baseline, at the top) to 420 (half-court line, at the bottom). 10 units = 1 foot. The basket is at (250, 52). The lane is x 190-310 from the baseline down to the free-throw line at y 190 (free-throw circle: radius 60 around (250, 190)). The 3-point line is straight along x 30 and x 470 from the baseline down to y 140, then arcs (radius 198 around the basket) through the top of the key at (250, 250). The offense attacks the basket at the top; "right" and "left" are as the offense sees it facing the basket, which is the same as right and left on the drawing.
Usual spots: point/top (250, 320); right wing (430, 230), left wing (70, 230); right corner (470, 45), left corner (30, 45); right slot (340, 290), left slot (160, 290); right elbow (310, 190), left elbow (190, 190); right block (325, 90), left block (175, 90); high post (250, 190); short corner right (400, 70), left (100, 70).

Players: offense 1-5 (1 is usually the point guard with the ball), defense X1-X5 (Xn guards n). Put on the court only who the description needs: offense only unless it mentions defense or is a defensive play, then add the defenders.
Lines, each from a player to where it ends:
- Offense (from 1-5 only): cut (player runs there), dribble (only the player with the ball in that step), pass (only the player with the ball in that step; end it at the receiver's spot), screen (screener moves there and sets a screen; end it right next to the defender or player being screened).
- Defense (from X1-X5 only): slide, closeout, trap, deny, switch.
Steps: each frame is one step of the play, in order. Players stand where their last cut, dribble, screen or defense line in the step before ended; a pass gives the ball to the receiver for the next step. Put things that happen at the same time in the same step, and what follows a pass in the next step. At most ${MAX_LINES} lines a step and ${MAX_FRAMES} steps; most plays need 2-5.
A cut, dribble or screen may curve (a curl, a banana cut around a screen): set curved true and bx, by to the point it passes halfway. Passes are always straight (curved false, bx 0, by 0).
Keep every point on the court. If the description is not a basketball play, return no players and no frames.`;

const asNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

// The client for the server's key, or null when it isn't set up.
function client(deps: Deps): DraftClient | null {
  if (deps.claude !== undefined) return deps.claude;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ timeout: 55_000, maxRetries: 1 });
}

export async function draftPlay(deps: Deps, viewer: SessionUser, ref: TeamRef, input: DraftInput): Promise<Result<{ frames: Frame[]; notes: string }>> {
  if (!(await canUsePlaybook(deps.pool, viewer, ref))) return { ok: false, message: "Only this team's coaches can draft its plays." };
  const description = typeof input.description === "string" ? input.description.replace(/\r\n/g, "\n").trim() : "";
  if (description.length < 10) return { ok: false, message: "Describe the play in a sentence or more." };
  if (description.length > 1500) return { ok: false, message: "Keep the description under 1500 letters." };
  const kind = PLAY_KINDS.find((k) => k === input.kind) ?? "Offense";
  const formation = typeof input.formation === "string" ? input.formation.trim().slice(0, 40) : "";
  // Where the formation starts them (as on the court now), checked like a drawing.
  const startFrames = input.start === undefined || input.start === null ? [] : cleanFrames([input.start]);
  const start = Array.isArray(startFrames) && startFrames[0]?.spots.length ? startFrames[0] : null;

  const claude = client(deps);
  if (!claude) return { ok: false, message: "Draft from description isn't set up yet (it needs the Claude key in the app's settings)." };
  const today = await deps.pool.query<{ n: number }>(
    "select count(*)::int as n from play_drafts where coach_id = $1 and asked_at > $2::timestamptz - interval '1 day'",
    [viewer.coachId, deps.now()],
  );
  if (today.rows[0].n >= DAILY_DRAFTS) return { ok: false, message: `That's ${DAILY_DRAFTS} drafts today. Try again tomorrow, or draw it by hand.` };

  const who = `${viewer.firstName} ${viewer.lastName}`.trim() || viewer.coachId;
  const record = (ok: boolean) =>
    deps.pool.query("insert into play_drafts (org, coach_id, asked_by, asked_at, ok) values ($1, $2, $3, $4, $5)", [ref.org, viewer.coachId, who, deps.now(), ok]);
  const fail = async (message: string) => (await record(false), { ok: false as const, message });

  const ask = [
    `Play type: ${kind}.`,
    formation ? `Base formation: ${formation}.` : "",
    start ? `They start here (keep these spots unless the description says otherwise): ${JSON.stringify({ start: start.spots, ball: start.ball ?? "" })}` : "",
    "",
    "The coach's description:",
    description,
  ]
    .filter((l) => l !== "")
    .join("\n");

  let text = "";
  try {
    const r = await claude.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM,
      messages: [{ role: "user", content: ask }],
    });
    if (r.stop_reason === "refusal") return fail("Claude couldn't draw that one. Try describing it differently.");
    if (r.stop_reason === "max_tokens") return fail("That play was too long to draft. Try describing fewer steps.");
    text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return fail("Too many drafts right now. Try again in a minute.");
    if (e instanceof Anthropic.APIConnectionTimeoutError) return fail("Drafting took too long. Try a shorter description.");
    if (e instanceof Anthropic.APIError) return fail("Drafting isn't working right now. Try again in a minute.");
    throw e;
  }

  // The answer, turned into frames: the start, then each step from where the last one ends.
  let parsed: { start?: unknown; ball?: unknown; frames?: unknown; notes?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("Couldn't read the draft. Try again.");
  }
  const spots: Spot[] = Array.isArray(parsed.start)
    ? parsed.start.map((s: { id?: unknown; x?: unknown; y?: unknown }) => ({ id: String(s?.id), x: asNum(s?.x), y: asNum(s?.y) }))
    : [];
  const steps: { lines?: unknown }[] = Array.isArray(parsed.frames) ? parsed.frames.slice(0, MAX_FRAMES) : [];
  if (!spots.length || !steps.length) return fail("Couldn't draw a play from that. Say who starts where and what each player does.");
  const lineOf = (l: { kind?: unknown; from?: unknown; x?: unknown; y?: unknown; curved?: unknown; bx?: unknown; by?: unknown }): PlayLine => ({
    kind: l?.kind as PlayLine["kind"],
    from: String(l?.from),
    x: asNum(l?.x),
    y: asNum(l?.y),
    ...(l?.curved === true && l?.kind !== "pass" ? { bx: asNum(l?.bx), by: asNum(l?.by) } : {}),
  });
  const frames: Frame[] = [];
  for (const [i, step] of steps.entries()) {
    const lines = (Array.isArray(step?.lines) ? step.lines : []).slice(0, MAX_LINES).map(lineOf);
    const base: Frame = i === 0 ? { spots, ball: typeof parsed.ball === "string" && parsed.ball ? parsed.ball : null, lines: [] } : nextFrame(frames[i - 1]);
    // A line that breaks a rule (a pass from someone without the ball, a defender cutting…) is left out, not the play.
    const ok = lines.filter((l) => {
      const one = cleanFrames([{ ...base, lines: [l] }]);
      if (typeof one === "string") return false;
      if ((l.kind === "pass" || l.kind === "dribble") && base.ball !== l.from) return false;
      return true;
    });
    frames.push({ ...base, lines: ok });
  }
  const checked = cleanFrames(frames);
  if (typeof checked === "string") return fail("Couldn't draw that cleanly. Try describing it again.");
  await record(true);
  const notes = typeof parsed.notes === "string" ? parsed.notes.trim().slice(0, 600) : "";
  return { ok: true, frames: checked, notes };
}
