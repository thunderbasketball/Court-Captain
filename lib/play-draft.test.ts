import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testing/db";
import { DAILY_DRAFTS, draftPlay, type DraftClient } from "./play-draft";

// Claude is faked: each test says what it "answers".
const fake = (answer: unknown, stop = "end_turn") => {
  const calls: unknown[] = [];
  const claude = {
    beta: {
      messages: {
        create: async (params: unknown) => {
          calls.push(params);
          return { stop_reason: stop, content: [{ type: "text", text: typeof answer === "string" ? answer : JSON.stringify(answer) }] };
        },
      },
    },
  } as unknown as DraftClient;
  return { claude, calls };
};

describe("CourtPlaybook: ✨ Draft from description", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const now = new Date("2026-11-17T17:00:00Z");
  const coach = { coachId: "5550001", firstName: "P", lastName: "Coach", isDirector: false, thunderAreas: [] } as never;
  const parent = { coachId: "5550002", firstName: "P", lastName: "Parent", isDirector: false, thunderAreas: [] } as never;
  let T = { org: "thunder", teamId: "" };
  const horns = {
    start: [
      { id: "1", x: 250, y: 320 },
      { id: "4", x: 310, y: 190 },
      { id: "5", x: 190, y: 190 },
      { id: "2", x: 470, y: 45 },
      { id: "3", x: 30, y: 45 },
    ],
    ball: "1",
    frames: [
      {
        lines: [
          { kind: "screen", from: "5", x: 260, y: 300, curved: false, bx: 0, by: 0 },
          { kind: "dribble", from: "1", x: 430, y: 230, curved: true, bx: 360, by: 300 },
        ],
      },
      {
        lines: [
          { kind: "pass", from: "1", x: 470, y: 45, curved: true, bx: 1, by: 1 }, // a pass stays straight
          { kind: "pass", from: "3", x: 250, y: 320, curved: false, bx: 0, by: 0 }, // 3 hasn't the ball: left out
          { kind: "slide", from: "4", x: 300, y: 250, curved: false, bx: 0, by: 0 }, // offense with a defense line: left out
          { kind: "cut", from: "5", x: 999, y: 90, curved: false, bx: 0, by: 0 }, // off the court: kept on its edge
        ],
      },
    ],
    notes: "Use the ball screen to get to the wing; hit the corner if X2 helps.",
  };

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'P', 'Coach', '4235550001'), ('5550002', 'P', 'Parent', '4235550002')");
    const t = (
      await db.pool.query<{ id: string }>(
        "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x'), ($1, '5550002', 'TeamParent', 'x')", [t]);
    await db.pool.query("insert into org_features (org, feature, source) values ('thunder', 'court-playbook', 'setup') on conflict do nothing");
    T = { org: "thunder", teamId: t };
  });

  it("draws the answer: start, then each frame from where the last ends; rule-breaking lines left out; recorded", async () => {
    const { claude, calls } = fake(horns);
    const r = await draftPlay({ pool: db.pool, now: () => now, claude }, coach, T, {
      description: "Horns. 5 ball screens for 1, 1 curls to the right wing and kicks to the corner.",
      kind: "Offense",
      formation: "Horns",
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.frames).toHaveLength(2);
    expect(r.frames[0].ball).toBe("1");
    expect(r.frames[0].lines.map((l) => l.kind)).toEqual(["screen", "dribble"]);
    expect(r.frames[0].lines[1]).toMatchObject({ bx: 360, by: 300 });
    // Frame 2 starts where frame 1 ends: 1 on the wing, 5 at its screen.
    expect(r.frames[1].spots.find((s) => s.id === "1")).toMatchObject({ x: 430, y: 230 });
    expect(r.frames[1].spots.find((s) => s.id === "5")).toMatchObject({ x: 260, y: 300 });
    expect(r.frames[1].lines.map((l) => `${l.kind} ${l.from}`)).toEqual(["pass 1", "cut 5"]);
    expect(r.frames[1].lines[0]).not.toHaveProperty("bx");
    expect(r.frames[1].lines[1].x).toBe(500);
    expect(r.notes).toContain("ball screen");
    // What Claude was asked: the type, the formation and the words; the model and a strict JSON answer.
    const asked = calls[0] as { model: string; messages: { content: string }[]; output_config: { format: { type: string } } };
    expect(asked.model).toBe("claude-opus-5-5");
    expect(asked.output_config.format.type).toBe("json_schema");
    expect(asked.messages[0].content).toContain("Base formation: Horns.");
    expect((await db.pool.query("select asked_by, ok from play_drafts")).rows).toEqual([{ asked_by: "P Coach", ok: true }]);
  });

  it("only the team's coaches; a real description; not set up without the key; a daily limit; bad answers explained", async () => {
    const deps = (claude: DraftClient | null) => ({ pool: db.pool, now: () => now, claude });
    const words = { description: "1 passes to 2 on the wing and cuts to the basket." };
    expect(await draftPlay(deps(fake(horns).claude), parent, T, words)).toMatchObject({ ok: false });
    expect(await draftPlay(deps(fake(horns).claude), coach, T, { description: "horns" })).toMatchObject({ ok: false });
    expect(await draftPlay(deps(null), coach, T, words)).toMatchObject({ ok: false, message: expect.stringContaining("isn't set up") });
    expect(await draftPlay(deps(fake("not json").claude), coach, T, words)).toMatchObject({ ok: false, message: expect.stringContaining("Couldn't read") });
    expect(await draftPlay(deps(fake({ start: [], ball: "", frames: [], notes: "" }).claude), coach, T, words)).toMatchObject({ ok: false });
    expect(await draftPlay(deps(fake(horns, "refusal").claude), coach, T, words)).toMatchObject({ ok: false, message: expect.stringContaining("couldn't draw") });
    // The failed ones count too; at the limit, no more today.
    await db.pool.query(
      "insert into play_drafts (org, coach_id, asked_by, asked_at, ok) select 'thunder', '5550001', 'P Coach', $1, true from generate_series(1, $2::int)",
      [now, DAILY_DRAFTS],
    );
    expect(await draftPlay(deps(fake(horns).claude), coach, T, words)).toMatchObject({ ok: false, message: expect.stringContaining("drafts today") });
  });
});
