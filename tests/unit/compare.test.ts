import { beforeEach, describe, expect, it } from "vitest";
import { activeFindings, diffScans } from "@shared/compare";
import { withFindings } from "@shared/scoring";
import type { Finding, ScanResult } from "@shared/types";
import { deleteSavedScan, getSavedScan, listSavedScans, renameSavedScan, saveScan } from "@src/background/storage";

function finding(fingerprint: string, patch: Partial<Finding> = {}): Finding {
  return {
    id: fingerprint,
    fingerprint,
    ruleId: "TYP-02",
    severity: "High",
    type: "Definite",
    status: "new",
    kind: "outlier",
    groupId: "g1",
    element: { selector: `#${fingerprint}`, html: "<p>", text: "x", box: { x: 0, y: 0, width: 10, height: 10 } },
    property: "font size",
    expected: "16px",
    actual: "18px",
    values: [],
    message: "Font size is 18px.",
    ...patch,
  };
}

function scan(findings: Finding[], patch: Partial<ScanResult> = {}): ScanResult {
  const base: ScanResult = {
    scanId: "s1",
    url: "https://app.example.test/orders",
    title: "Orders",
    scannedAt: "2026-11-14T10:00:00.000Z",
    durationMs: 100,
    timings: { waitMs: 0, snapshotMs: 0, groupingMs: 0, rulesMs: 0 },
    engineVersion: "0.6.0",
    score: 100,
    summary: { high: 0, medium: 0, low: 0, review: 0, excluded: 0 },
    options: { scope: "page", tolerancePreset: "strict", rules: [] },
    viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
    elementsScanned: 50,
    groups: [{ id: "g1", kind: "sibling", label: "3 boxes", members: [] }],
    findings: [],
    rules: [],
    notScanned: [],
    warnings: [],
    ...patch,
  };
  return withFindings(base, findings);
}

describe("diffScans", () => {
  it("splits the findings into new, fixed and unchanged by fingerprint", () => {
    const diff = diffScans(scan([finding("a"), finding("b"), finding("c")]), scan([finding("b"), finding("c"), finding("d")]));
    expect(diff.added.map((f) => f.fingerprint)).toEqual(["d"]);
    expect(diff.fixed.map((f) => f.fingerprint)).toEqual(["a"]);
    expect(diff.unchanged.map((f) => f.fingerprint)).toEqual(["b", "c"]);
  });

  it("matches findings that share a fingerprint one for one", () => {
    const diff = diffScans(scan([finding("a"), finding("a")]), scan([finding("a")]));
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.fixed).toHaveLength(1);
    expect(diff.added).toEqual([]);
  });

  it("leaves out findings for review and findings the tester excluded", () => {
    const before = scan([finding("a"), finding("r", { type: "Review" }), finding("i", { status: "ignored" })]);
    expect(activeFindings(before).map((f) => f.fingerprint)).toEqual(["a"]);
    // Ignoring a finding does not make it "fixed"; it was never counted on the other side either.
    const diff = diffScans(before, scan([finding("a"), finding("r", { type: "Review" })]));
    expect(diff).toEqual({ added: [], fixed: [], unchanged: [expect.objectContaining({ fingerprint: "a" })] });
  });
});

describe("saved scans", () => {
  beforeEach(() => {
    const store = new Map<string, unknown>();
    const local = {
      get: async (key: string) => (store.has(key) ? { [key]: structuredClone(store.get(key)) } : {}),
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) store.set(key, structuredClone(value));
      },
      remove: async (keys: string | string[]) => {
        for (const key of [keys].flat()) store.delete(key);
      },
    };
    (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local } };
  });

  it("saves a result under a name and lists it newest first", async () => {
    const first = await saveScan("Orders – before", scan([finding("a"), finding("r", { type: "Review" })]));
    const second = await saveScan("  ", scan([], { title: "Orders page" }));
    expect(first).toMatchObject({ name: "Orders – before", url: "https://app.example.test/orders", tolerancePreset: "strict", scope: "page", issueCount: 1 });
    expect(first.summary).toMatchObject({ high: 1, review: 1 });
    // No name given: the title of the page.
    expect(second.name).toBe("Orders page");
    expect((await listSavedScans()).map((m) => m.id)).toEqual([second.id, first.id]);
    const loaded = await getSavedScan(first.id);
    expect(loaded?.result.findings.map((f) => f.fingerprint)).toEqual(["a", "r"]);
    expect(loaded?.meta.name).toBe("Orders – before");
  });

  it("renames and deletes", async () => {
    const meta = await saveScan("One", scan([]));
    expect((await renameSavedScan(meta.id, "Two")).name).toBe("Two");
    // An empty name keeps the old one.
    expect((await renameSavedScan(meta.id, "  ")).name).toBe("Two");
    await expect(renameSavedScan("missing", "x")).rejects.toThrow("no longer exists");
    await deleteSavedScan(meta.id);
    expect(await listSavedScans()).toEqual([]);
    expect(await getSavedScan(meta.id)).toBeUndefined();
  });

  it("saves made at the same moment do not lose each other", async () => {
    await Promise.all([saveScan("A", scan([])), saveScan("B", scan([])), saveScan("C", scan([]))]);
    expect((await listSavedScans()).map((m) => m.name).sort()).toEqual(["A", "B", "C"]);
  });
});
