// Team warnings' settings, shared by the server and the Warnings gear (SPEC.md section 14).
export type WarningSettings = {
  roster: { on: boolean; min: number };
  idle: { on: boolean; days: number };
  uniforms: { on: boolean };
};
export const DEFAULT_WARNINGS: WarningSettings = { roster: { on: true, min: 8 }, idle: { on: true, days: 14 }, uniforms: { on: true } };
export const ROSTER_MIN = [1, 30] as const;
export const IDLE_DAYS = [1, 90] as const;

const isInt = (v: unknown, [lo, hi]: readonly [number, number]): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

// What a Director entered, checked; null when a number is out of range.
export function cleanWarnings(v: unknown): WarningSettings | null {
  const r = obj(v);
  const roster = obj(r.roster);
  const idle = obj(r.idle);
  const uniforms = obj(r.uniforms);
  if (!isInt(roster.min, ROSTER_MIN) || !isInt(idle.days, IDLE_DAYS)) return null;
  return {
    roster: { on: roster.on === true, min: roster.min },
    idle: { on: idle.on === true, days: idle.days },
    uniforms: { on: uniforms.on === true },
  };
}
