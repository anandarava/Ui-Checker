# UI consistency checks in CI

The same scan as the extension, run by Playwright. A build fails only on
issues that are not in the baseline, so a team can adopt the check on a page
that is not clean yet.

Nothing leaves the machine: the page is read in the browser Playwright drives.

## Run the sample test

```sh
# Fails when the page has issues that are not in ./ui-baseline.json
UICHECK_URL=https://staging.example.test/orders npx playwright test -c ci/playwright.config.ts

# Accept the issues the page has today
UICHECK_URL=https://staging.example.test/orders UICHECK_UPDATE_BASELINE=1 npx playwright test -c ci/playwright.config.ts
```

| Variable | Meaning |
|---|---|
| `UICHECK_URL` | Page to scan, or several separated by spaces. The test skips itself when unset. |
| `UICHECK_BASELINE` | Baseline file. Default `./ui-baseline.json`. A missing file is an empty baseline. |
| `UICHECK_UPDATE_BASELINE` | `1` writes the issues found as the new baseline instead of failing. |
| `UICHECK_WIDTHS` | Viewport widths, e.g. `1440,1024,768,375`. Default `1440`. |
| `UICHECK_PRESET` | `strict`, `normal` or `relaxed`. Default `normal`. |
| `UICHECK_TOKENS` | A design-token file; the design scale is checked against it. |
| `UICHECK_ORIGIN` | With a baseline exported from the options page: the site whose baseline to use. Default: every site in the file. |

## Use it in your own tests

```ts
import { test, expect } from "@playwright/test";
import { scanPage, scanAtWidths, loadBaseline, newIssues, describeIssues } from "./ci/ui-check";

test("the orders page is consistent", async ({ page }) => {
  await page.goto("/orders");
  const result = await scanPage(page);
  const fresh = newIssues(result, loadBaseline("ui-baseline.json"));
  expect(fresh, describeIssues(fresh)).toEqual([]);
});
```

- `scanPage(page, options)` returns the result the extension gives: findings,
  peer groups, score, rule outcomes and the design scale.
- `scanAtWidths(page, [1440, 768, 375], options)` resizes the viewport and scans at each width.
- `newIssues(result, baseline)` gives the definite findings that are not in
  the baseline. Findings listed for review never fail a build.
- `writeBaseline(file, results)` writes the open issues as the baseline.

Options: `preset`, `selector` (scan part of the page), `rules`,
`disabledRules`, `minGroupSize`, `tolerances` and `tokens`.

## Baselines

A finding is recognised by its fingerprint: the rule, the selector of the
element and what was compared. It does not contain the address of the page, so
a baseline made on one environment works on another.

`loadBaseline` reads:

1. the file `writeBaseline` writes;
2. the file the extension exports (Options > Import / Export > Export settings
   and baselines): every finding a tester ignored, added to the baseline or
   marked intentional;
3. a JSON report of the extension: every finding in it is accepted;
4. a plain array of fingerprints.

A finding comes back as new when its element gets another selector (the
markup around it changed) or its text changes.
