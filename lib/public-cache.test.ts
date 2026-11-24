import { describe, expect, it } from "vitest";
import { publicly } from "./public-cache";

describe("the public pages' 30-second answers", () => {
  it("reads once for everyone within 30 seconds (even at the same moment), again after; each key its own", async () => {
    let n = 0;
    const read = async () => ++n;
    const t = 1_000_000;
    expect(await Promise.all([publicly("a", read, t), publicly("a", read, t)])).toEqual([1, 1]);
    expect(await publicly("a", read, t + 29_999)).toBe(1);
    expect(await publicly("b", read, t)).toBe(2);
    expect(await publicly("a", read, t + 30_000)).toBe(3);
    expect(await publicly("a", read, t + 31_000)).toBe(3);
  });

  it("a failed read isn't kept", async () => {
    let n = 0;
    const read = async () => {
      if (++n === 1) throw new Error("down");
      return "ok";
    };
    await expect(publicly("f", read, 5)).rejects.toThrow("down");
    expect(await publicly("f", read, 6)).toBe("ok");
  });

  it("keeps a limited number: made-up addresses can't fill the memory", async () => {
    let n = 0;
    await publicly("first", async () => ++n, 100);
    for (let i = 0; i < 300; i++) await publicly(`x${i}`, async () => i, 100);
    expect(await publicly("first", async () => ++n, 101)).toBe(2); // pushed out: read again
  });
});
