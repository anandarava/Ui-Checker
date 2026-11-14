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

**Phases 0 to 6 are done.** The scan measures every visible element of the
page, finds the *peer groups* (the elements that should look the same) and runs
**all 27 rules** on them: typography, layout and spacing, group structure, box
style, and text and content (cut-off text, value formats, link style, images
that do not load). Differences that are often intentional (a colour on its own, a
featured card, a sort icon on some columns) are listed for review instead of as
defects.

The side panel shows a consistency score, the issues by rule and each issue
with what was expected and what was found; it draws the issue, its peers and
the measurement on the page. Issues can be ignored, marked intentional or
added to a baseline, with a reason. Reports are exported as HTML (with
screenshots) or JSON.

The **Design scale** tab lists the fonts, sizes, spacing values and colours of
the page with how often each is used, outlines every use of a value on the
page, and marks the values that stand out: used once, off the spacing grid the
page follows, or almost the same as another colour. Load your team's design
tokens (Figma tokens or any design-token JSON) on the options page and the
values are checked against the tokens instead.

**Saved scans** keep a result under a name; two scans compare as new, fixed and
unchanged issues. A **site scan** finds the pages of an application, scans them
one after another at the screen width you choose, and compares the parts they
share (page title, header, navigation, footer, tab bars) across the pages. The
same scan runs in a **Playwright test** with a baseline, so a build fails only
on new issues: see [ci/README.md](ci/README.md). See [PLAN.md](PLAN.md) for the
phases.

| Phase | What | Status |
|---|---|---|
| 0 | Project, rule catalogue, fixtures, raw results view | Done |
| 1 | Page snapshot engine | Done |
| 2 | Peer grouping | Done |
| 3A | Consistency rules: the ten core rules | Done |
| 3B | Consistency rules: second wave | Done |
| 4 | Results UI and reports | Done |
| 5 | Page-wide design-scale audit | Done |
| 6 | Site scan, CI package, cross-page checks | Done |
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
| `UICHECK_URL=<page> npx playwright test -c ci/playwright.config.ts` | Scan a page in a Playwright test and fail on issues that are not in the baseline (see `ci/README.md`) |
| `npm run fixtures:build` | Rebuild the fixture pages from `fixtures/src` |
| `npm run fixtures:check` | Fail when a fixture page is out of date |
| `node scripts/make-rules.mjs` | Rewrite `shared/ui-rules.json` from the table in the script |
| `node scripts/dump-findings.mjs <fixture or URL>` | Print the findings of the rules on a page. `--all` runs every fixture, `--sites scripts/real-sites.txt` the real-site test list, `--preset strict` another tolerance preset |
| `node scripts/dump-groups.mjs <fixture or URL>` | Print the peer groups found on a page, for reviewing them by hand. `--sites scripts/real-sites.txt` runs the real-site test list, `--sample n` prints n groups per page, `--shots dir` saves screenshots with the groups drawn |

## Project layout

```
shared/            Data model, message contract, the rule catalogue (ui-rules.json) and
                   the design-token reader (tokens.ts).
                   Shared by the extension, the reports and CI.
src/background/    Service worker: injects the content script, starts scans, keeps results
                   and the ignored and baselined findings, builds the reports
                   (exporters/) and takes their screenshots (evidence.ts).
src/content/       Runs in the page. scanner.ts is the scan pipeline
                   (snapshot -> peer groups -> rules); snapshot.ts measures the
                   page, ready.ts waits until it can be measured, grouping.ts
                   finds the peer groups, rules/ compares them, overlay/ draws
                   on the page.
src/sidepanel/     The side panel (React).
src/options/       The options page: tolerances, rules, baselines, import and export.
src/devtools/      The same panel as a DevTools panel.
ci/                The scan for Playwright tests, with baselines (ui-check.ts) and a sample test.
fixtures/tokens/   A sample design-token file for the dashboard fixture.
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
