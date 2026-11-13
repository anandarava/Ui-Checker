import { afterEach, describe, expect, it } from "vitest";
import { waitUntilReady } from "@src/content/ready";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("waitUntilReady", () => {
  it("returns once the layout has stopped changing", async () => {
    document.body.innerHTML = `<p>a</p>`;
    const report = await waitUntilReady(document, { settleMs: 40, timeoutMs: 2000 });
    expect(report).toMatchObject({ fontsLoaded: true, imagesLoaded: true, settled: true });
    expect(report.waitedMs).toBeLessThan(1000);
  });

  it("gives up after the timeout on a page that never settles", async () => {
    const timer = setInterval(() => document.body.appendChild(document.createElement("p")), 10);
    try {
      const report = await waitUntilReady(document, { settleMs: 100, timeoutMs: 300 });
      expect(report.settled).toBe(false);
      expect(report.waitedMs).toBeGreaterThanOrEqual(290);
    } finally {
      clearInterval(timer);
    }
  });
});
