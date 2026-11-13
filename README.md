# PalTech UI Consistency Checker

A Chrome / Edge (Manifest V3) extension that scans the page you are looking at
for **visual inconsistencies between elements that should look the same**:
uneven padding, misaligned boxes and text, and mismatched font family, size,
weight and colour.

It works on **any web application with no setup**, the same way the PalTech
Accessibility Testing extension does. It never looks for the selectors, class
names or text of a particular application. It finds *peer groups* (the cards of
a row, the titles of each section, the rows of a table) from the page structure
and compares each element with its peers on the same page.

The side panel and the reports follow the PalTech Accessibility Testing
extension, so testers who know one already know the other.

## Status

**Phases 0 to 3 are done.** The scan measures every visible element of the
page, finds the *peer groups* (the elements that should look the same) and runs
**all 22 rules** on them: typography, layout and spacing, group structure and
box style. Differences that are often intentional (a colour on its own, a
featured card, a sort icon on some columns) are listed for review instead of as
defects. The side panel lists the findings and the groups in a plain view, and
can outline the groups on the page; the full results UI and the reports are
Phase 4. See [PLAN.md](PLAN.md) for the phases.

| Phase | What | Status |
|---|---|---|
| 0 | Project, rule catalogue, fixtures, raw results view | Done |
| 1 | Page snapshot engine | Done |
| 2 | Peer grouping | Done |
| 3A | Consistency rules: the ten core rules | Done |
| 3B | Consistency rules: second wave | Done |
| 4 | Results UI and reports | Next |
| 5 | Page-wide design-scale audit | |
| 6 | Site scan, CI package, cross-page checks | |
| 7 | AI assist (optional, off by default) | |

## Run it

```
npm install
npm run build
```

Then open `chrome://extensions`, switch on **Developer mode**, choose **Load
unpacked** and pick the `dist` folder. Click the extension icon to open the side
panel, open any page and press **Start scan**.

To try it on the test pages:

```
npm run fixtures        # serves the fixtures at http://127.0.0.1:4174/
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload for the extension pages |
| `npm run build` | Type-check and build the extension into `dist/` |
| `npm test` | Unit tests (Vitest, jsdom) |
| `npm run test:e2e` | Browser tests: loads `dist/` into Chromium and scans every fixture, and checks the snapshot engine against real layout. Run `npm run build` first. The first run needs `npx playwright install chromium` |
| `npm run fixtures:build` | Rebuild the fixture pages from `fixtures/src` |
| `npm run fixtures:check` | Fail when a fixture page is out of date |
| `node scripts/make-rules.mjs` | Rewrite `shared/ui-rules.json` from the table in the script |
| `node scripts/dump-findings.mjs <fixture or URL>` | Print the findings of the rules on a page. `--all` runs every fixture, `--sites scripts/real-sites.txt` the real-site test list, `--preset strict` another tolerance preset |
| `node scripts/dump-groups.mjs <fixture or URL>` | Print the peer groups found on a page, for reviewing them by hand. `--sites scripts/real-sites.txt` runs the real-site test list, `--sample n` prints n groups per page, `--shots dir` saves screenshots with the groups drawn |

## Project layout

```
shared/            Data model, message contract and the rule catalogue (ui-rules.json).
                   Shared by the extension, the reports and CI.
src/background/    Service worker: injects the content script, starts scans, keeps results.
src/content/       Runs in the page. scanner.ts is the scan pipeline
                   (snapshot -> peer groups -> rules); snapshot.ts measures the
                   page, ready.ts waits until it can be measured, grouping.ts
                   finds the peer groups, rules/ compares them, overlay/ draws
                   on the page.
src/sidepanel/     The side panel (React).
src/options/       The options page: the rule list with on/off switches.
fixtures/src/      Fixture templates. One template gives a "defects" and a "clean" page.
fixtures/          Generated fixture pages. Do not edit by hand.
tests/unit/        Vitest.
tests/e2e/         Playwright, with the built extension loaded.
scripts/           Fixture builder, fixture server, rule catalogue writer, group and
                   findings dumps, the real-site test list.
```

## Fixtures

Each fixture is one template in `fixtures/src` that produces two pages which
differ **only** by the seeded defects:

- `<name>-defects.html` lists its defects in a `<script id="expected">` block:
  the rule that must report it and the element (`data-fx`) it must point at.
- `<name>-clean.html` has every defect fixed. A finding here is a bug in the
  checker.

| Fixture | What it is |
|---|---|
| `dashboard` | HR dashboard with two columns of section cards |
| `table` | Directory page: tab bar, toolbar, data table, pagination |
| `compliance` | Dashboard of a different product, in a different design language |
| `grid-plain`, `grid-utility`, `grid-hashed` | The same card grid written with named classes, utility classes and generated class names. The scan must return the same findings for all three |

The `data-fx` attributes exist for the tests only. The scan engine must never
read them.

## Rules of the house

- **Generic.** No selector, class name, text or layout of any specific
  application anywhere in `src/` or `shared/`. A rule that only works on one
  fixture is not done.
- **Honest results.** A rule whose check does not exist is reported as
  "notImplemented", never as passed.
- **Same look as the accessibility extension.** Copy its components and change
  only the wording and the data. Keep file and component names the same.
- **Nothing leaves the machine** in Phases 0–6.
