import { describe, expect, it } from "vitest";
import { fingerprint } from "@src/content/fingerprint";

describe("fingerprint", () => {
  it("is stable for the same rule, selector and text", () => {
    expect(fingerprint("LAY-01", "main > section:nth-of-type(2)", "Holidays")).toBe(fingerprint("LAY-01", "main > section:nth-of-type(2)", "Holidays"));
  });

  it("is 8 lowercase hex characters", () => {
    expect(fingerprint("TYP-02", "h2", "Title")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes with the rule, the selector or the text", () => {
    const base = fingerprint("LAY-01", "div.card", "Text");
    expect(fingerprint("LAY-02", "div.card", "Text")).not.toBe(base);
    expect(fingerprint("LAY-01", "div.tile", "Text")).not.toBe(base);
    expect(fingerprint("LAY-01", "div.card", "Other")).not.toBe(base);
  });
});
