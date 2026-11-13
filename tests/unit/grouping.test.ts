import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alphaOf, findPeerGroups, type RawGroup } from "@src/content/grouping";
import { takeSnapshot, type PageSnapshot } from "@src/content/snapshot";

/**
 * jsdom does no layout: data-box="x y width height" gives an element its box
 * (default 10 x 10 at 0,0). Looks are given with inline styles.
 */
function stubLayout(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const [x, y, width, height] = (this.getAttribute("data-box") ?? "0 0 10 10").split(/\s+/).map(Number);
    return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) } as DOMRect;
  });
}

interface Found {
  snapshot: PageSnapshot;
  groups: RawGroup[];
  /** Each group as the ids of its members ("" for members without an id). */
  ids: string[][];
}

function group(html: string, minGroupSize?: number): Found {
  document.body.innerHTML = html;
  const snapshot = takeSnapshot(document.body);
  const groups = findPeerGroups(snapshot.elements, { minGroupSize });
  return { snapshot, groups, ids: groups.map((g) => g.members.map((m) => snapshot.nodes[m].id)) };
}

/** The group whose members are exactly these ids. */
function find(found: Found, ...ids: string[]): RawGroup | undefined {
  const index = found.ids.findIndex((members) => members.join(",") === ids.join(","));
  return index < 0 ? undefined : found.groups[index];
}

const BOX = "border-top-width:1px; border-top-style:solid; background-color:rgb(250, 250, 250)";
const TITLE = "font-size:18px; font-weight:700";
const SMALL = "font-size:12px; color:rgb(100, 100, 100)";

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("sibling groups", () => {
  it("groups siblings with the same structure, and the same part of each", () => {
    const found = group(`
      <div id="grid">
        <div id="t1"><b id="n1" style="${TITLE}">One</b><i id="d1" style="${SMALL}">Jan</i></div>
        <div id="t2"><b id="n2" style="${TITLE}">Two</b><i id="d2" style="${SMALL}">Feb</i></div>
        <div id="t3"><b id="n3" style="${TITLE}">Three</b><i id="d3" style="${SMALL}">Mar</i></div>
      </div>`);
    expect(find(found, "t1", "t2", "t3")).toMatchObject({ kind: "sibling", parent: -1 });
    const names = find(found, "n1", "n2", "n3");
    expect(names?.kind).toBe("role");
    expect(found.groups[names!.parent].members.map((m) => found.snapshot.nodes[m].id)).toEqual(["t1", "t2", "t3"]);
    expect(find(found, "d1", "d2", "d3")?.kind).toBe("role");
    expect(found.groups).toHaveLength(3);
  });

  it("does not group a label with its value", () => {
    const found = group(`<div id="field"><div id="label" style="${SMALL}">Reporting to</div><div id="value" style="${TITLE}">Priya</div></div>`);
    expect(found.groups).toEqual([]);
  });

  it("groups childless siblings that look the same", () => {
    const found = group(`<div><h3 id="a" style="${TITLE}">Today</h3><p id="x">text</p><h3 id="b" style="${TITLE}">Next week</h3></div>`);
    expect(found.ids).toEqual([["a", "b"]]);
  });

  it("takes one odd member into a group of three or more, so the rules can report it", () => {
    const found = group(`
      <div>
        <span id="a" style="${TITLE}">A</span><span id="b" style="${TITLE}">B</span><span id="c" style="${TITLE}">C</span>
        <span id="odd" style="font-size:22px; font-weight:700">D</span>
      </div>`);
    expect(found.ids).toEqual([["a", "b", "c", "odd"]]);
  });

  it("leaves an odd member out of a pair: two of three is not a majority to trust", () => {
    const found = group(`<div><span id="a" style="${TITLE}">A</span><span id="b" style="${TITLE}">B</span><span id="odd" style="${SMALL}">C</span></div>`);
    expect(found.ids).toEqual([["a", "b"]]);
  });

  it("keeps a member that lacks a part of its peers, and groups the part where it exists", () => {
    const item = (id: string, icon: boolean): string =>
      `<a id="${id}" href="#">${icon ? `<span id="${id}-icon" style="${BOX}"></span>` : ""}<span id="${id}-label">Label</span></a>`;
    const found = group(`<nav>${item("n1", true)}${item("n2", true)}${item("n3", false)}${item("n4", true)}</nav>`);
    expect(find(found, "n1", "n2", "n3", "n4")?.kind).toBe("sibling");
    expect(find(found, "n1-icon", "n2-icon", "n4-icon")?.kind).toBe("role");
    expect(find(found, "n1-label", "n2-label", "n3-label", "n4-label")?.kind).toBe("role");
  });

  it("honours the minimum group size", () => {
    const html = `<div><h3 id="a" style="${TITLE}">A</h3><h3 id="b" style="${TITLE}">B</h3></div><ul><li id="x">1</li><li id="y">2</li><li id="z">3</li></ul>`;
    expect(group(html).ids).toEqual([
      ["a", "b"],
      ["x", "y", "z"],
    ]);
    expect(group(html, 3).ids).toEqual([["x", "y", "z"]]);
  });
});

describe("states", () => {
  it("keeps a member that looks different because of its state, with its parts", () => {
    const item = (id: string, current: boolean): string =>
      `<a id="${id}" href="#"${current ? ` aria-current="page" style="background-color:rgb(255, 255, 255); color:rgb(0, 0, 200)"` : ""}>` +
      `<span id="${id}-icon" style="${current ? "background-color:rgb(0, 0, 200)" : "background-color:rgb(0, 0, 0)"}"></span></a>`;
    const found = group(`<nav style="background-color:rgb(0, 0, 90)">${item("n1", true)}${item("n2", false)}${item("n3", false)}</nav>`);
    expect(find(found, "n1", "n2", "n3")).toBeDefined();
    expect(find(found, "n1-icon", "n2-icon", "n3-icon")).toBeDefined();
    expect(found.snapshot.elements[found.snapshot.nodes.findIndex((n) => n.id === "n1")].state).toEqual(["current"]);
  });

  it("groups a pressed button with the one that is not", () => {
    const found = group(`
      <div>
        <button id="grid" aria-pressed="false">Grid</button>
        <button id="list" aria-pressed="true" style="background-color:rgb(0, 0, 200); color:rgb(255, 255, 255)">List</button>
      </div>`);
    expect(found.ids).toEqual([["grid", "list"]]);
  });

  it("guesses the active member of a group of links that has no state attribute", () => {
    const found = group(`
      <nav>
        <a id="a" href="#">Home</a><a id="b" href="#">Team</a><a id="c" href="#">Work</a>
        <a id="d" href="#" style="font-weight:700; color:rgb(0, 0, 200)">News</a>
      </nav>`);
    const links = find(found, "a", "b", "c", "d");
    expect(links).toBeDefined();
    expect(found.snapshot.nodes[links!.guessedActive].id).toBe("d");
  });
});

describe("cousin and role groups", () => {
  it("merges the items of peer lists of different lengths into one group", () => {
    const person = (id: string): string => `<div id="${id}"><span style="${BOX}">AB</span><div>Name</div></div>`;
    const found = group(`
      <section>
        <div id="today">${person("p1")}</div>
        <div id="week">${person("p2")}${person("p3")}${person("p4")}</div>
      </section>`);
    expect(find(found, "today", "week")?.kind).toBe("sibling");
    expect(find(found, "p1", "p2", "p3", "p4")?.kind).toBe("cousin");
  });

  it("groups table cells by column, not all together", () => {
    const row = (n: number): string => `<tr id="r${n}"><td id="r${n}c1">${n}</td><td id="r${n}c2">Name ${n}</td></tr>`;
    const found = group(`<table><tbody>${row(1)}${row(2)}${row(3)}</tbody></table>`);
    expect(find(found, "r1", "r2", "r3")?.kind).toBe("sibling");
    expect(find(found, "r1c1", "r2c1", "r3c1")?.label).toContain("column 1");
    expect(find(found, "r1c2", "r2c2", "r3c2")?.label).toContain("column 2");
    expect(found.groups).toHaveLength(3);
  });

  it("keeps striped rows together and never reports bordered cells as boxes of a level", () => {
    const row = (n: number): string =>
      `<tr id="r${n}" style="background-color:${n % 2 ? "rgb(255, 255, 255)" : "rgb(240, 240, 240)"}">` +
      `<td id="r${n}c1" style="border-top-width:1px">${n}</td><td id="r${n}c2" style="border-top-width:1px"><b>Name</b></td></tr>`;
    const found = group(`<table style="background-color:rgb(200, 200, 200)"><tbody>${row(1)}${row(2)}${row(3)}${row(4)}</tbody></table>`);
    expect(find(found, "r1", "r2", "r3", "r4")?.kind).toBe("sibling");
    expect(find(found, "r1c2", "r2c2", "r3c2", "r4c2")?.label).toContain("column 2");
    expect(found.groups.filter((g) => g.kind === "level")).toEqual([]);
  });

  it("keeps the cells of a column together when the stripes are on the cells", () => {
    const row = (n: number): string => {
      const bg = n % 2 ? "rgb(255, 255, 255)" : "rgb(240, 240, 240)";
      return `<tr id="r${n}"><td id="r${n}c1" style="background-color:${bg}">${n}</td><td id="r${n}c2" style="background-color:${bg}">Name</td></tr>`;
    };
    const found = group(`<table><tbody>${row(1)}${row(2)}${row(3)}${row(4)}</tbody></table>`);
    expect(find(found, "r1c1", "r2c1", "r3c1", "r4c1")).toBeDefined();
    expect(find(found, "r1c2", "r2c2", "r3c2", "r4c2")).toBeDefined();
  });

  it("does not group the coloured tokens of preformatted code", () => {
    const line = (n: number): string => `<span id="l${n}"><span style="color:rgb(200, 0, 0)">const</span><span>x</span></span>`;
    const found = group(`<div><pre id="a"><code>${line(1)}${line(2)}</code></pre><pre id="b"><code>${line(3)}${line(4)}</code></pre></div>`);
    // The two code blocks are peers; nothing inside them is grouped.
    expect(found.ids).toEqual([["a", "b"]]);
  });

  it("still finds the groups inside a member that is built differently from its peers", () => {
    // Two boxes that are only similar: the rows inside each one must still be grouped.
    const found = group(`
      <div>
        <div id="a" style="${BOX}"><h2>Nav</h2><span>one link</span></div>
        <div id="b" style="${BOX}"><p id="p1"><b>1</b><i>x</i></p><p id="p2"><b>2</b><i>y</i></p><p id="p3"><b>3</b><i>z</i></p><h2>End</h2></div>
      </div>`);
    expect(find(found, "p1", "p2", "p3")?.kind).toBe("sibling");
  });

  it("treats a link in place of plain text as the same part", () => {
    const item = (id: string, link: boolean): string =>
      `<span id="${id}"><i style="${BOX}"></i>${link ? `<a id="${id}-text" href="#" style="color:rgb(0, 0, 200)">City</a>` : `<span id="${id}-text">City</span>`}</span>`;
    const found = group(`<div>${item("i1", false)}${item("i2", true)}${item("i3", false)}${item("i4", false)}</div>`);
    expect(find(found, "i1", "i2", "i3", "i4")).toBeDefined();
    expect(find(found, "i1-text", "i2-text", "i3-text", "i4-text")).toBeDefined();
  });

  it("does not match the parts of a member that is built differently", () => {
    // One row: two fields with the same structure and a third box with another.
    const found = group(`
      <div style="display:flex">
        <div id="who" data-box="0 0 120 60"><span style="${BOX}">AM</span><div id="who-text"><div id="who-name" style="${TITLE}">Alex</div></div></div>
        <div id="f1" data-box="130 0 100 60"><div id="l1" style="${SMALL}">Reporting to</div><div id="v1" style="${TITLE}">Priya</div></div>
        <div id="f2" data-box="240 0 100 60"><div id="l2" style="${SMALL}">Shift</div><div id="v2" style="${TITLE}">Flexible</div></div>
      </div>`);
    expect(find(found, "who", "f1", "f2")?.kind).toBe("sibling");
    expect(find(found, "l1", "l2")).toBeDefined();
    // Its wrapper is not matched with anything, but its text joins the texts it looks like.
    expect(found.ids.flat()).not.toContain("who-text");
    expect(find(found, "who-name", "v1", "v2")?.kind).toBe("role");
    // The row group knows which members are built alike.
    const row = find(found, "who", "f1", "f2")!;
    expect(row.core.map((m) => found.snapshot.nodes[m].id)).toEqual(["f1", "f2"]);
  });
});

describe("level groups", () => {
  it("groups boxes of the same kind across plain columns, with their titles", () => {
    const found = group(`
      <main>
        <div id="left">
          <section id="c1" style="${BOX}"><div id="h1"><h2 id="t1">Details</h2></div><p>One paragraph</p></section>
          <section id="c2" style="${BOX}"><div id="h2"><h2 id="t2">Team</h2><button>Manual</button></div><ul><li>a</li></ul></section>
        </div>
        <div id="right">
          <section id="c3" style="${BOX}"><div id="h3"><h2 id="t3">Events</h2></div><table><tbody><tr><td>x</td></tr></tbody></table></section>
        </div>
      </main>`);
    const cards = find(found, "c1", "c2", "c3");
    expect(cards?.kind).toBe("level");
    expect(find(found, "t1", "t2", "t3")?.label).toContain("titles");
    expect(find(found, "h1", "h2", "h3")?.label).toContain("title rows");
    // The columns that hold the cards are peers too.
    const columns = find(found, "left", "right");
    expect(columns?.kind).toBe("sibling");
    expect(found.groups[cards!.parent]).toBe(columns);
  });

  it("does not report a level group for boxes that are already one group", () => {
    const tile = (id: string): string => `<div id="${id}" style="${BOX}"><b>Name</b></div>`;
    const found = group(`<div>${tile("a")}${tile("b")}${tile("c")}</div>`);
    expect(find(found, "a", "b", "c")?.kind).toBe("sibling");
    expect(found.groups.filter((g) => g.kind === "level")).toEqual([]);
  });

  it("groups the controls that share a row", () => {
    const found = group(`
      <div>
        <input id="search" data-box="0 0 300 45" style="${BOX}">
        <span data-box="310 0 100 45">spacer</span>
        <button id="help" data-box="420 6 90 33" style="${BOX}">Need help?</button>
        <div id="toggle" role="group" data-box="520 0 120 45"><button id="g">Grid</button><button id="l">List</button></div>
        <button id="below" data-box="0 200 90 33">Save</button>
      </div>`);
    const row = find(found, "search", "help", "toggle");
    expect(row).toMatchObject({ kind: "level", label: "3 controls in a row" });
    expect(found.ids.flat()).not.toContain("below");
  });
});

describe("alphaOf", () => {
  it("reads the alpha of a computed colour", () => {
    expect(alphaOf("rgba(0, 0, 0, 0)")).toBe(0);
    expect(alphaOf("transparent")).toBe(0);
    expect(alphaOf("rgb(10, 20, 30)")).toBe(1);
    expect(alphaOf("rgba(10, 20, 30, 0.5)")).toBe(0.5);
    expect(alphaOf("rgb(10 20 30 / 25%)")).toBe(0.25);
    expect(alphaOf("oklch(0.7 0.1 200)")).toBe(1);
  });
});
