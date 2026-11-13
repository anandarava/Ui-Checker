import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWN_UI_ATTR } from "@shared/constants";
import { parseFontFamilies, takeSnapshot, type ElementSnapshot, type PageSnapshot } from "@src/content/snapshot";

/**
 * jsdom does no layout, so the tests give the boxes:
 *   data-box="x y width height"       the element's box (default: 10 x 10 at 0,0)
 *   data-text-box="x y width height"  the box of the element's own text
 */
function rectOf(spec: string | null, fallback: [number, number, number, number]): DOMRect {
  const [x, y, width, height] = spec ? spec.split(/\s+/).map(Number) : fallback;
  return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) } as DOMRect;
}

function stubLayout(view: Window = window): void {
  const { Element: El, Range: Rg } = view as unknown as typeof globalThis;
  vi.spyOn(El.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return rectOf(this.getAttribute("data-box"), [0, 0, 10, 10]);
  });
  // jsdom has no Range.getBoundingClientRect.
  Rg.prototype.getBoundingClientRect = function (this: Range) {
    const owner = this.startContainer.parentElement;
    return rectOf(owner?.getAttribute("data-text-box") ?? null, [0, 0, 0, 0]);
  };
}

function snap(html: string): PageSnapshot {
  document.body.innerHTML = html;
  return takeSnapshot(document.body);
}

function ids(snapshot: PageSnapshot): string[] {
  return snapshot.nodes.map((el) => el.id).filter(Boolean);
}

function byId(snapshot: PageSnapshot, id: string): ElementSnapshot {
  const index = snapshot.nodes.findIndex((el) => el.id === id);
  if (index < 0) throw new Error(`#${id} is not in the snapshot`);
  return snapshot.elements[index];
}

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

describe("which elements are measured", () => {
  it("skips hidden elements and everything inside display:none and opacity:0", () => {
    const s = snap(`
      <div id="shown"><span id="child">a</span></div>
      <div id="gone" style="display:none"><span id="inside">b</span></div>
      <div id="invisible" style="visibility:hidden">c</div>
      <div id="clear" style="opacity:0"><span id="faded">d</span></div>
      <div id="empty" data-box="0 0 0 0">e</div>
      <script id="code">1</script>`);
    expect(ids(s)).toEqual(["shown", "child"]);
  });

  it("keeps a visible child of a visibility:hidden parent and of an empty box", () => {
    const s = snap(`
      <div id="parent" style="visibility:hidden"><span id="kid" style="visibility:visible">a</span></div>
      <div id="wrapper" data-box="0 0 0 0"><span id="overflowing">b</span></div>`);
    expect(ids(s)).toEqual(["kid", "overflowing"]);
    // The child hangs off the nearest measured ancestor, but keeps its real depth.
    expect(byId(s, "kid").parent).toBe(0);
    expect(byId(s, "kid").depth).toBe(2);
  });

  it("skips what the extension itself drew on the page", () => {
    const s = snap(`<div id="page">a</div><div id="overlay" ${OWN_UI_ATTR}><span id="badge">1</span></div>`);
    expect(ids(s)).toEqual(["page"]);
  });

  it("skips screen-reader-only text and boxes that can never be scrolled to", () => {
    const s = snap(`
      <span id="sr" data-box="0 0 1 1" style="overflow-x:hidden; overflow-y:hidden">Opens in a new window</span>
      <div id="offpage" data-box="-500 0 200 20" aria-hidden="true">decoration</div>
      <div id="below" data-box="0 5000 200 20">far down the page</div>`);
    expect(ids(s)).toEqual(["below"]);
  });

  it("reads only the summary of a closed details element", () => {
    const s = snap(`
      <details id="closed"><summary id="s1">More</summary><p id="p1">hidden</p></details>
      <details id="open" open><summary id="s2">More</summary><p id="p2">shown</p></details>`);
    expect(ids(s)).toEqual(["closed", "s1", "open", "s2", "p2"]);
  });

  it("measures an svg as one box", () => {
    const s = snap(`<svg id="icon"><g id="g"><path id="p"></path></g></svg>`);
    expect(ids(s)).toEqual(["icon"]);
  });
});

describe("what is recorded per element", () => {
  it("records structure", () => {
    const s = snap(`<ul id="list" class="a  b" role="tablist"><li id="one">One</li><li id="two" hidden>Two</li></ul>`);
    const list = byId(s, "list");
    expect(list).toMatchObject({ tag: "ul", role: "tablist", classList: ["a", "b"], childCount: 2, depth: 1, parent: 0, frame: 0, inShadowTree: false });
    expect(list.children).toEqual([byId(s, "one").index]);
    expect(byId(s, "one").role).toBeNull();
    expect(s.elements.map((e) => e.index)).toEqual(s.elements.map((_, i) => i));
  });

  it("records the box and the text box in page coordinates", () => {
    vi.spyOn(window, "scrollY", "get").mockReturnValue(300);
    const s = snap(`<p id="p" data-box="20 40 200 30" data-text-box="60 45 120 20">  Hello   <b id="b">there</b> world </p>`);
    const p = byId(s, "p");
    expect(p.box).toEqual({ x: 20, y: 340, width: 200, height: 30 });
    expect(p.textBox).toEqual({ x: 60, y: 345, width: 120, height: 20 });
    expect(p.text).toBe("Hello world");
    expect(byId(s, "b").textBox).toBeNull(); // its text has no box in this test
  });

  it("has no text box for an element without text of its own", () => {
    const s = snap(`<div id="wrap" data-text-box="0 0 50 10"> <span>a</span> </div>`);
    expect(byId(s, "wrap").textBox).toBeNull();
    expect(byId(s, "wrap").text).toBe("");
  });

  it("records the computed styles the rules compare", () => {
    const s = snap(`
      <div id="box" data-box="0 0 200 100" style="
        font-family: 'Fira Sans', Arial, sans-serif; font-size: 22px; font-weight: 700; font-style: italic;
        line-height: 28px; letter-spacing: 1px; color: rgb(11, 74, 143); text-align: center; text-transform: uppercase;
        padding-top: 29px; padding-right: 20px; padding-bottom: 68px; padding-left: 20px;
        margin-top: 4px; margin-left: 8px; row-gap: 19px; column-gap: 68px;
        border-top-width: 1px; border-top-style: solid;
        border-top-left-radius: 12px; border-top-right-radius: 50%;
        background-color: rgb(255, 255, 255); overflow-x: hidden; overflow-y: hidden;">x</div>
      <div id="plain">y</div>`);
    const style = byId(s, "box").style;
    expect(style.fontFamily).toBe("Fira Sans");
    expect(style.fontFamilies).toEqual(["Fira Sans", "Arial", "sans-serif"]);
    expect(style).toMatchObject({
      fontSize: 22,
      fontWeight: 700,
      fontStyle: "italic",
      lineHeight: 28,
      letterSpacing: 1,
      color: "rgb(11, 74, 143)",
      textAlign: "center",
      textTransform: "uppercase",
      padding: { top: 29, right: 20, bottom: 68, left: 20 },
      gap: { row: 19, column: 68 },
      borderStyle: "solid",
      backgroundColor: "rgb(255, 255, 255)",
      overflowX: "hidden",
    });
    expect(style.margin).toMatchObject({ top: 4, left: 8 });
    expect(style.borderWidth.top).toBe(1);
    expect(style.radius.topLeft).toBe(12);
    expect(style.radius.topRight).toBe(100); // 50% of the 200px width

    const plain = byId(s, "plain").style;
    expect(plain.lineHeight).toBeNull();
    expect(plain.letterSpacing).toBe(0);
    expect(plain.fontWeight).toBe(400);
    expect(plain.gap).toEqual({ row: 0, column: 0 });
    expect(plain.boxShadow).toBe("none");
    expect(plain.transform).toBe("none");
  });

  it("records the layout the element sits in", () => {
    const s = snap(`
      <div id="row" style="display:flex"><span id="a" style="position:relative">a</span></div>
      <div id="col" style="display:flex; flex-direction:column-reverse"><span id="b">b</span></div>
      <div id="grid" style="display:grid"><span id="c">c</span></div>
      <div id="block"><span id="d">d</span></div>`);
    expect(byId(s, "row").layout).toMatchObject({ display: "flex", direction: "row" });
    expect(byId(s, "a").layout).toMatchObject({ position: "relative", parentDisplay: "flex", parentDirection: "row", direction: null });
    expect(byId(s, "b").layout).toMatchObject({ parentDisplay: "flex", parentDirection: "column" });
    expect(byId(s, "c").layout).toMatchObject({ parentDisplay: "grid", parentDirection: "row" });
    expect(byId(s, "d").layout).toMatchObject({ parentDisplay: "block", parentDirection: null });
  });
});

describe("parseFontFamilies", () => {
  it("splits on commas outside quotes and removes the quotes", () => {
    expect(parseFontFamilies(`"Segoe UI", system-ui, 'A, B', sans-serif`)).toEqual(["Segoe UI", "system-ui", "A, B", "sans-serif"]);
    expect(parseFontFamilies("")).toEqual([]);
  });
});

describe("clipping and scrolling", () => {
  it("marks elements cut off by an overflow ancestor and names the scroll container", () => {
    document.body.innerHTML = `
      <div id="scroller" data-box="0 0 100 100" style="overflow-x:auto; overflow-y:auto; border-top-width:0px">
        <p id="inside" data-box="0 10 100 20">a</p>
        <p id="cut" data-box="0 90 100 20">b</p>
        <p id="out" data-box="0 300 100 20">c</p>
      </div>
      <p id="free" data-box="0 300 100 20">d</p>`;
    const scroller = document.getElementById("scroller") as HTMLElement;
    Object.defineProperty(scroller, "scrollHeight", { value: 320 });
    Object.defineProperty(scroller, "clientHeight", { value: 100 });
    const s = takeSnapshot(document.body);
    const index = byId(s, "scroller").index;

    expect(byId(s, "scroller").scrolls).toBe(true);
    expect(byId(s, "inside")).toMatchObject({ clip: "none", clippedBy: null, scrollContainer: index });
    expect(byId(s, "cut")).toMatchObject({ clip: "partial", clippedBy: index, scrollContainer: index });
    // Scrolled out of view, but still measured.
    expect(byId(s, "out")).toMatchObject({ clip: "full", clippedBy: index });
    expect(byId(s, "out").box.y).toBe(300);
    expect(byId(s, "free")).toMatchObject({ clip: "none", scrollContainer: null });
  });

  it("clips an absolutely positioned element only from its containing block upwards", () => {
    const s = snap(`
      <div id="outer" data-box="0 0 100 100" style="position:relative; overflow-x:hidden; overflow-y:hidden">
        <div id="inner" data-box="0 0 50 50" style="overflow-x:hidden; overflow-y:hidden">
          <span id="menu" data-box="0 40 80 30" style="position:absolute">menu</span>
          <span id="toast" data-box="0 400 80 30" style="position:fixed">toast</span>
          <span id="text" data-box="0 40 80 30">text</span>
        </div>
      </div>`);
    expect(byId(s, "menu").clip).toBe("none"); // escapes #inner, fits in #outer
    expect(byId(s, "toast").clip).toBe("none"); // fixed: clipped by nothing
    expect(byId(s, "text")).toMatchObject({ clip: "partial", clippedBy: byId(s, "inner").index });
  });

  it("does not treat the page itself as a clipping box", () => {
    document.body.setAttribute("style", "overflow-x:hidden; overflow-y:hidden");
    document.body.setAttribute("data-box", "0 0 1000 600");
    const s = snap(`<p id="fold" data-box="0 2000 100 20">below the fold</p>`);
    document.body.removeAttribute("data-box");
    expect(byId(s, "fold")).toMatchObject({ clip: "none", scrollContainer: null });
  });
});

describe("shadow DOM and frames", () => {
  it("walks open shadow roots and slotted content", () => {
    document.body.innerHTML = `<x-card id="host"><span id="slotted">Title</span><span id="unslotted" slot="nowhere">x</span></x-card>`;
    const host = document.getElementById("host") as HTMLElement;
    host.attachShadow({ mode: "open" }).innerHTML = `<div id="frame-part"><slot></slot></div>`;
    const s = takeSnapshot(document.body);

    const tags = s.elements.map((e) => e.tag);
    expect(tags).toEqual(["body", "x-card", "div", "slot", "span"]);
    const slotted = byId(s, "slotted");
    expect(slotted.inShadowTree).toBe(true);
    expect(s.elements[slotted.parent].tag).toBe("slot");
    expect(byId(s, "host").inShadowTree).toBe(false);
    expect(s.nodes.some((el) => el.id === "unslotted")).toBe(false);
  });

  it("reads a same-origin iframe in page coordinates", () => {
    document.body.innerHTML = `<iframe id="frame" data-box="100 200 300 150"></iframe>`;
    const frame = document.getElementById("frame") as HTMLIFrameElement;
    const inner = frame.contentDocument as Document;
    stubLayout(frame.contentWindow as Window);
    inner.body.innerHTML = `<p id="inner" data-box="10 20 50 10" data-text-box="12 22 30 8">Inside</p>`;
    const s = takeSnapshot(document.body);

    const frameIndex = byId(s, "frame").index;
    expect(s.frames).toEqual([
      { element: -1, origin: { x: 0, y: 0 } },
      { element: frameIndex, origin: { x: 100, y: 200 } },
    ]);
    const p = s.elements[s.nodes.findIndex((el) => el.id === "inner")];
    expect(p.frame).toBe(1);
    expect(p.box).toEqual({ x: 110, y: 220, width: 50, height: 10 });
    expect(p.textBox).toEqual({ x: 112, y: 222, width: 30, height: 8 });
    expect(p.scrollContainer).toBe(frameIndex);
    expect(s.notScanned).toEqual([]);
  });

  it("reports frames from another site and canvases as not scanned", () => {
    document.body.innerHTML = `<iframe id="other"></iframe><canvas id="chart"></canvas><canvas></canvas>`;
    Object.defineProperty(document.getElementById("other"), "contentDocument", { value: null });
    const s = takeSnapshot(document.body);
    expect(ids(s)).toEqual(["other", "chart"]);
    expect(s.notScanned).toEqual([
      "1 frame from another site: the content inside cannot be read.",
      "2 canvases: what is drawn on a canvas cannot be read.",
    ]);
  });
});
