/**
 * Peer grouping against real layout (PLAN.md, Phase 2): every group listed in
 * Appendices B, C and D must be found on the reference fixtures, in the defects
 * and the clean variant, and elements that are not peers must stay apart.
 *
 * The selectors below are the test's way of naming the expected members. The
 * engine never sees them: it works from the snapshot only.
 */
import { test, expect, type Page } from "@playwright/test";
import { findGroups, fixtureUrl, type FoundGroups } from "./support/engine";

test.use({ viewport: { width: 1440, height: 900 } });

/** name -> selector of the members the group must have, exactly. */
type Expected = Record<string, string>;
/** Pairs of selectors whose elements must never share a group. */
type Apart = Array<[string, string]>;

const DASHBOARD: Expected = {
  "G1 page columns": ".content > .col",
  "G2 section cards": ".card",
  "G3 section titles": ".card-title",
  "section title rows": ".card-head",
  "G4 My Details fields": ".details > *",
  "G5 event cards": ".event",
  "G6 event detail items": ".event-item",
  "G7 holiday tiles": ".tile",
  "holiday names": ".tile-name",
  "holiday dates": ".tile-date",
  "G8 tabs": ".tab",
  "G9 sub-headings": ".sub-title",
  "G10 people items": ".person",
  "people avatars": ".person .avatar",
  "people names": ".person-name",
  "G11 sidebar navigation items": ".nav-item",
  "event icons": ".event-item .ic",
  "event texts": ".event-item > :not(.ic)",
  // The name box is built differently, but its texts join the labels and values they look like.
  "field labels": ".details .muted",
  "field values": ".field .value, .who-name",
};

const DASHBOARD_APART: Apart = [
  [".field .muted", ".field .value"],
  [".tile-name", ".tile-date"],
  [".person-name", ".person-date"],
  [".sidebar", ".main"],
  [".details", ".people"],
  [".people", ".holiday-grid"],
  [".field", ".tile"],
  [".who", ".person"],
  [".card-title", ".link"],
  [".card-head", ".event"],
];

const TABLE: Expected = {
  tabs: ".tab",
  "toolbar controls": ".toolbar > .control, .toolbar > .toggle",
  "view toggle items": ".toggle-btn",
  "column headers": "thead th",
  "table rows": "tbody tr",
  "cells of column 1": "tbody td:nth-child(1)",
  "cells of column 2": "tbody td:nth-child(2)",
  "cells of column 3": "tbody td:nth-child(3)",
  "cells of column 4": "tbody td:nth-child(4)",
  "cells of column 5": "tbody td:nth-child(5)",
  "cells of column 6": "tbody td:nth-child(6)",
  "cells of column 7": "tbody td:nth-child(7)",
  avatars: ".avatar",
  "name links": ".name-link",
  "page numbers": ".page-num",
  "previous and next": ".pager-btn",
  "sidebar navigation items": ".nav-item",
  "panels at the same level": ".page > .tabs, .page > table",
};

const TABLE_APART: Apart = [
  ["tbody td:nth-child(1)", "tbody td:nth-child(3)"],
  ["thead th", "tbody td"],
  [".dot", ".toggle-btn"],
  [".page-title", ".tab"],
];

const COMPLIANCE: Expected = {
  "section cards": ".card",
  "card columns": ".content > .col",
  "section titles": ".card-title",
  "title rows (accordion headers)": ".card-head",
  "stat cards": ".card.stat",
  "stat numbers": ".stat-num",
  "stat labels": ".stat-label",
  "linked list rows": ".link-row",
  "linked list numbers": ".link-num",
  "status rows": ".status-row",
  "status percentages": ".pct",
  "table columns": ".events th",
  "table rows": ".events tbody tr",
  "cells of column 1": ".events tbody td:nth-child(1)",
  "cells of column 2": ".events tbody td:nth-child(2)",
  "cells of column 3": ".events tbody td:nth-child(3)",
  "sidebar navigation items": ".nav-item",
  "navigation labels": ".nav-label",
  "header controls": ".find, .help",
  "view switch": ".switch-btn",
};

const COMPLIANCE_APART: Apart = [
  [".stat-num", ".stat-label"],
  [".stat-main", ".links"],
  [".link-num", ".link-text"],
  [".pct", ".status-row > span:not(.pct)"],
  [".sidebar", ".main"],
  [".stat-num", ".card-title"],
  [".link-row", ".nav-item"],
];

function describe(found: FoundGroups, members: number[]): string {
  return members.map((m) => found.names[m]).join(", ");
}

/** The group with exactly these members, or a message saying what came closest. */
function expectGroup(found: FoundGroups, name: string, selector: string): void {
  const wanted = found.matches[selector];
  expect(wanted.length, `${name}: "${selector}" must match at least 2 measured elements`).toBeGreaterThanOrEqual(2);
  expect(wanted, `${name}: "${selector}" matches an element the snapshot skipped`).not.toContain(-1);
  const key = wanted.join(",");
  const exact = found.groups.find((g) => g.members.join(",") === key);
  if (exact) return;
  const set = new Set(wanted);
  const closest = found.groups
    .map((g) => ({ g, shared: g.members.filter((m) => set.has(m)).length }))
    .sort((a, b) => b.shared - a.shared)[0];
  expect(exact, `${name}: no group with exactly the ${wanted.length} elements of "${selector}". Closest: ${closest ? `"${closest.g.label}" [${describe(found, closest.g.members)}]` : "none"}`).toBeDefined();
}

function expectApart(found: FoundGroups, a: string, b: string): void {
  const left = new Set(found.matches[a]);
  const right = new Set(found.matches[b]);
  for (const g of found.groups) {
    const mixes = g.members.some((m) => left.has(m)) && g.members.some((m) => right.has(m));
    expect(mixes, `"${a}" and "${b}" share the group "${g.label}" [${describe(found, g.members)}]`).toBe(false);
  }
}

async function check(page: Page, fixture: string, expected: Expected, apart: Apart, skip: string[] = []): Promise<FoundGroups> {
  await page.goto(fixtureUrl(fixture));
  const selectors = [...Object.values(expected), ...apart.flat()];
  const found = await findGroups(page, selectors);
  for (const [name, selector] of Object.entries(expected)) {
    if (!skip.includes(name)) expectGroup(found, name, selector);
  }
  for (const [a, b] of apart) expectApart(found, a, b);
  // Every group has at least two members, all different, in document order.
  for (const g of found.groups) {
    expect(g.members.length).toBeGreaterThanOrEqual(2);
    expect(g.members).toEqual(Array.from(new Set(g.members)).sort((x, y) => x - y));
    expect(g.parent).toBeLessThan(found.groups.length);
  }
  return found;
}

test.describe("peer groups", () => {
  for (const variant of ["defects", "clean"] as const) {
    test(`dashboard-${variant}: the groups of Appendix B`, async ({ page }) => {
      const found = await check(page, `dashboard-${variant}`, DASHBOARD, DASHBOARD_APART);
      // The current navigation item and the selected tab are known to be in a different state.
      expect(found.groups.some((g) => g.label.includes("links") && g.members.length === 3)).toBe(true);
    });

    test(`table-${variant}: the groups of Appendix C`, async ({ page }) => {
      await check(page, `table-${variant}`, TABLE, TABLE_APART);
    });

    test(`compliance-${variant}: the groups of Appendix D`, async ({ page }) => {
      await check(page, `compliance-${variant}`, COMPLIANCE, COMPLIANCE_APART);
    });
  }

  test("the seeded link in place of plain text stays with its peers", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-defects"));
    const found = await findGroups(page, [".event-item > :not(.ic)", ".event-link"]);
    expect(found.matches[".event-link"]).toHaveLength(1);
    expectGroup(found, "event texts", ".event-item > :not(.ic)");
  });

  for (const variant of ["defects", "clean"] as const) {
    test(`the three card grids give the same groups (${variant})`, async ({ page }) => {
      const results: string[] = [];
      for (const name of ["grid-plain", "grid-utility", "grid-hashed"]) {
        await page.goto(fixtureUrl(`${name}-${variant}`));
        const found = await findGroups(page, ["body > :nth-child(2) > *", "body > :nth-child(2) > * > :nth-child(1)", "body > :nth-child(2) > * > :nth-child(2)", "body > :nth-child(2) > * > :nth-child(3)"]);
        // Cards, titles, texts and links: six of each, whatever the tags and class names.
        expectGroup(found, "cards", "body > :nth-child(2) > *");
        expectGroup(found, "titles", "body > :nth-child(2) > * > :nth-child(1)");
        expectGroup(found, "texts", "body > :nth-child(2) > * > :nth-child(2)");
        expectGroup(found, "links", "body > :nth-child(2) > * > :nth-child(3)");
        results.push(JSON.stringify(found.groups.map((g) => ({ kind: g.kind, members: g.members, parent: g.parent }))));
      }
      expect(results[1]).toBe(results[0]);
      expect(results[2]).toBe(results[0]);
    });
  }

  test("groups 5,000 elements well inside the scan budget", async ({ page }) => {
    await page.setContent(`<!doctype html>
      <style>
        body { margin: 0; font: 14px/1.4 Arial, sans-serif; }
        main { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 16px; }
        article { padding: 12px; border: 1px solid #ccc; border-radius: 8px; }
        .row { display: flex; gap: 8px; align-items: center; }
      </style>
      <main></main>
      <script>
        const card = '<article><h3>Card title</h3><p>Some text with a <a href="#">link</a>.</p>' +
          '<div class="row"><span>One</span><span>Two</span><button type="button">Go</button></div></article>';
        document.querySelector("main").innerHTML = card.repeat(650);
      </script>`);
    const found = await findGroups(page, ["article"]);
    expectGroup(found, "cards", "article");
    // Snapshot (1.5 s) and the rest of the scan must fit in 3 s (PLAN.md, Success measures).
    expect(found.durationMs).toBeLessThan(1000);
  });
});
