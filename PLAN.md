# UI Consistency Checker: Implementation Plan

**Goal:** A Chrome extension that scans any web application and reports visual inconsistencies between elements that should look the same: uneven padding, misaligned boxes and text, and mismatched font family, size, weight and colour. The main use is checking screens that UI/UX teams generate with AI tools before they ship.

**Core idea:** Never compare every element with every other element. First find **peer groups** (elements that play the same role, such as the 5 dashboard section cards, the 6 holiday tiles or the 5 section titles). Then compare the members of each group and flag the ones that differ from the majority.

**Reference screen:** the Dashboard page (My Details, Organization, Pending Actions, Upcoming Events, Holidays). It is **one test fixture among many**, used to explain the approach. Nothing in the extension is built for it.

---

## Principle: generic, works on any application

Like PalTech Accessibility Testing, the extension must work on **any web application without setup**: install it, open any page, click Scan. This rule overrides every other design choice in this plan.

**Never:**
- hard-code selectors, class names, IDs, text or layouts of a particular application (including the reference dashboard)
- depend on a particular framework or CSS approach
- require configuration, design tokens or a reference design before the first scan

**Always:**
- decide everything from what the browser renders: element tree, computed styles and measured boxes
- find peer groups from structure and appearance, not from names. A "card" is anything that repeats with the same shape, whatever its class
- use relative checks (an element against its peers on the same page), so each application is judged against its own conventions
- keep tolerances and rules as settings with sensible defaults; per-site settings (ignores, baselines, tolerances, tokens) are optional extras, exactly as in the accessibility extension

**Must work with:**

| Area | Cases |
|---|---|
| Frameworks | React, Angular, Vue, Svelte, Blazor, server-rendered HTML, jQuery, Web Components |
| CSS approaches | Plain CSS, Sass, Tailwind and other utility classes, CSS-in-JS with hashed class names, CSS modules |
| Component libraries | Material UI, Angular Material, Bootstrap, Ant Design, Chakra, PrimeNG, Fluent, custom |
| Layouts | Flexbox, grid, floats, tables, absolute positioning, sticky headers, scroll containers |
| Page types | Dashboards, forms, data tables, lists, landing pages, settings pages, modals and drawers, wizards |
| Content | Any language, RTL (Arabic/Hebrew), long and short text, icon fonts and SVG icons, dark themes |
| Structure | Shadow DOM (open), same-origin iframes, SPAs with route changes, lazy-loaded content |
| Screens | Any viewport width, browser zoom, high-DPI displays |

**How this is proven:** a test set of many different fixtures plus a fixed list of real public sites and internal apps, scanned on every release (see Phase 0 and Success measures). A rule that only works on one fixture is not done.

---

## Architecture decision

Rebuild on the stack and structure of **Paltech-Accessibility-Inspector** (`../Paltech-Accessibility-Inspector`), not on the current webpack/plain-JS code.

| Reuse from the accessibility extension | Why |
|---|---|
| TypeScript + Vite + `@crxjs/vite-plugin`, React side panel, zustand | Proven MV3 setup, already maintained by the team |
| `src/content/fingerprint.ts` | Stable issue IDs for baselines and scan comparison |
| `src/content/overlay/*`, `src/content/picker.ts` | On-page highlighting and "scan part of page" |
| `src/content/observers/spa-observer.ts` | Rescans on SPA route changes |
| `src/background/exporters/*`, `evidence.ts` | HTML/JSON reports with screenshots |
| `src/background/site-scan.ts`, `shared/site-crawl.ts` | Multi-page scans |
| Saved scans, compare, baseline and ignore lists | Same workflow testers already know |
| `shared/a11y-rules.json` + `ci/` pattern | One rule catalogue shared by the extension and Playwright CI |
| `fixtures/` + Vitest + Playwright | Test pages with known defects |

From the current project, keep only the broken-image detector (ported in Phase 6). The current alignment module is replaced. The current spell checker is **not ported**: it downloads a 4 MB word list on every page and rewrites page text. It can be rebuilt later as a separate item if the team still wants it.

Permissions stay minimal: no `debugger` permission in the MVP (the accessibility extension needs it for its screen reader view; this one does not).

Ship as a **separate extension** first. Merging both into one PalTech QA suite can be decided after Phase 4, once both engines are stable.

---

## Look and feel: same as PalTech Accessibility Testing

The new extension must look and work like the accessibility extension, so testers who know one already know the other and the two reports look like they come from the same product family.

**Rule:** copy the accessibility extension's UI code and report template, then change only the wording and the data shown. Do not restyle. Keep the same file and component names, so a fix in one extension can be copied to the other.

### Side panel

| Accessibility extension | UI Consistency Checker |
|---|---|
| `LandingView` (before first scan) | Same layout; text explains consistency checks |
| `ScanButton` + `ScanProgressBar` + `ScopeControl` (whole page / selector / picked element) | Same |
| WCAG level and version pickers | **Tolerance preset** picker: Strict (1 px) / Normal (2 px) / Relaxed (4 px) |
| `ScoreCard`: score ring + severity donut, in `ResizableSummary` | Same; **Consistency score** |
| `ResultTabs`: All / WCAG issues / Best practices / Needs review / Failed / Passed / Not applicable | All / **Typography** / **Layout & spacing** / **Box style** / Needs review / Failed rules / Passed rules |
| `Filters`: search, severity, Status (Open / Ignored / Baselined) | Same, plus a **peer group** filter |
| `IssueList`: grouped by rule, "3 of 12 ◀ ▶" stepper, rows grouped by shared cause | Same; shared-cause rows such as "Font size 17px, expected 22px × 3" |
| `IssueDetail`: element, measurements, fix, selector, HTML | Same; shows **expected vs actual**, the peer group members, and a "Show peers" button |
| `OverlayMenu`: numbered badges, tab order, headings, landmarks | Numbered badges + **Peer groups**, **Measurements (redline)**, **Spacing grid** layers |
| `ExportMenu`, `SaveScanButton`, `SavedScans`, `CompareView`, `SiteScan`, `ResetButton`, `Toast`, `PageChangedBanner` | Same |
| DevTools panel (scan `$0`) | Same |
| Options page: General, Rules, Categories, Baselines, Import/Export, Privacy, organisation and "Prepared by" | Same sections; Rules section also edits tolerances; adds **Design tokens** import (Phase 5) |

Style: Tailwind v4 with the same `src/styles.css` (system font at 13 px, severity colour tokens, focus outline `#2e86de`), same `Button`, `SelectMenu`, `Popover`, `RowMenu`, `SeverityLabel`, `ScoreRing`, `SeverityDonut` and icon set. The extension's own UI must pass the accessibility extension's scan.

**Severity:** reuse the same colour tokens. High uses `--sev-serious`, Medium `--sev-moderate`, Low `--sev-minor`. Findings that may be intentional go to the **Needs review** tab and do not count in the score, as in the accessibility extension.

### Report (HTML and JSON)

Copy `src/background/exporters/` (html-report, json-report, multipage template, report guidance) and keep the same two-part structure.

| Accessibility report | UI consistency report |
|---|---|
| Header: logo, "Accessibility report", page title and URL | Same; "UI consistency report" |
| **Summary** part (for team leads and clients) | Same |
| Verdict card | Verdict: e.g. "Inconsistent: 3 high-severity layout issues" |
| Key figures: Accessibility score, Issues by severity, Rules | Consistency score, Issues by severity, Rules |
| Fix these first | Same |
| Who is affected | **Where it shows**: the components and sections affected (e.g. "Section cards (5)", "Holiday tiles (6)") |
| What was tested / About this report (limits of automated testing) | Same, with consistency-specific limits (intentional differences, screens delivered as images) |
| **Developer details** part | Same |
| Per element: measurements, colour previews with suggested passing colour, fix, selector, HTML, screenshot | Per element: **expected vs actual** value, peer group, fix, selector, HTML, screenshot **with redline measurements drawn** |
| Grouped by shared cause, XPath and fingerprint under "Technical details" | Same |
| Needs review, Excluded issues, Rules checked, Scan details | Same |
| Multi-page (site scan) report | Same |

---

## Phase 0: Foundation

**Size:** M

**Status: done.** The extension builds, loads and scans end to end; 39 unit tests and 16 browser tests pass. Left for later phases, as planned: the "part of page" scope control, the DevTools panel and the other options-page sections (Phase 4), and the extra generic fixtures (Phases 2–3). The real-site test list is `scripts/real-sites.txt`: 20 public pages (no internal apps; add them there when they can be scanned).

- Create the new project in its own folder with a git repository (the old folder, `../allignment checker`, has none). Keep the old code out of the new source tree.
- Scaffold the new project with the accessibility extension's stack (manifest, side panel, service worker, content script, options page).
- Copy the UI shell as is: `src/styles.css`, the shared components (`Button`, `SelectMenu`, `Popover`, `Toast`, icons…), `App.tsx` layout and the landing view, so the extension looks right from day one.
- Define the finding schema: rule ID, severity, peer group ID, element selector, expected value, actual value, tolerance, fingerprint.
- Create `shared/ui-rules.json`, the rule catalogue (IDs, names, default tolerances, severity, enabled).
- Build fixtures:
  - `fixtures/dashboard-defects.html`: a copy of the reference dashboard **with known defects seeded** (see Appendix A).
  - `fixtures/dashboard-clean.html`: the same page with every defect fixed. Any finding here is a false positive.
  - `fixtures/table-defects.html` and `table-clean.html`: the Employees Directory page (Appendix C).
  - `fixtures/compliance-defects.html` and `compliance-clean.html`: the compliance dashboard (Appendix D).
  - The same card grid built three ways (plain CSS, Tailwind utility classes, hashed CSS-in-JS class names). The hashed-class fixture proves nothing depends on class names.
  - **Later, as each rule is built (Phases 2–3):** more generic fixtures, each with a defects and a clean version: a form page, a pricing/landing page, a settings page with tabs, a modal, an RTL page, a dark-theme page. They are not needed to start.
- **Real-site test list:** agree the list of about 15 public sites and internal apps covering the frameworks and component libraries in the Principle table. They are scanned and reviewed by hand from Phase 2 onwards.
- **Raw results view:** the side panel shows the scan output as a plain list from the start, so every later phase can be tried in the browser as soon as it is built. The full results UI comes in Phase 4.

**Done when:** the extension loads, the scan button runs an empty scan end to end and shows it in the raw results view, and Vitest and Playwright both run in CI.

---

## Phase 1: Page snapshot engine

**Size:** M

**Status: done.** `src/content/snapshot.ts` measures the page in one read-only pass and `src/content/ready.ts` waits for fonts, images in view and a settled layout first. The values measured on `dashboard-defects.html` are checked in a browser test (`tests/e2e/snapshot.spec.ts`; jsdom has no layout, so the unit tests cover the walking, hiding and clipping logic with stubbed boxes). Budget: a 5,200-element test page is a CI check under 1.5 s, and three public pages (an encyclopedia article, a documentation page, a code-hosting page; 3,000–5,300 DOM elements each) took 26–161 ms. Notes for later phases: an `svg` is measured as one box; the snapshot records the `role` attribute only, the state attributes are read in Phase 2; closed shadow roots, cross-origin frames and canvases are listed under "not scanned".

Collect everything the rules need in one pass, so the rules never touch the live DOM.

- Walk every element, including open shadow roots and same-origin iframes.
- Skip hidden elements (`display:none`, `visibility:hidden`, zero size, `opacity:0`, off-screen `aria-hidden` decorations) and the extension's own UI.
- Per element, record:
  - box: `getBoundingClientRect()` in page coordinates
  - **text box**: `Range.getBoundingClientRect()` over its own text nodes (the real text area, not the element box)
  - computed styles: font family (first resolved family), size, weight, style, line height, letter spacing, colour, text align, transform; padding, margin, gap, border, radius, box-shadow, background
  - layout context: parent display (flex/grid/block), flex/grid direction, position
  - structure: tag, role, class list, child count, depth
- **Wait until the page is ready** before measuring: web fonts loaded (`document.fonts.ready`), images in view loaded, and no layout change for a short settle time. Measuring before fonts load gives wrong text sizes.
- Record clipping and scrolling: elements cut off by an `overflow` ancestor, and which scroll container each element is in. Elements scrolled out of view are still measured.
- Font family is the computed `font-family` list. The font actually drawn can differ when the first family is missing; reading it needs the `debugger` permission, so it is left out of the MVP and noted as a limit in the report.
- Performance budget: under 1.5 s for 5,000 elements. Read all layout in one batch (no style writes in between).

**Done when:** the snapshot of `dashboard-defects.html` matches the expected values in a unit test, and the budget is met on 3 real pages.

---

## Phase 2: Peer grouping

**Size:** L (the hardest and most important phase)

**Status: done.** `src/content/grouping.ts` finds the groups from the snapshot, the scan returns them, and the side panel lists them and outlines them on the page (`src/content/overlay/overlay-root.ts`).

- **Met:** every group of Appendices B, C and D is found on the three reference fixtures, in the defects and the clean variant, and elements that are not peers stay apart (`tests/e2e/groups.spec.ts`). The three card grids give identical groups. Grouping a 5,200-element page is a check under 1 s; three public pages took 8–41 ms.
- **Real-site review:** all 20 pages of `scripts/real-sites.txt` were scanned without errors (none was blocked): 2,085 groups in total, the largest page 4,734 elements read in 260 ms and grouped in 55 ms. A sample of 6 groups per page, evenly spread, was judged by reading the members: 117 of 120 correct (97.5%), no page below 5 of 6. The review was done by the assistant that built the engine, on a sample, not by a tester on every group; `node scripts/dump-groups.mjs --sites scripts/real-sites.txt --sample 20 --shots <dir>` repeats it.
- **Fixed during the review:** table cells reported as boxes of a level; striped rows and striped cells split in two; the coloured tokens of code blocks grouped as UI parts (`pre` is now left alone); groups missed inside a member built differently from its peers.
- **Known wrong groups, left for now:** an icon and the label next to it when both are wrappers of the same structure; the rows and cells of a table used for page layout (header, content, footer); a logo and an icon that are both a lone `svg`. One more thing to watch in Phase 3: the same control row repeated in every card of a grid is reported once per card.

How it differs from the steps below, and why:

- **No class names at all** (step 1). The fingerprint is tag, role, the shape of the child tree and the look of the box. Utility and generated class names carry no meaning, and the three card grids prove nothing is lost.
- **Two strengths of match.** The same structure and the same kind of box is enough on its own. A similar structure (or no children) also needs the same look. Members matched only on similarity are peers, but their own parts are not matched with each other: this is what stops unrelated boxes in different cards from being grouped.
- **One odd member joins the group it most resembles** (a title in another size, a link where its peers have plain text, a box built differently in a row of fields), because that member is what the rules must report. A pair never takes in a third.
- **Table rows give one group per column**, not one group of all cells.
- **Level groups** (step 4) are boxes with the same background, border, radius and shadow at the same level, also across plain columns. Width is not compared: the reference dashboard's own columns have different widths. Only their headings (`h1`–`h6`, `role="heading"`) and title rows are grouped further. The controls that share a row (a toolbar) are also a level group.
- **Pagination** (Appendix C) is two groups, the page numbers and Prev/Next: they are different kinds of button.
- **G12 "Links and actions"** (Appendix B) is not a peer group: a link, a text link and a button in three places are not peers. Link style is checked page-wide in Phase 5.
- **For Phase 3:** in "My Details" the name box is a member of the row group but its parts are not matched with the fields' label and value (it is built differently). Defect A7 (name 22 px vs values 17 px) needs the rule to compare the main text of each member.

1. **Structural fingerprint per element:** tag + role + normalised class pattern (hashed/utility classes removed) + shape of the child tree (tags and depth, text ignored).
2. **Sibling groups:** 2 or more siblings with the same or very similar fingerprint (holiday tiles, event cards, tabs, people items).
3. **Cousin groups:** elements with the same fingerprint at the same depth under a common layout ancestor, even with different parents. Example: the 5 section cards spread over two columns.
4. **Level groups (same level, different content):** containers that sit at the same layout level and look like the same kind of box are peers **even when their content differs**. "Same level" means children of the same grid or column set, or of sibling columns. "Same kind of box" means similar background, border, radius, shadow and width class. Example: a stat card, a list card and a table card on one dashboard. Their fingerprints differ, but they are all section cards. For level groups, compare only the **shared slots**: outer inset, title slot (the first prominent text at the top), gaps between the cards, and box style.
5. **Role matching inside a group:** line up descendants of the group members by their path inside the member ("card › header › h2"). This produces groups such as "section titles" and "event location text".
6. **State detection:** mark members that are in a different state from their peers: selected, current, active, disabled, checked or expanded. Read this from standard signals only (`aria-selected`, `aria-current`, `aria-expanded`, `aria-pressed`, `disabled`, `:checked`), never from class names. A lone member of a tab, nav or toggle group that differs from the others in several style properties at once is also treated as "probably the active one". Rules use this to avoid flagging the active tab for being bold.
7. **Debug overlay:** an option to colour each detected group on the page, so testers can see what the tool treats as "the same".

**Done when:** all expected peer groups in Appendices B, C and D are found on the three reference fixtures, with no obvious repeated component missed; the same groups are found in all three versions of the card grid (plain CSS, Tailwind, hashed classes); and on the real-site test list a manual review finds at least 90% of detected groups correct.

---

## Phase 3: Consistency rules (MVP)

**Size:** L

For each peer group: take the **majority value** (mode, or median for measurements), flag members outside the tolerance, and record expected vs actual.

### Comparison logic (applies to every rule)

| Case | What the engine does |
|---|---|
| Clear majority (3 or more members, most agree) | Flag the outliers. Expected = the majority value |
| Group of 2 that differ | Report one finding on the pair ("these two differ"), Medium at most, with no "expected" value |
| No majority (e.g. three titles at 16, 20 and 26 px) | Report one finding on the group ("no consistent value"), listing every value |
| Member in a different state (active tab, disabled button; Phase 2 step 6) | Skip typography, colour and background checks for it. Size, spacing and alignment are still checked |
| Size that depends on content | Text elements and content-sized boxes are never compared by width. LAY-05 applies only to boxes whose size is set by layout (tiles, cards, avatars, buttons in a row) |
| Insets where content doesn't fill the box | Top and left insets are measured from the first content. Right and bottom insets are compared only when the content fills that side (a short centred line has no right inset) |
| One cause, many findings (e.g. a grid placed 50 px too far right moves all 6 tiles) | Report once, on the outermost element that explains it. Findings on its children with the same offset are folded into it |

### Phase 3A: core rules (build first)

These cover the original problem statement: uneven padding, misaligned layout, and font style and size at the same level.

TYP-01, TYP-02, TYP-03, TYP-05, LAY-01, LAY-02, LAY-03, LAY-04, LAY-05, LAY-06.

**Status: done.** The ten rules are in `src/content/rules/` and are marked `implemented` in the catalogue; the other rules are still reported as "not built".

- **Seeded defects:** every defect of these ten rules is reported on all six defect fixtures, by the right rule and on the element the fixture names (`tests/e2e/rules.spec.ts`). Nothing is reported outside the seeded defects.
- **Clean fixtures:** zero findings on all six, under the strict, normal and relaxed presets.
- **Card grids:** the plain, utility-class and hashed-class versions give identical findings.
- **Speed:** the rules take under 20 ms on the fixtures and at most 127 ms on the real-site list; a 5,200-element page is a check under 1 s.
- **Real-site list:** 42 findings over the 20 pages (13 of them for review), at most 13 on one page, five pages with none. They have been read and the clear noise removed (below), but **not yet judged one by one against the "at least 70% accepted" target**: that needs a person looking at each page. `node scripts/dump-findings.mjs --sites scripts/real-sites.txt` prints them.
- **TYP-01** has no seeded defect in any fixture; it is covered by a unit test only.

How the rules work, where the plan left it open:

- **LAY-01 / LAY-02** measure the gap from each edge of a drawn container to its content, but only on sides where the content sits against the padding (a centred child or a stretched card leaves free space, not padding). The margin of the first or last child is taken off. LAY-02 is relative like every other rule: it reports a container that is lopsided **while its peers are even**. One-sided padding on its own is normal (the clean fixtures have many cases), so a lone container is not judged. Tables and table cells are left out.
- **LAY-03** reports on the container: unequal gaps between neighbouring peers, the same group spaced differently in two containers, and two neighbouring gaps in a row that are nearly but not equal (an item meant to sit in the middle). A gap more than twice the usual one is a separator, not a mistake. Stacked blocks of text are not compared: their spacing follows their margins.
  - **Row gap against column gap** (changed after Phase 6): a grid whose row and column gaps differ by more than 2 times is listed **for review**, not as a defect. A grid may be spaced differently across and down on purpose; what must hold is that the columns are evenly spaced among themselves and the rows among themselves, and that is still a definite finding.
  - **Gap between the parts of an item** (added after Phase 6): in items built the same way (a tile with a name and a date), the gap between two stacked parts is compared with the same gap in the peers. Reported only when nearly all items agree (three quarters or more, and at most 15% differ): where the gaps vary from item to item, the parts are spread over a stretched card.
- **LAY-04** has two parts. Peers in one row (or one column) must start on the same line, read from the container's `align-items`. And a **near miss**: an element whose edge is 2–8 px away from an edge that two or more nearby elements share, and that shares its own edge with nothing. Offsets of 8 px or more are treated as deliberate (an indent, another row).
- **LAY-05** compares boxes without children (avatars, icons, images, fields) and only when nearly all members share the size; a size that just follows the text is ignored.
  - **Boxes with content** (added after Phase 6): tiles and cards of one group are compared too. A width is reported when nearly all members share one and the odd box is wider than its text needs (a button that hugs a longer label is not reported). A height is reported when it is not explained by the content: a card that is taller because its text is longer is not reported, nor is the card next to it that the row stretched. A taller row is reported once, on its first box.
- **LAY-06** reports a block that starts further in than the content edge of its own section, when the blocks of these sections normally start at that edge.
- **Needs review instead of a defect:** a member that differs from its peers in colour only (colour often carries a meaning: a status, the current item), and a member that differs in several typographic ways at once (more likely another kind of element).
- **Pair findings** sit on the second element in document order and name both values, since there is no telling which one is wrong.

Changes outside the rules:

- **Grouping:** the texts of a member built differently now join the texts they look like (the name in "My Details" joins the two values), so defect A7 is found. A word or link inside a sentence no longer joins a group as the odd one out.
- **Table fixture:** the header search box ended 5 px short of the content below it in both variants. The near-miss check reported it correctly, so the fixture was fixed (`padding-right: 15px`).

Noise removed after the first run on the real-site list (220 findings then): gaps between links inside sentences, row and column gaps of items that touch, vertical gaps between text blocks, indented sub-items reported as misaligned, table cells of differently sized tables compared with each other, and the cells of a column reported as a different size.

### Phase 3B: second wave

TYP-04, TYP-06, LAY-07 to LAY-10, GRP-01 to GRP-03, BOX-01 to BOX-03.

**Status: done.** All 22 rules of Phase 3 are built (`src/content/rules/`), and none is reported as "not built" any more.

- **Seeded defects:** every remaining defect is reported on the defect fixtures, by its rule and on the element the fixture names: as a definite finding, or for review where the fixture marks the difference as intentional. With Phase 3A that is every seeded defect that has a rule; the ones without a rule belong to Phase 5.
- **Clean fixtures:** no definite finding under the strict, normal and relaxed presets. The only findings there are the two the fixtures list as intentional, for review: the sort icon on three of seven column headers, and the chevron on seven of thirteen navigation items.
- **Unit tests:** every rule has one (`tests/unit/rules.engine.test.ts`), including the four with no seeded defect: TYP-06, LAY-09, BOX-01 and BOX-03 (and TYP-01 from Phase 3A).
- **Speed:** the rules take under 50 ms on the fixtures and at most 169 ms on the real-site list.
- **Real-site list:** 88 findings over the 20 pages, 33 of them for review, at most 25 on one page. The first run of the second wave gave 387; the noise removed is listed below. As in Phase 3A, the remaining findings have been read but **not judged one by one against the "at least 70% accepted" target**.

How the rules work, where the plan left it open:

- **TYP-04** compares line heights in px or as a multiple of the font size, whichever matches: a larger title with the same 1.4 line height is not a different line height.
- **TYP-06** reads the alignment from where the text sits in its box, so it only compares members whose box is wider than their text. Table cells are left to LAY-09.
- **LAY-07** covers a row whose items are centred on purpose (`align-items: center`) or are all of one height, and an icon inside a line of text. LAY-04 no longer compares vertical centres.
- **LAY-08** compares cards, and columns of cards, that start at the same height. Plain lists of different lengths are not compared. For two members the finding sits on the one that ends early.
- **LAY-09** matches a header with the cells that start where it starts and are as wide, compares their alignment and the edge they align on, and reports a cell aligned differently from the rest of its column.
- **LAY-10** compares the heights of the controls of one row. Uneven gaps between such controls are reported under LAY-10 instead of LAY-03.
- **GRP-01** reports a shape with no text and no content among two or more controls, in an element that is a group of controls by its role or is drawn as one box. Thin lines and elements with a decoration role are dividers, not strays.
- **Tuned on a second set of real sites** (after Phase 6): 24 more public pages (admin dashboards, data tables, shops, long lists) were added to `scripts/real-sites.txt`, 44 pages in all. Measured back to back on the 44 pages, definite findings fell from 150 to 55 (live pages load a little differently on each run, so the numbers move by a few); the fixtures find the same seeded defects as before. What changed, all of it generic:
  - **LAY-05**: a box at least a quarter larger or smaller than its peers is another size on purpose (a card that spans two columns, a chart among sparklines) and is not reported; a size must be clearly apart from every peer (three sizes that merely vary are not "two alike and one odd"); an icon beside the text counts as content, so a button that hugs a shorter label is not "narrower"; a layer laid over its parent has the size of that parent.
  - **LAY-01**: a padding value that three or more members share is a second standard (the indent of a sub-level), not a slip; the first item of a stack may leave out its top padding and the last its bottom padding.
  - **LAY-03**: gaps under 8px (links with a "|" between them) are spaced by their text.
  - **LAY-04**: text inside a sentence is found through plain wrappers too; the label of a button is placed by the button; the far end of an item that stops where its content stops is not on a line; a container that starts away from both ends of a row is placed by the row; peers of which many are off, each by another amount, are not set on that edge at all.
  - **LAY-07**: the same icon the same distance off the text three times or more is how the page sets its icons, which is consistent; one that differs is still reported.
  - **LAY-10**: the same smaller control in three toolbars or more is that toolbar's design; two small icon buttons have the size of their icons.
  - **GRP-02**: an item that holds the part in another look (initials for a photo, a filled star for an empty one, an icon in another colour) is not missing it.
  - **BOX-02**: a border in the colour of the box's own fill cannot be seen; a box that also has another size or background is listed for review.
  - **TYP-05**: two peers that differ in colour only are listed for review, like one odd colour in a larger group.
  - **FMT-01**: a date in May reads as the month form its peers use.
  - **Code samples**: nothing inside `pre` or `code` is reported; its colours and spacing are syntax highlighting.
- **GRP-02, icon holders** (changed after Phase 6): an item that is nothing but an icon (a wrapper around it, next to a label that is an item of its own) is not an item "with an icon as a part". Where most owners of a part are like that, the group mixes icon holders and labels, and a label is not reported as missing an icon.
- **GRP-02** follows the plan's split: a part that at least three quarters of a group of five or more have is **missing** in the rest (definite); a part that between a third and three quarters have is listed once **for review**; a part fewer have is an extra of those items. Parts are small things (an icon, a label). A missing **text** is always for review and only counted where the items are links or buttons; the rows and data cells of a table are not judged, since an empty cell is data.
- **GRP-03** takes a divider to be a block with content and a line down or along one side that separates it from a neighbour, and measures how far the line stops from the edges of the nearest drawn container.
- **BOX-01 to BOX-03** compare the members of a group that are drawn as boxes. A border only counts when it runs all the way round and is visible; a circle or pill is "fully rounded" whatever its size; members that touch each other are not compared for radius and border. A different **background** is always for review (it often carries a meaning), and so is any difference in a group of fewer than five (a featured card).
- **Cards of two sections styled differently** (defect A12): groups of inner cards whose sections belong to one level group are compared with each other, for review.

Changes outside the rules:

- **Compliance fixture:** its two columns ended 27 px apart in both variants, which LAY-08 reports. They now end together, as on the dashboard (`align-items: stretch`, last card grows). The chevron on seven of thirteen navigation items is now listed in the fixture as an intentional difference for review, like the sort icons of the table fixture.
- **Grouping:** each group now says whether it is a row of controls.

Noise removed after the first run on the real-site list: underlines under links taken for dividers, quote bars taken for dividers, paragraphs "missing" the links other paragraphs have, table rows "missing" a text, items compared for a text part where the items are not links or buttons, pagination items with a transparent border, larger avatars reported for their radius as well as their size, and column header labels compared for alignment across columns.

### Typography (per role group)
| ID | Check | Default tolerance |
|---|---|---|
| TYP-01 | Font family differs | exact |
| TYP-02 | Font size differs | 0.5 px |
| TYP-03 | Font weight differs | exact |
| TYP-04 | Line height differs | 1 px |
| TYP-05 | Text colour differs (also link vs plain text in the same role) | ΔE < 3 |
| TYP-06 | Text alignment differs (measured from the text box, not `text-align`) | 2 px |

### Layout and spacing
| ID | Check | Default tolerance |
|---|---|---|
| LAY-01 | Inner inset differs: visual gap from container edge to content box, on all 4 sides, across peer containers | 2 px |
| LAY-02 | Uneven internal padding: top/bottom or left/right inset of one container very different | ratio > 1.5 |
| LAY-03 | Uneven gaps between siblings, and row gap vs column gap in a grid | 2 px / ratio > 2 |
| LAY-04 | Edge misalignment: left edges of peer content, title vs body content, page title vs card content | 2 px |
| LAY-05 | Size mismatch of peer boxes (width/height) | 2 px |
| LAY-06 | Content inset of a section differs from sibling sections (e.g. Holidays grid at 70 px vs 20 px) | 4 px |
| LAY-07 | Inline items not vertically centred (icon vs text, label vs value across columns). Compared by text baseline or box centre; text of different sizes sits in different line boxes, so a tighter tolerance gives false findings | 2 px |
| LAY-08 | Peer columns/cards end at different heights | 8 px, low severity |
| LAY-09 | Table: header text not aligned with its column's cell text; one column mixing alignments | 2 px |
| LAY-10 | Toolbar/control group: controls in one row with different heights or uneven gaps (buttons, inputs, toggles) | 2 px |

### Group structure
| ID | Check |
|---|---|
| GRP-01 | Odd member in a group of controls: an element that doesn't match the others in a button/toggle/tab group (e.g. stray dots or radio inputs inside a view toggle) |
| GRP-02 | Repeated items where one lacks a part the others have (e.g. one nav item without a label or icon, one column header without the sort icon). Severity follows how strong the majority is: 12 of 13 nav items with an icon and one without is a real finding; 3 of 7 headers with a sort icon goes to Needs review |
| GRP-03 | Internal dividers or borders that stop short of their container edge in one member but not in its peers |

### Box style
| ID | Check |
|---|---|
| BOX-01 | Border radius differs |
| BOX-02 | Shadow or border style differs |
| BOX-03 | Background differs |

### Text and content (added in Phase 5)
| ID | Check |
|---|---|
| TYP-07 | Link style differs (underline, colour) |
| TXT-01 | Text is cut off or runs out of its box |
| TXT-03 | Text shortened in different ways |
| FMT-01 | Value format differs in one column or list field |
| IMG-01 | Image does not load (added in Phase 6) |

**Severity:** High = most members agree and one or two differ clearly (strong outlier). Medium = small differences or a near-even split. Low = the difference may be intentional.

**Done when (3A):** every seeded defect covered by the core rules is found in all defect fixtures, and the clean fixtures give no findings.

**Done when (3B):** every remaining seeded defect is found, each clean fixture still gives no definite finding, and every rule has a unit test. Tolerances are tuned on the whole test set, never on one page.

---

## Phase 4: Results UI and reports

**Size:** M

**Status: done**, in three parts. The side panel, the options page and the reports are copied from the PalTech Accessibility Testing extension (same component and file names, same classes and styles) with the wording and data of this tool.

- **Results UI:** score card with the severity donut, result tabs (All, Typography, Layout & spacing, Group structure, Box style, Needs review, Failed rules, Passed rules, Peer groups), filters (search, severity, status, peer group), the issue list grouped by rule with shared-cause rows ("Font size 17px, expected 22px × 3"), and an issue view with expected and found values, the values of the group, the peers, the fix, selector and HTML, and a "3 of 12" stepper.
- **Actions:** ignore, intentional and add to baseline, each with a reason; reopen. They are kept per site (by fingerprint), so the next scan keeps the decision, and they are listed and can be removed on the options page.
- **Consistency score** (`shared/scoring.ts`): 100 × (1 − weight of the peer groups with open findings ÷ weight of all peer groups). A group counts by its most severe open finding (High 7, Medium 3, Low 1), a consistent group at the full weight. Findings for review and excluded findings do not count. A finding that is not about a group counts its element as a unit of its own.
- **Overlay:** numbered badges on the open issues (a click opens the issue), the peer groups, and for the open issue its element, its peers (dashed) and the measurement drawn as a redline with its size. The redline is drawn for padding (LAY-01, LAY-02), edges (LAY-04), section inset (LAY-06) and column ends (LAY-08); the other rules show the element and its peers.
- **Settings:** tolerance preset, a tolerance per rule that overrides the preset, rules on or off, minimum group size, organisation and "Prepared by". Options page sections: General, Rules, Baselines, Import / Export, Privacy.
- **Scope:** full page or part of the page, by CSS selector, by picking an element on the page, or (in DevTools) the element selected in the Elements panel.
- **DevTools panel:** the same panel bound to the inspected tab.
- **Reports:** HTML in the two-part layout (Summary: verdict, score, issues by severity, fix these first, where it shows, what was tested, about this report; Developer details: per rule and element), with a screenshot per open finding that shows the element and the redline, and JSON. The panel saves the file, so the extension needs no download permission. Up to 40 screenshots per report; Chrome allows two captures a second, so a report with screenshots takes about half a second per finding.

Checked: browser tests drive the panel on the dashboard fixture (scan, open a rule and an issue, ignore with a reason, rescan, badges, reset), export all three report kinds, scan part of a page by selector and by picking, and change the settings on the options page. The panel, the redline and the report were also looked at as screenshots.

Not done, or not checked:

- The **two-pane layout** of the accessibility panel (list and issue side by side when the panel is wide) is not built: the panel always shows one or the other.
- The **"Spacing grid" overlay layer** is not built.
- The **DevTools panel** is built but has no automated test (a test cannot open DevTools); it has not been opened by hand either.
- The extension's **own UI has not been scanned with the accessibility extension**, as the Look-and-feel section asks.
- **Saved scans, compare, site scan and the page-changed banner** were built in Phase 6.
- "A tester can understand every finding without opening DevTools" has not been tried with a tester.

Build everything in **Look and feel** above, by copying the accessibility extension's side panel, overlay, options page and exporters.

- Side panel results grouped by rule ("Inner inset differs (3)"), with the same instance stepper.
- Each finding shows the group, expected vs actual, and highlights the element **and its peers** on the page.
- **Measurement overlay:** draw the padding/gap/edge being compared with pixel labels (like a design tool redline). This overlay is also captured in the report screenshots.
- Actions: ignore, "intentional" (with reason), add to baseline.
- Settings: tolerance presets and per-rule tolerances, rules on/off, minimum group size. A preset scales every rule's default tolerance (Strict ×0.5, Normal ×1, Relaxed ×2); the px values shown in the picker are for the common 2 px rules.
- **Consistency score:** 0–100, following the shape of the accessibility extension's `shared/scoring.ts`. It is based on the share of checked peer groups that have open findings, weighted by severity, so a page with many groups is not punished for its size. Needs review, ignored and baselined findings do not count.
- HTML/JSON report export with screenshots, in the same two-part layout.

**Done when:** a tester can scan the dashboard, understand every finding without opening DevTools, and export a report. Placed side by side, the side panel and report are visibly the same product family as the accessibility extension.

---

## Phase 5: Page-wide design-scale audit

**Size:** M

**Status: done.** Two parts: a **design-scale audit** of the whole page, and new rules about text.

**TXT-02 was removed after Phase 6.** It reported text shortened with "…" that has no tooltip. A missing tooltip is a functional matter, not a visual inconsistency, and this tool is about padding, fonts, alignment and the like. Truncated cells without a title (table defect D3) are therefore no longer reported. The catalogue has 27 rules.

### The design-scale audit (`src/content/audit.ts`)

A new **Design scale** tab in the panel and a section of the HTML report list the font families, font sizes, font weights, spacing values (padding, margin, gap) and colours (text, background, border) of the page, each with the number of elements that use it. Selecting a value outlines **every** element that uses it on the page and scrolls to the first.

A value that stands out is marked:

| Mark | When |
|---|---|
| Used once | A font size or spacing value used by a single element |
| Off the grid | A spacing value that is not a multiple of 4 px, **only when the page follows a 4 px grid** (75% or more of its spacing is on it). A page that follows no grid gets a note instead of a mark on every value |
| Near-duplicate | A colour within Delta E 5 of a more used colour |
| Not a token | Only with a token file: the value is not one of the team's tokens; the closest token is named |

These marks are **observations about the whole page, not findings**: they are not counted as issues, do not change the score and cannot be ignored or baselined. A page title is the only text of its size on every page, so "used once" as a finding would break the rule that clean fixtures give no definite finding.

**Design tokens** (`shared/tokens.ts`): a token file is loaded on the options page (section "Design tokens") and kept in this browser. Understood: the Design Tokens Community Group format (`$value`, `$type`, inherited types), Tokens Studio for Figma and Style Dictionary (`value`, `type`, token sets), plain nested objects, aliases (`{color.brand.primary}`) and composite typography tokens. Colours are read from hex, rgb() and hsl(); lengths from px, rem and plain numbers. With tokens loaded, a kind of value the file has tokens for is checked against the tokens **instead of** the page; a kind it has none for is still judged against the page. A sample file is in `fixtures/tokens/dashboard.tokens.json`.

### The new rules (`src/content/rules/content.ts`)

| ID | Check | Result |
|---|---|---|
| TYP-07 | Link style: links that are peers (a menu, the name links of a column) and are underlined differently | Definite |
| TYP-07 | Link style: the other links of the page that are styled as links, compared by where they sit (in a sentence or on their own, and on which background): underline, and a colour one or two links have | Needs review: they are not peers |
| TXT-01 | Text cut off by its own box with no ellipsis, or running out of the box it is drawn in | Definite; cut off at the bottom is Needs review |
| TXT-03 | Peers that shorten their text differently: an ellipsis typed into the text where the others are shortened by the browser, or typed ellipses written differently ("...", "…", with a space, after a dangling separator) | Definite |
| FMT-01 | Values of one column or list field in different formats: dates and times | Definite |
| FMT-01 | Numbers: one unit written two ways ("5%" and "5 %"), "1,000" against "1000"; a single lower-case label among capitalised values | Needs review |

Checked:

- **Seeded defects:** the ones that were waiting for this phase are now found on the element the fixture names: inconsistent ellipsis on the dashboard, the table and the compliance page (TXT-03), truncated cells without a title (TXT-02), the two link styles of the dashboard (TYP-07, for review). A new seeded defect covers value formats: one date of joining written "Oct 5, 2026" among "05/10/2026" (FMT-01, table D11).
- **Clean fixtures:** still no definite finding under the strict, normal and relaxed presets.
- **Audit:** on the clean dashboard it lists exactly the values of the fixture's stylesheet (9 font sizes, 3 weights, 15 spacing values, 8 colours). With the sample token file every value of the clean dashboard is a token; on the defects page the five spacing values the seeded defects bring in (19, 29, 39, 50, 68 px) are "not a token".
- **Tests:** 171 unit tests and 77 browser tests pass. The panel tab and the outlines on the page were also looked at as screenshots.
- **Real-site list (20 pages):** the new rules give 32 findings, 13 of them for review: TXT-02 22 (12 definite, all the cells of one table demo that are truly cut), TXT-03 5 (commit messages cut with a typed "…" next to ones cut by the browser), TYP-07 3, FMT-01 2, TXT-01 0. The first run gave 110; the noise removed is listed below. As in Phase 3, the findings have been read but **not judged one by one** against the "at least 70% accepted" target.

Changes outside the new code:

- **Snapshot:** each element now records whether the browser shortens its text, whether a title or label can hold its full text, the end of its text, whether it is a link, and which of its margins are `auto` (the px of an `auto` margin are what the layout had left over, not a spacing value).
- **Fixtures, unseeded issues the new rules found in both variants** (the same way the table header and the compliance columns were fixed in Phase 3):
  - Dashboard: the people names are shortened by their box and had no title. They now carry one.
  - Compliance: the event names are shortened by the table and had no title. They now carry one.
  - Table: every email is shortened by its column, not only the two long ones that had a title; the clean page now titles all of them. The current navigation item was 3 px too narrow for its label, which ran out of its white box; it is now 88 px wide.
  - Compliance D8: the third event name now ends in " - A...", so the three names end in three different ways, as Appendix D says.
- **Dashboard D10** (two link styles) now names the location link and is marked for review: "Show All" and the location link are not peers, so there is no telling which style is meant.

Noise removed after the first run on the real-site list: capitalisation of link and button labels (names of pages, commands and terms), names with their own capitals ("jQuery"), the number of decimals in a column ("4" and "3.7"), which unit a number has, the colour of links that are peers (TYP-05 already compares it), a link colour many links share (links to missing pages), visually hidden skip links reported as cut off, and the menu item that looks like the current one.

Not done, or not checked:

- **Compliance D7** (status rows in 20 px, every other list in 16 px) has **no rule**. The audit lists 20 px with its elements, but nothing says "this list is larger than the other lists". It needs a comparison between unrelated groups, which is not built.
- **Capitalisation** is only compared in one narrow case (one lower-case value among capitalised ones, not on links or buttons). "Title Case" against "Sentence case" is not compared: names make it unreliable.
- **Dates and times** are recognised in English and numeric forms only. A date with a month name in another language is read as text and not compared.
- **Border colours** are read from the top border only, so the colour of a border on one other side is not in the colour list.
- **Radii, shadows, line heights and letter spacing** are not in the audit, and such tokens are skipped.
- **Click-through** outlines all uses and scrolls to the first; there is no "next use" stepper. The panel and the report show the first three elements of each value.
- The token file is **not included** in "Export settings and baselines".
- The audit marks are not part of the JSON report's findings; the JSON report has the whole audit under `audit`.

- Inventory of font families, font sizes, weights, spacing values and colours, with usage counts and a click-through to each use.
- Flag sizes or spacing values used only once, values off a 4/8 px grid, and near-duplicate colours (e.g. two blues within ΔE 5).
- Link style consistency (underlined vs not, colour).
- Text truncation and clipping: overflowing text, truncated text with no tooltip or other way to read it in full, and inconsistent ellipsis (e.g. "Sampath ..." vs "Akhil Thu…").
- Value format consistency in repeated cells: values in one table column or list field that follow different patterns (date formats, number formats, capitalisation).
- **Design tokens input (optional):** import the team's token file (Figma tokens / JSON). When present, check against the tokens instead of the page majority.

**Done when:** the audit on the dashboard lists the real scale, and the token check works with a sample token file.

---

## Phase 6: Scale, CI and the existing features

**Size:** M

**Status: done**, in three parts. Both "done when" conditions are met and tested: the sample Playwright test fails on the defects fixture and passes on the clean one, and a 20-page site scan finishes.

### Part 1: Playwright CI package and the broken-image check

- **CI package** (`ci/`): `ui-check.ts` bundles the extension's own `runScan` and runs it in a Playwright page, so a finding has the same rule, selector and fingerprint in CI and in the extension. `newIssues()` gives the definite findings that are not in the baseline (findings for review never fail a build). `loadBaseline()` reads the file `writeBaseline()` writes, the export of the options page, a JSON report or a list of fingerprints. `scanAtWidths()` scans at several viewport widths. `example.spec.ts` is a sample test driven by environment variables; see `ci/README.md`.
- **IMG-01 "Image does not load"** (rule 28). It does the job of the old alignment checker's broken-image detector but shares no code with it: the old one loaded every image again with a 5-second limit, which is where its false positives came from. The new check reads the browser's own verdict (an image that finished loading with nothing to draw, or a background image the server answered with an error for). Nothing is loaded again and nothing is waited for, so an image that is still loading is never reported.

### Part 2: Saved scans, compare, page-changed banner

Copied from the accessibility extension (`SavedScans`, `SaveScanButton`, `CompareView`, `PageChangedBanner`, `RowMenu`, `ScoreRing`, `spa-observer.ts`, the saved-scan part of `storage.ts`).

- **Saved scans:** save the result of a tab under a name, with or without screenshots; list, open read-only, rename, export, delete. Kept in this browser, at most 100. Several ticked scans export as one report.
- **Compare** (`shared/compare.ts`): two saved scans, or one and the current scan, as new / fixed / unchanged by fingerprint, with the score and the counts side by side. It warns when the two scans are of different addresses or window widths.
- **Page changed:** after a scan the content script watches the page; the panel offers a rescan when a single-page app goes to another route, a dialog opens or more than a fifth of the content changes. A rescan is offered, never started on its own.

### Part 3: Site scan and cross-page consistency

- **Site scan** (`shared/site-crawl.ts`, `src/background/site-scan.ts`, `SiteScan`), copied from the accessibility extension: find the pages of an application (sitemap, links, links a script-built page shows), let the tester tick them, then open each in a window of its own and scan it with the normal scan. Pause, resume, stop, rescan one page or all, add a page by hand. The run survives a closed panel.
- **Screen width:** the pages are scanned at the width set in the form (default 1280). One width per run; scan again for another width.
- **Cross-page consistency** (`src/content/parts.ts`, `shared/cross-page.ts`): every full-page scan now records the parts a page shares with the rest of its site: page title (`h1`), header, navigation, footer and tab bars, found from standard elements and roles. When a site scan ends the parts are matched across the pages and compared like the members of a peer group: the value most pages have is expected, and the pages that differ are reported.

  | Part | Compared |
  |---|---|
  | Page title | Left edge, vertical position, font size, weight and family; colour for review |
  | Header, footer | Height, background |
  | Navigation | Left and top edge, width, background, font; for each item, whether it shows a label and whether it shows an icon; number of items for review |
  | Tab bar | Height, font |
  | Any part | Missing on a few pages while three quarters or more have it: for review |

- **Site report:** one HTML or JSON file with an overview of the pages, what differs across them, and every page with its issues.

Checked:

- **Sample CI test** (`tests/e2e/ci.spec.ts` runs it the way a pipeline would): passes on the clean dashboard, fails on the defects dashboard with the issues listed, passes on the defects dashboard once its issues are written to the baseline, and reports only a newly added defect on a baselined page.
- **20-page site scan** (a made-up application of twenty pages served by the test): all twenty pages found and scanned in about 1.8 minutes. The three pages seeded with a difference in a shared part are reported and no other: the page title 6 px further right, the page title in 32 px instead of 28 px, a navigation item without its label. The one page with an inconsistency of its own is the only page with an issue.
- **Screen width:** a site scan asked for 768 px gives results measured at 768 px.
- **Saved scans and compare:** save, compare with the page after fixing a defect (the fixed issue is listed as fixed, nothing as new), open read-only, export, rename, delete.
- **Page changed:** the banner appears on a new route and on a dialog, and not while the extension draws on the page.
- **IMG-01:** found on the compliance defect fixture (new defect D11); no finding on the 20 pages of the real-site list.
- **Tests:** 189 unit tests and 88 browser tests pass. The saved scans, the comparison, the site scan and the site report were also looked at as screenshots.

Not done, or not checked:

- **Several widths in one site scan** are not built: a run has one width. The CI package scans several widths in one call.
- **A width of 375 px in the extension has not been tried in a visible browser.** The scan window is an ordinary browser window, and a browser may refuse to make one that narrow; the result then says the width it was really scanned at. The test ran headless at 768 px.
- **Cross-page findings cannot be ignored or baselined**, and are not part of any score. They are listed in the panel and the site report only.
- **Toolbars and pagination** are not compared across pages (the plan lists them): they have no standard element or role that most applications use. An application built from plain `div`s with no `h1`, `header`, `nav` or roles has no shared parts to compare.
- **Cross-page comparison was tuned on the made-up application only.** It has not been run on a real application, so its noise there is unknown.
- **The site report** is built from the single-page report's styles, not from the accessibility extension's multi-page template.
- **Opening a site-scan page shows its results read-only.** The accessibility extension can also open the page in the tester's tab and draw the issues on it; that is not built.
- **The site scan was tested on a served test site**, not on a site with a login, a sitemap or thousands of pages; that logic is the accessibility extension's, copied unchanged.
- **A broken image with `alt=""` and no size** takes no space, so it is not measured and not reported.
- **The CI package is a folder of this repository**, not a published npm package.

- Site scan (reuse `site-scan.ts`) and scans at several viewport widths (e.g. 1440, 1024, 768, 375).
- **Cross-page consistency:** in a site scan, match shared parts across pages (header, page title, sidebar, tab bars, toolbars, pagination) by structure and compare them, e.g. the page title in the same position and font on every page, and the sidebar showing labels the same way on every page.
- SPA rescans, saved scans, compare two scans as new / fixed / unchanged.
- **Playwright CI package:** the same engine and rule catalogue run in CI on generated screens, with baselines so CI fails only on new issues.
- Port the broken-image detector from the current project (fix the 5-second timeout false positives).

**Done when:** a sample Playwright test fails on the defects fixture and passes on the clean one, and a 20-page site scan finishes.

---

## Phase 7 (optional): AI assist

**Size:** M

- Send a screenshot plus the findings to a vision model to remove likely-intentional findings and explain the rest in plain language.
- Compare the page against the source Figma frame (via the Figma MCP/API), for teams that have one.
- Off by default and opt-in per site: this phase sends screenshots of the application to an outside service, which is not acceptable for every client application. Phases 0–6 send nothing off the machine.

---

## Success measures

| Measure | Target |
|---|---|
| Seeded defects found on fixtures | 100% |
| Findings on clean fixtures (we wrote them, so any finding is a bug) | 0 |
| Real-site test list: scans that finish without errors | 100% |
| Real-site test list: findings accepted as real on manual review | ≥ 70% per site, no site below 50% |
| Findings accepted as real by UI/UX reviewers, on 10 real AI-generated screens | ≥ 80% |
| Scan time, 5,000-element page | < 1.5 s snapshot, < 3 s total |

## Risks

| Risk | Mitigation |
|---|---|
| Wrong peer groups produce noisy results | Phase 2 debug overlay, review on real apps before Phase 3; minimum group size setting |
| Intentional differences (featured card, active tab) flagged | State detection from ARIA and standard attributes, never class names (Phase 2 step 6); "Intentional" marking; baselines |
| Two copies of the UI code (accessibility and this extension) drift apart | Same file and component names; decide on a shared package or a merged suite after Phase 4 |
| Utility-class CSS (Tailwind) makes class patterns useless | Fingerprint on child-tree shape first, classes second |
| Rules quietly tuned to the pages the team tests most | Tune only on the full test set; review results from the real-site list on every release |
| Very different layout conventions (dense data tables, RTL, dark themes) | Dedicated fixtures; relative checks against the page's own peers rather than fixed values |
| Screens delivered as images or Figma, not HTML | Out of scope for the extension; covered by Phase 7 |
| Closed shadow DOM, cross-origin iframes, canvas | Report as "not scanned" areas |

---

## Appendix A: Seeded defects in the dashboard fixture

Taken from the reference screenshot.

1. Organization title top inset 42 px vs 33 px in other cards (LAY-01)
2. My Details bottom inset about 68 px vs 34 px top (LAY-02)
3. Holidays grid starts 70 px from card edge vs 20 px elsewhere (LAY-06)
4. Holiday tiles: column gap 68 px vs row gap 19 px (LAY-03, needs review: the columns are evenly spaced and so are the rows)
5. "PJR Stadium" blue link vs "Equinox" black text (TYP-05)
6. Location text lower than date and time text (LAY-07). In the fixture, seed this at 3 px so it is above the 2 px tolerance; the 1–2 px seen in the screenshot is below it and would not be reported
7. My Details: name 22 px vs other values 17 px; label/value order inverted; column tops misaligned (TYP-02, LAY-04)
8. "Dashboard" page title 4 px off the card content edge (LAY-04)
9. Inconsistent ellipsis on people names (TXT-03)
10. "Show All" underlined vs "PJR Stadium" not underlined (TYP-07, needs review: the two links are not peers)
11. One avatar larger than the others (LAY-05)
12. Event cards white with border vs holiday tiles grey with shadow (BOX-02, low)
13. Sidebar: Home without label, Me and Organization with labels (structure, low)
14. Left column ends 50 px above right column (LAY-08)
15. One holiday tile has its date 12 px below the name, the other five 4 px (LAY-03; added after Phase 6, not in the reference screenshot)

## Appendix B: Expected peer groups on the dashboard

| # | Group | Members |
|---|---|---|
| G1 | Page columns | Left, right |
| G2 | Section cards | My Details, Organization, Pending Actions, Upcoming Events, Holidays |
| G3 | Section titles | The 5 card headings |
| G4 | My Details fields | Name/role, Reporting To, Shift Details |
| G5 | Event cards | 2 |
| G6 | Event detail items | Date, location, time |
| G7 | Holiday tiles | 6 |
| G8 | Tabs | Birthdays, Work Anniversaries, New Joinees |
| G9 | Sub-headings | Today, Next 7 days |
| G10 | People items | 8 |
| G11 | Sidebar nav items | Home, Me, Organization |
| G12 | Links and actions | Show All, PJR Stadium, User Manual |

## Appendix C: Second reference screen, Employees Directory (data table)

Fixture `fixtures/table-defects.html` and `table-clean.html`. A different page type from the dashboard: tab bar, search, toolbar, data table and pagination. Values are estimates from the screenshot.

**Expected peer groups:** tabs (3); toolbar controls (search, Customize Columns, Filter, view toggle); view toggle items; column headers (7); table rows (10); cells per column; avatars; pagination items (Prev, 1–5, Next); sidebar nav items (3).

**Seeded defects:**
1. View toggle group contains two stray round markers (a black dot and an orange ring) that don't match the toggle buttons (GRP-01)
2. Ellipsis inconsistent: "Senior Software …" (space before) vs "Trainee Software…" and "Principal Softwa…" (TXT-03)
3. Truncated emails and job titles: check that the full text is available (tooltip) (not checked: out of scope, see Phase 5)
4. Sort icon on Employee ID, Name and Date of Joining only (GRP-02, needs review: probably intentional)
5. Tab text "Employees Directory" starts about 6 px right of the table text column (x 146 vs 140) (LAY-04)
6. Toolbar controls slightly different heights (Customize Columns vs Filter vs view toggle) (LAY-10)
7. Pagination: gap Prev → 1 about 90 px vs 5 → Next about 100 px; "Prev" not aligned with the table text edge (LAY-03, LAY-04)
8. Page Size box right edge about 7 px inside the table's right edge (LAY-04)
9. Avatars: photos vs one initials badge ("BD"); check equal size (LAY-05; the initials badge itself is a normal fallback)
10. Sidebar: active item (Organization) has no label while Home and Me do (GRP-02); the same pattern on the dashboard is a cross-page check (Phase 6)
11. One date of joining written "Oct 5, 2026", the others as 05/10/2026 (FMT-01; added in Phase 5, not in the reference screenshot)

**Checks that should pass (not flagged):** row heights equal; column header and cell left edges aligned; header text style the same on all columns; date format the same in every row; table and search box left edges aligned.

## Appendix D: Third reference screen, compliance dashboard (different product)

A screen from a **different product** with a different design language: wide left navigation, stat cards with linked lists, a status list with coloured bars, an accordion with a table, and a chart card. It tests that nothing depends on our own applications.

Fixture `fixtures/compliance-defects.html` and `compliance-clean.html`. **Copy the layout only:** neutral product name, no logo or branding, made-up labels and numbers.

**Expected peer groups:** section cards (2 stat cards, chart card, status card, accordion cards) as a **level group** (Phase 2 step 4); stat card numbers and labels; linked list rows; status rows; accordion headers; table columns; sidebar nav items (13); header controls (search, help button, language, user, apps menu).

**Seeded defects:**
1. Section titles at the same level in very different sizes: "Broker Feed Account Status" about 16 px, "Overdue Certifications" about 20 px, "Trade Rule Violations" about 26 px (TYP-02 on the level group's title slot)
2. Sidebar: "Violations Log" is the only item with no icon (GRP-02, real finding: 12 of 13 have one)
3. First stat card: the vertical divider stops about 40 px above the card bottom, while in the second card it reaches the bottom (GRP-03, LAY-02)
4. Gaps between cards: left column about 21 px then 17 px; right column about 35 px (LAY-03)
5. Trade Rule Violations card: inner left edges at about 21 / 27 / 21 / 15 px (title, period dropdown, tabs, green box) (LAY-04)
6. List row "33 SMCR Certification Section Ready to Complete" wraps to 2 lines with a tighter line height than the other rows; its chevron is not centred on the text (TYP-04, LAY-07)
7. Status rows text about 20 px, larger than every other list on the page (about 16 px) (no rule: the design-scale audit lists the size and where it is used)
8. Truncated event names end in three different ways: " - ...", " ..." and " - A..." (TXT-03)
9. Header controls different heights: search about 45 px vs "Need Help?" about 33 px (LAY-10)

10. The mark next to the product name points at a file that does not exist (IMG-01; added in Phase 6, not in the reference screenshot)

**Checks that should pass:** stat card numbers same size and colour; stat card label spacing; left edges of left-column cards; right edges of right-column cards; status row heights; table row heights; Company/Personal toggle halves equal width.
