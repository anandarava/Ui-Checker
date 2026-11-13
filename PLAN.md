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
- **LAY-03** reports on the container: unequal gaps between neighbouring peers, a grid whose row and column gaps differ by more than 2 times, the same group spaced differently in two containers, and two neighbouring gaps in a row that are nearly but not equal (an item meant to sit in the middle). A gap more than twice the usual one is a separator, not a mistake. Stacked blocks of text are not compared: their spacing follows their margins.
- **LAY-04** has two parts. Peers in one row (or one column) must start on the same line, read from the container's `align-items`. And a **near miss**: an element whose edge is 2–8 px away from an edge that two or more nearby elements share, and that shares its own edge with nothing. Offsets of 8 px or more are treated as deliberate (an indent, another row).
- **LAY-05** compares boxes without children (avatars, icons, images, fields) and only when nearly all members share the size; a size that just follows the text is ignored.
- **LAY-06** reports a block that starts further in than the content edge of its own section, when the blocks of these sections normally start at that edge.
- **Needs review instead of a defect:** a member that differs from its peers in colour only (colour often carries a meaning: a status, the current item), and a member that differs in several typographic ways at once (more likely another kind of element).
- **Pair findings** sit on the second element in document order and name both values, since there is no telling which one is wrong.

Changes outside the rules:

- **Grouping:** the texts of a member built differently now join the texts they look like (the name in "My Details" joins the two values), so defect A7 is found. A word or link inside a sentence no longer joins a group as the odd one out.
- **Table fixture:** the header search box ended 5 px short of the content below it in both variants. The near-miss check reported it correctly, so the fixture was fixed (`padding-right: 15px`).

Noise removed after the first run on the real-site list (220 findings then): gaps between links inside sentences, row and column gaps of items that touch, vertical gaps between text blocks, indented sub-items reported as misaligned, table cells of differently sized tables compared with each other, and the cells of a column reported as a different size.

### Phase 3B: second wave

TYP-04, TYP-06, LAY-07 to LAY-10, GRP-01 to GRP-03, BOX-01 to BOX-03.

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

**Severity:** High = most members agree and one or two differ clearly (strong outlier). Medium = small differences or a near-even split. Low = the difference may be intentional.

**Done when (3A):** every seeded defect covered by the core rules is found in all defect fixtures, and the clean fixtures give no findings.

**Done when (3B):** every remaining seeded defect is found, each clean fixture still gives no findings, and every rule has a unit test. Tolerances are tuned on the whole test set, never on one page.

---

## Phase 4: Results UI and reports

**Size:** M

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
4. Holiday tiles: column gap 68 px vs row gap 19 px (LAY-03)
5. "PJR Stadium" blue link vs "Equinox" black text (TYP-05)
6. Location text lower than date and time text (LAY-07). In the fixture, seed this at 3 px so it is above the 2 px tolerance; the 1–2 px seen in the screenshot is below it and would not be reported
7. My Details: name 22 px vs other values 17 px; label/value order inverted; column tops misaligned (TYP-02, LAY-04)
8. "Dashboard" page title 4 px off the card content edge (LAY-04)
9. Inconsistent ellipsis on people names (Phase 5)
10. "Show All" underlined vs "PJR Stadium" not underlined (Phase 5)
11. One avatar larger than the others (LAY-05)
12. Event cards white with border vs holiday tiles grey with shadow (BOX-02, low)
13. Sidebar: Home without label, Me and Organization with labels (structure, low)
14. Left column ends 50 px above right column (LAY-08)

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
2. Ellipsis inconsistent: "Senior Software …" (space before) vs "Trainee Software…" and "Principal Softwa…" (Phase 5)
3. Truncated emails and job titles: check that the full text is available (tooltip) (Phase 5)
4. Sort icon on Employee ID, Name and Date of Joining only (GRP-02, needs review: probably intentional)
5. Tab text "Employees Directory" starts about 6 px right of the table text column (x 146 vs 140) (LAY-04)
6. Toolbar controls slightly different heights (Customize Columns vs Filter vs view toggle) (LAY-10)
7. Pagination: gap Prev → 1 about 90 px vs 5 → Next about 100 px; "Prev" not aligned with the table text edge (LAY-03, LAY-04)
8. Page Size box right edge about 7 px inside the table's right edge (LAY-04)
9. Avatars: photos vs one initials badge ("BD"); check equal size (LAY-05; the initials badge itself is a normal fallback)
10. Sidebar: active item (Organization) has no label while Home and Me do (GRP-02); the same pattern on the dashboard is a cross-page check (Phase 6)

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
7. Status rows text about 20 px, larger than every other list on the page (about 16 px) (Phase 5 size scale; needs review)
8. Truncated event names end in three different ways: " - ...", " ..." and " - A..." (Phase 5)
9. Header controls different heights: search about 45 px vs "Need Help?" about 33 px (LAY-10)

**Checks that should pass:** stat card numbers same size and colour; stat card label spacing; left edges of left-column cards; right edges of right-column cards; status row heights; table row heights; Company/Personal toggle halves equal width.
