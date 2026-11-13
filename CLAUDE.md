# PalTech UI Consistency Checker

Chrome MV3 extension that scans any web page for visual inconsistencies between
elements that should look the same (padding, alignment, fonts).

Read [PLAN.md](PLAN.md) before starting work: it has the phases, the rule list,
the comparison logic and the status of each phase. Update the phase status in
PLAN.md and the table in README.md when a phase is finished.

## Rules that override everything else

1. **Generic.** The extension must work on any web application with no setup.
   Never put selectors, class names, IDs, text or layouts of a specific
   application in `src/` or `shared/`. Decide everything from the rendered DOM,
   computed styles and measured boxes. Read element state (selected, current,
   disabled) from ARIA and standard attributes, never from class names. The
   fixtures' `data-fx` attributes are for tests only; the engine must not read
   them.
2. **Same look as PalTech Accessibility Testing** (`../Paltech-Accessibility-Inspector`).
   For UI and reports, copy its components and exporters and change only the
   wording and the data. Do not restyle. Keep file and component names the same.
3. **Honest results.** A rule with no check is reported as `notImplemented`,
   never as passed. When a check is built, set `implemented: true` for it in
   `shared/ui-rules.json`.
4. **Tune on the whole test set**, never on one page. A rule that only works on
   one fixture is not done. Clean fixtures must give zero definite findings.
5. **Nothing leaves the machine** in Phases 0–6.

## Commands

- `npm run build` type-checks and builds into `dist/`
- `npm test` runs the unit tests (Vitest, jsdom; no layout, so stub boxes)
- `npm run test:e2e` runs the browser tests against `dist/`; build first
- `npm run fixtures:build` rebuilds the fixture pages after editing `fixtures/src`
- `node scripts/make-rules.mjs` rewrites the rule catalogue from its table
- `node scripts/dump-groups.mjs <fixture or URL>` prints the peer groups of a page

## Layout

- `shared/` data model (`types.ts`), messages, rule catalogue
- `src/content/scanner.ts` the scan pipeline: snapshot, peer groups, rules
- `src/content/snapshot.ts` the page snapshot; rules read it, never the live DOM
- `src/content/grouping.ts` peer groups, from the snapshot only; never reads class names
- `src/content/overlay/` what the extension draws on the page
- `src/background/` service worker and content-script injection
- `src/sidepanel/`, `src/options/` React UI
- `fixtures/src/*.template.html` one template gives a `-defects` and a `-clean`
  page; never edit the generated pages in `fixtures/`

## Conventions

- Test fixtures use made-up names, products and data, never real ones.
- Commit only when asked.
