/**
 * The snapshot engine against real layout (PLAN.md, Phase 1).
 *
 * The unit tests run in jsdom, which lays nothing out, so the measured values
 * are checked here: src/content/snapshot.ts is bundled and run inside a plain
 * Chromium page, without the extension. The fixtures' `data-fx` attributes are
 * read by this test only, to find the elements to check.
 */
import { test, expect } from "@playwright/test";
import type { ElementSnapshot } from "@src/content/snapshot";
import { fixtureUrl, takeSnapshot, type Snap } from "./support/engine";

test.use({ viewport: { width: 1440, height: 900 } });

function get(snap: Snap, name: string): ElementSnapshot {
  const index = snap.named[name];
  if (index === undefined) throw new Error(`"${name}" is not in the snapshot`);
  return snap.elements[index];
}

test.describe("snapshot", () => {
  test("measures the dashboard fixture with its seeded defects", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-defects"));
    const snap = await takeSnapshot(page);

    // Every entry is a visible box, and parents come before their children.
    for (const el of snap.elements) {
      expect(el.box.width).toBeGreaterThan(0);
      expect(el.box.height).toBeGreaterThan(0);
      expect(el.parent).toBeLessThan(el.index);
    }
    expect(snap.elements.some((el) => el.tag === "script" || el.tag === "style")).toBe(false);
    expect(snap.notScanned).toEqual([]);

    // Typography.
    const title = get(snap, "page-title");
    expect(title.text).toBe("Dashboard");
    expect(title.style).toMatchObject({ fontFamily: "system-ui", fontSize: 28, fontWeight: 400, color: "rgb(11, 74, 143)" });
    expect(title.box.x).toBe(139); // 100px sidebar + 39px margin (D8)
    expect(get(snap, "who-name").style.fontSize).toBe(22); // D7
    expect(get(snap, "show-all").style.textDecorationLine).toBe("underline");

    // The text box is the text, not the element: the title text is as wide as its words.
    expect(title.textBox).not.toBeNull();
    expect(title.textBox!.x).toBeCloseTo(title.box.x, 0);
    expect(title.textBox!.width).toBeLessThan(400);
    expect(title.textBox!.height).toBeLessThanOrEqual(title.box.height + 1);

    // Padding (D1, D2).
    const details = get(snap, "card-details");
    const org = get(snap, "card-org");
    expect(details.box.x).toBe(115);
    expect(details.style.padding).toEqual({ top: 20, right: 20, bottom: 68, left: 20 });
    expect(org.style.padding).toEqual({ top: 29, right: 20, bottom: 20, left: 20 });
    expect(org.style.radius).toEqual({ topLeft: 12, topRight: 12, bottomRight: 12, bottomLeft: 12 });
    expect(org.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(org.textBox).toBeNull();
    expect(org.box.y).toBeCloseTo(details.box.y + details.box.height + 26, 1); // the column gap

    // Layout context.
    const column = get(snap, "col-left");
    expect(column.layout).toMatchObject({ display: "flex", direction: "column", parentDisplay: "grid" });
    expect(column.style.gap.row).toBe(26);
    expect(details.layout).toMatchObject({ parentDisplay: "flex", parentDirection: "column", position: "static" });

    // The holidays grid (D3, D4) and its tiles (D12).
    const grid = get(snap, "holiday-grid");
    const card = snap.elements[grid.parent];
    expect(grid.layout.display).toBe("grid");
    expect(grid.style.gap).toEqual({ row: 19, column: 68 });
    expect(grid.box.x - card.box.x).toBeCloseTo(70, 1);
    expect(grid.children).toHaveLength(6);
    const tile = get(snap, "tile-1");
    expect(tile.layout.parentDisplay).toBe("grid");
    expect(tile.style.boxShadow).not.toBe("none");
    expect(tile.style.radius.topLeft).toBe(10);
    const [t1, t2, , t4] = grid.children.map((i) => snap.elements[i]);
    expect(t2.box.x - (t1.box.x + t1.box.width)).toBeCloseTo(68, 1);
    expect(t4.box.y - (t1.box.y + t1.box.height)).toBeCloseTo(19, 1);

    // Sizes (D11): a 50% radius is resolved to px.
    const avatar = get(snap, "avatar-2");
    expect(avatar.box).toMatchObject({ width: 44, height: 44 });
    expect(avatar.style.radius.topLeft).toBe(22);

    // The moved location item (D6).
    const location = get(snap, "ev-loc-1");
    const row = snap.elements[location.parent].children.map((i) => snap.elements[i]);
    expect(location.layout.position).toBe("relative");
    expect(location.box.y - row[0].box.y).toBeCloseTo(3, 1);

    // Structure (D13).
    expect(get(snap, "nav-home")).toMatchObject({ tag: "a", childCount: 1 });
    expect(snap.elements[get(snap, "nav-home").parent]).toMatchObject({ tag: "nav", childCount: 3 });
  });

  test("measures the clean dashboard without the seeded values", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-clean"));
    const snap = await takeSnapshot(page);
    expect(get(snap, "page-title").box.x).toBe(135);
    expect(get(snap, "card-org").style.padding).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
    expect(get(snap, "card-details").style.padding.bottom).toBe(20);
    expect(get(snap, "who-name").style.fontSize).toBe(17);
    expect(get(snap, "holiday-grid").style.gap).toEqual({ row: 20, column: 20 });
    expect(get(snap, "avatar-2").box).toMatchObject({ width: 40, height: 40 });
    expect(get(snap, "nav-home").childCount).toBe(2);
  });

  test("the three card grids give the same measurements", async ({ page }) => {
    const shapes: Array<Array<Omit<ElementSnapshot, "classList" | "tag">>> = [];
    for (const name of ["grid-plain", "grid-utility", "grid-hashed"]) {
      await page.goto(fixtureUrl(`${name}-defects`));
      const snap = await takeSnapshot(page);
      // The three pages differ in tags and class names only; every measurement must match.
      shapes.push(snap.elements.map(({ classList: _classList, tag: _tag, ...rest }) => rest));
    }
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  test("reads shadow DOM and same-origin frames, and skips what is hidden", async ({ page }) => {
    await page.setContent(`<!doctype html>
      <style>
        body { margin: 0; font: 16px/20px Arial, sans-serif; }
        .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
        #scroller { width: 200px; height: 100px; overflow: auto; border: 2px solid #000; }
        #scroller p { margin: 0; height: 60px; }
        iframe { display: block; width: 300px; height: 80px; border: 5px solid #000; margin-left: 40px; }
      </style>
      <p id="centred" style="margin:0; width:400px; text-align:center">Hi</p>
      <span class="sr" id="sr">Screen reader only</span>
      <div id="gone" style="display:none"><b id="gone-child">x</b></div>
      <div id="faded" style="opacity:0"><b id="faded-child">x</b></div>
      <details><summary id="summary">More</summary><p id="collapsed">Hidden until opened</p></details>
      <div id="scroller"><p id="row1">1</p><p id="row2">2</p><p id="row3">3</p></div>
      <x-card id="host"><span id="slotted">Slotted</span></x-card>
      <iframe id="same" srcdoc="<body style='margin:0'><p id='in-frame' style='margin:10px 0 0 20px'>Framed</p></body>"></iframe>
      <iframe id="other" src="data:text/html,<p>Other origin</p>"></iframe>
      <canvas id="chart" width="50" height="50"></canvas>
      <script>
        document.getElementById("host").attachShadow({ mode: "open" }).innerHTML =
          '<div id="shadow-part" style="padding:8px"><slot></slot></div>';
      </script>`);
    await page.frameLocator("#same").locator("#in-frame").waitFor();
    const snap = await takeSnapshot(page);

    for (const hidden of ["sr", "gone", "gone-child", "faded", "faded-child", "collapsed"]) {
      expect(snap.named[hidden], hidden).toBeUndefined();
    }
    expect(snap.named.summary).toBeDefined();

    // Centred text: the element is 400px wide, the text box sits in its middle.
    const centred = get(snap, "centred");
    const textBox = centred.textBox!;
    expect(centred.box.width).toBe(400);
    expect(textBox.width).toBeLessThan(40);
    expect(textBox.x - centred.box.x).toBeCloseTo(centred.box.x + centred.box.width - (textBox.x + textBox.width), 0);

    // Scroll container: rows scrolled out of view are still measured.
    const scroller = get(snap, "scroller");
    expect(scroller.scrolls).toBe(true);
    expect(get(snap, "row1")).toMatchObject({ clip: "none", scrollContainer: scroller.index });
    expect(get(snap, "row2")).toMatchObject({ clip: "partial", clippedBy: scroller.index });
    expect(get(snap, "row3")).toMatchObject({ clip: "full", clippedBy: scroller.index });
    expect(get(snap, "row3").box.y - get(snap, "row1").box.y).toBe(120);

    // Shadow DOM: the shadow tree and the slotted element are both measured.
    const part = get(snap, "shadow-part");
    const slotted = get(snap, "slotted");
    expect(part.inShadowTree).toBe(true);
    expect(part.style.padding.top).toBe(8);
    expect(slotted.inShadowTree).toBe(true);
    expect(slotted.box.x).toBe(part.box.x + 8);

    // Same-origin frame: coordinates are those of the top page.
    const frame = get(snap, "same");
    const framed = get(snap, "in-frame");
    expect(framed.frame).toBe(1);
    expect(framed.box.x).toBe(frame.box.x + 5 + 20);
    expect(framed.box.y).toBe(frame.box.y + 5 + 10);
    expect(framed.text).toBe("Framed");

    expect(snap.notScanned).toEqual([
      "1 frame from another site: the content inside cannot be read.",
      "1 canvas: what is drawn on a canvas cannot be read.",
    ]);
  });

  test("measures 5,000 elements within the 1.5 s budget", async ({ page }) => {
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
    const snap = await takeSnapshot(page);
    expect(snap.elements.length).toBeGreaterThanOrEqual(5000);
    expect(snap.durationMs).toBeLessThan(1500);
  });
});
