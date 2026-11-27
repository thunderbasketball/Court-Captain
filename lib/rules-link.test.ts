import { describe, expect, it } from "vitest";
import { cleanRulesUrl, rulesPrint, rulesView } from "./rules-link";

describe("a League's rules link", () => {
  const doc = "https://docs.google.com/document/d/1_47RvmPehQM5Z2ZfmOcf11vvTg9j9jaLe93Bv2c11IA/edit?usp=sharing";
  it("a Google Doc shows inside the page and prints as a PDF; any other https link just opens", () => {
    expect(rulesView(doc)).toBe("https://docs.google.com/document/d/1_47RvmPehQM5Z2ZfmOcf11vvTg9j9jaLe93Bv2c11IA/preview");
    expect(rulesPrint(doc)).toBe("https://docs.google.com/document/d/1_47RvmPehQM5Z2ZfmOcf11vvTg9j9jaLe93Bv2c11IA/export?format=pdf");
    expect(rulesView("https://example.com/rules.pdf")).toBeNull();
    expect(rulesPrint("https://example.com/rules.pdf")).toBe("https://example.com/rules.pdf");
  });
  it("only an https link is kept; empty removes it", () => {
    expect(cleanRulesUrl(` ${doc} `)).toBe(doc);
    expect(cleanRulesUrl("")).toBeNull();
    expect(cleanRulesUrl(null)).toBeNull();
    for (const bad of ["http://x.com", "javascript:alert(1)", "https://a b", 5, `https://${"x".repeat(600)}`]) expect(cleanRulesUrl(bad)).toBe(false);
  });
});
