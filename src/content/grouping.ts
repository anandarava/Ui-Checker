/**
 * Peer grouping (PLAN.md, Phase 2): finds the elements that should look the
 * same, so the rules (Phase 3) only ever compare an element with its peers.
 *
 * Works on the snapshot only. Two elements are peers when they have the same
 * tag and role and either
 *   - nearly the same child tree and the same kind of box (strong), or
 *   - a similar child tree, or no children at all, AND the same look (weak).
 * Class names are never read: utility and generated class names say nothing
 * about what an element is.
 *
 * Kinds of group (see PeerGroupKind):
 *   sibling  peers under one parent                       (the tiles of a grid)
 *   cousin   peers in the lists of several peer parents   (rows of two lists)
 *   role     the same part of each member of a group      (the title of each card)
 *   level    boxes at the same layout level that look like the same kind of
 *            box although their content differs (section cards), and the
 *            controls of one row (a toolbar)
 *
 * Nothing in here may depend on a particular application.
 */
import type { PeerGroupKind } from "@shared/types";
import type { ElementSnapshot } from "./snapshot";

export interface RawGroup {
  kind: PeerGroupKind;
  /** Indexes into the snapshot, in document order. */
  members: number[];
  /** Index of the group this one was derived from, or -1. */
  parent: number;
  label: string;
  /**
   * A member without a state attribute that looks like the active one: the only
   * member of a group of links or buttons that differs in several style
   * properties at once. -1 when there is none.
   */
  guessedActive: number;
}

export interface GroupingOptions {
  /** Smallest number of members a group needs. Default 2. */
  minGroupSize?: number;
}

/** Child-tree similarity that makes two boxes of the same kind peers. */
const STRONG = 0.75;
/** Child-tree similarity that makes two elements peers when they also look the same. */
const WEAK = 0.4;
/** How deep the child tree is compared. */
const SHAPE_DEPTH = 3;
/** A group of childless elements needs this many members before it takes in one that looks different. */
const LEAF_CORE = 3;

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const CONTROL_TAGS = new Set(["button", "input", "select", "textarea"]);
const CONTROL_ROLES = new Set(["button", "tab", "switch", "checkbox", "radio", "combobox", "textbox", "searchbox", "slider", "spinbutton"]);
const CONTROL_GROUP_ROLES = new Set(["group", "radiogroup", "tablist", "toolbar"]);
const INTERACTIVE_TAGS = new Set(["a", "button", "summary"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem"]);
/** Generic elements a link can stand in for (a link where its peers have plain text). */
/** Parts inside a table: grouped as rows and columns, never as boxes of a level. The table itself can be one. */
const TABLE_PARTS = new Set(["thead", "tbody", "tfoot", "tr", "td", "th", "caption"]);
const TABLE_ROLES = new Set(["row", "cell", "gridcell", "columnheader", "rowheader", "rowgroup"]);
const TEXT_CARRIERS = new Set(["span", "div", "p", "b", "strong", "em", "i", "small", "label"]);

type Kind = "text" | "box" | "group";

/** Number of entries in an element's look: font size, weight, colour, background, border, radius, shadow. */
const VISUAL_FIELDS = 7;

interface Cluster {
  members: number[];
  /** One element per distinct child-tree shape in the cluster. */
  reps: number[];
  /** Members before any odd one was taken in. */
  core: number;
  absorbed: number;
  /**
   * Members with the same structure, kept together. More than one part means
   * the set also rests on similarity: its members are peers, but only the
   * members of one part have their own parts matched with each other.
   */
  parts: number[][];
}

export interface PeerSet {
  members: number[];
  parts: number[][];
}

/** Alpha of a computed colour; 1 when the format is not rgb()/rgba(). */
export function alphaOf(color: string): number {
  if (color === "transparent" || color === "") return 0;
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (!m) return 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 4) return 1;
  const a = parts[3].endsWith("%") ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
  return Number.isFinite(a) ? a : 1;
}

export function findPeerGroups(elements: ElementSnapshot[], options: GroupingOptions = {}): RawGroup[] {
  const minSize = Math.max(2, options.minGroupSize ?? 2);
  const groups: RawGroup[] = [];
  /** Sorted member list -> group index, so the same set is reported once. */
  const seen = new Map<string, number>();
  /** Element -> the groups it is a member of. */
  const memberOf = new Map<number, number[]>();

  // ---- Per-element facts, computed on demand ----

  const isRow = (i: number): boolean => elements[i].tag === "tr" || elements[i].role === "row";

  const isCell = (i: number): boolean => elements[i].tag === "td" || elements[i].tag === "th" || elements[i].role === "cell" || elements[i].role === "gridcell";

  const isTablePart = (i: number): boolean => TABLE_PARTS.has(elements[i].tag) || (elements[i].role !== null && TABLE_ROLES.has(elements[i].role!));

  const kindOf = (i: number): Kind => {
    const el = elements[i];
    if (el.children.length > 0) return "group";
    return el.text ? "text" : "box";
  };

  const typeOf = (i: number): string => {
    const el = elements[i];
    return el.role ? `${el.tag}|${el.role}` : el.tag;
  };

  const shapes = new Map<number, Set<string>>();
  const shapeOf = (i: number): Set<string> => {
    let shape = shapes.get(i);
    if (shape) return shape;
    const paths = new Set<string>(["."]);
    const collect = (at: number, prefix: string, depth: number): void => {
      for (const c of elements[at].children) {
        const kind = kindOf(c);
        // Striped cells and rows are not "boxes of their own": the stripes come and go by position.
        const boxed = hasBox(c) && !isCell(c) && !isRow(c);
        // A link where its peers have plain text is the same part: plain text carriers share one name.
        const tag = kind === "text" && !boxed && (elements[c].tag === "a" || TEXT_CARRIERS.has(elements[c].tag)) ? "~" : elements[c].tag;
        // "#" marks a part drawn as a box of its own (a tile, a badge).
        const step = `${tag}:${kind[0]}${boxed ? "#" : ""}`;
        const path = prefix ? `${prefix}/${step}` : step;
        paths.add(path);
        if (depth < SHAPE_DEPTH) collect(c, path, depth + 1);
      }
    };
    collect(i, "", 1);
    shapes.set(i, paths);
    return paths;
  };

  const shapeKeys = new Map<number, string>();
  const shapeKeyOf = (i: number): string => {
    let key = shapeKeys.get(i);
    if (key === undefined) {
      key = Array.from(shapeOf(i)).sort().join(" ");
      shapeKeys.set(i, key);
    }
    return key;
  };

  /** Share of child-tree paths two elements have in common (0..1). */
  const similarity = (a: number, b: number): number => {
    const A = shapeOf(a);
    const B = shapeOf(b);
    let common = 0;
    for (const p of A) if (B.has(p)) common++;
    return common / (A.size + B.size - common);
  };

  const visuals = new Map<number, string[]>();
  const visualOf = (i: number): string[] => {
    let v = visuals.get(i);
    if (v) return v;
    const s = elements[i].style;
    const b = s.borderWidth;
    // Striped tables alternate the background of their rows or cells on purpose.
    const striped = isRow(i) || isCell(i);
    v = [
      String(s.fontSize),
      String(s.fontWeight),
      s.color,
      striped ? "striped" : alphaOf(s.backgroundColor) > 0 ? s.backgroundColor : "none",
      `${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)},${Math.round(b.left)}`,
      String(Math.round(s.radius.topLeft)),
      striped ? "striped" : s.boxShadow === "none" ? "0" : "1",
    ];
    visuals.set(i, v);
    return v;
  };
  const visualKeyOf = (i: number): string => visualOf(i).join("|");
  /**
   * Look of the box alone: background, radius, shadow. Borders are left out:
   * the first or last item of a list often lacks the divider its peers have.
   */
  const boxLookOf = (i: number): string => {
    const v = visualOf(i);
    return `${v[3]}|${v[5]}|${v[6]}`;
  };

  const differences = (a: string[], b: string[]): number => {
    let n = 0;
    for (let k = 0; k < VISUAL_FIELDS; k++) if (a[k] !== b[k]) n++;
    return n;
  };

  /** The most common look among the elements. */
  const modalVisual = (list: number[]): string[] => {
    const counts = new Map<string, { n: number; v: string[] }>();
    let best: { n: number; v: string[] } | null = null;
    for (const i of list) {
      const key = visualKeyOf(i);
      const entry = counts.get(key) ?? { n: 0, v: visualOf(i) };
      entry.n++;
      counts.set(key, entry);
      if (!best || entry.n > best.n) best = entry;
    }
    return best ? best.v : [];
  };

  /** The background actually seen behind an element: its own, or the nearest painted ancestor's. */
  const backdrops = new Map<number, string>();
  const backdropOf = (i: number): string => {
    if (i < 0) return "rgb(255, 255, 255)";
    let bg = backdrops.get(i);
    if (bg === undefined) {
      const own = elements[i].style.backgroundColor;
      bg = alphaOf(own) > 0 ? own : backdropOf(elements[i].parent);
      backdrops.set(i, bg);
    }
    return bg;
  };

  /** True when the element is drawn as a box of its own: a background that stands out, a border or a shadow. */
  const hasBox = (i: number): boolean => {
    const s = elements[i].style;
    const b = s.borderWidth;
    if (b.top + b.right + b.bottom + b.left > 0) return true;
    if (s.boxShadow !== "none") return true;
    return alphaOf(s.backgroundColor) > 0 && s.backgroundColor !== backdropOf(elements[i].parent);
  };

  /**
   * True when the element, or an element it sits in, is in a state that
   * changes its look on purpose (so also the icon of the current navigation
   * item). "expanded" alone does not restyle what is inside.
   */
  const restyled = new Map<number, boolean>();
  /** True when the element's state also restyles what is inside it. */
  const restyles = (i: number): boolean => {
    if (i < 0) return false;
    let value = restyled.get(i);
    if (value === undefined) {
      value = elements[i].state.some((s) => s !== "expanded") || restyles(elements[i].parent);
      restyled.set(i, value);
    }
    return value;
  };
  const inState = (i: number): boolean => elements[i].state.length > 0 || restyles(elements[i].parent);

  const isInteractive = (i: number): boolean => {
    const el = elements[i];
    return INTERACTIVE_TAGS.has(el.tag) || CONTROL_TAGS.has(el.tag) || (el.role !== null && (INTERACTIVE_ROLES.has(el.role) || CONTROL_ROLES.has(el.role)));
  };

  const isControl = (i: number): boolean => {
    const el = elements[i];
    return CONTROL_TAGS.has(el.tag) || (el.role !== null && CONTROL_ROLES.has(el.role));
  };

  const containsControl = (i: number, depth = 3): boolean =>
    elements[i].children.some((c) => isControl(c) || (depth > 1 && containsControl(c, depth - 1)));

  /** A link and the generic text element it stands in for. Never a heading or a button. */
  const swappable = (a: number, b: number): boolean => {
    const x = elements[a].tag;
    const y = elements[b].tag;
    return (x === "a" && TEXT_CARRIERS.has(y)) || (y === "a" && TEXT_CARRIERS.has(x));
  };

  /**
   * True when `odd` is the one remaining item of a row whose other items are
   * `core`: same parent, laid out as a row, about the same size. Such an item
   * is a peer of the others even when its content is built differently.
   */
  const fillsRow = (odd: number, core: number[]): boolean => {
    const parent = elements[odd].parent;
    if (parent < 0 || elements[parent].layout.direction !== "row") return false;
    if (kindOf(odd) !== "group" || core.some((m) => elements[m].parent !== parent)) return false;
    if (elements[parent].children.length !== core.length + 1) return false;
    const a = elements[odd].box;
    const b = elements[core[0]].box;
    const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (overlap < Math.min(a.height, b.height) / 2) return false;
    const ratio = (x: number, y: number): number => Math.max(x, y) / Math.max(1, Math.min(x, y));
    return ratio(a.width, b.width) <= 1.4 && ratio(a.height, b.height) <= 1.4;
  };

  // ---- Clustering ----

  /** Splits elements into sets of peers. Returns only the sets with at least `minSize` members. */
  const cluster = (list: number[]): PeerSet[] => {
    if (list.length < 2) return [];
    const plain = list.filter((i) => !inState(i));
    const stateful = list.filter((i) => inState(i));

    const isGroup = (c: Cluster): boolean => kindOf(c.reps[0]) === "group";
    const sameType = (a: Cluster, b: Cluster): boolean => typeOf(a.reps[0]) === typeOf(b.reps[0]);
    const bestSimilarity = (a: Cluster, b: Cluster): number => {
      let best = 0;
      for (const x of a.reps) for (const y of b.reps) best = Math.max(best, similarity(x, y));
      return best;
    };
    /** One child tree holds every path of the other: a member that lacks, or has, one extra part. */
    const nested = (a: Cluster, b: Cluster): boolean =>
      a.reps.some((x) =>
        b.reps.some((y) => {
          const [small, large] = shapeOf(x).size <= shapeOf(y).size ? [shapeOf(x), shapeOf(y)] : [shapeOf(y), shapeOf(x)];
          for (const p of small) if (!large.has(p)) return false;
          return true;
        }),
      );

    // 1. Exact buckets. Elements with children: same type, same shape, same kind of box.
    //    Childless elements: same type, same kind and same look.
    const buckets = new Map<string, number[]>();
    for (const i of plain) {
      const key = kindOf(i) === "group" ? `${typeOf(i)}§${shapeKeyOf(i)}§${boxLookOf(i)}` : `${typeOf(i)}§${kindOf(i)}§${visualKeyOf(i)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }
    let clusters: Cluster[] = Array.from(buckets.values(), (members) => ({ members, reps: [members[0]], parts: [members.slice()], core: members.length, absorbed: 0 }));

    /** `test` answers 0 (not peers), 1 (peers) or 2 (peers on similarity only: the parts stay apart). */
    const merge = (test: (a: Cluster, b: Cluster) => 0 | 1 | 2): void => {
      let changed = true;
      while (changed) {
        changed = false;
        outer: for (let x = 0; x < clusters.length; x++) {
          for (let y = x + 1; y < clusters.length; y++) {
            const a = clusters[x];
            const b = clusters[y];
            const verdict = test(a, b);
            if (verdict === 0) continue;
            const parts = verdict === 1 ? [a.parts[0].concat(b.parts[0]), ...a.parts.slice(1), ...b.parts.slice(1)] : a.parts.concat(b.parts);
            clusters[x] = { members: a.members.concat(b.members), reps: a.reps.concat(b.reps), parts, core: a.core + b.core, absorbed: 0 };
            clusters.splice(y, 1);
            changed = true;
            break outer;
          }
        }
      }
    };

    // 2. Strong: nearly the same child tree, drawn as the same kind of box.
    merge((a, b) => (sameType(a, b) && isGroup(a) && isGroup(b) && boxLookOf(a.reps[0]) === boxLookOf(b.reps[0]) && bestSimilarity(a, b) >= STRONG ? 1 : 0));

    // 3. Weak: a similar child tree (or one side without children) and the same look.
    //    A member that only lacks a part of its peers (an item without its icon) is as good as the same.
    merge((a, b) => {
      if (!sameType(a, b) || (!isGroup(a) && !isGroup(b))) return 0;
      if (bestSimilarity(a, b) < WEAK) return 0;
      if (!isRow(a.reps[0]) && modalVisual(a.members).join("|") !== modalVisual(b.members).join("|")) return 0;
      return nested(a, b) ? 1 : 2;
    });

    // 4. An odd one out joins the set it most resembles: it is the member the rules should report.
    const singles = clusters.filter((c) => c.members.length === 1);
    const cores = clusters.filter((c) => c.members.length >= 2).sort((a, b) => b.members.length - a.members.length);
    const taken = new Set<Cluster>();
    for (const single of singles) {
      const s = single.members[0];
      let best: Cluster | null = null;
      let bestDiff = Infinity;
      for (const core of cores) {
        if (core.absorbed + 1 > Math.floor(core.core / 2)) continue;
        const diff = differences(visualOf(s), modalVisual(core.members));
        if (isGroup(single) || isGroup(core)) {
          if (!sameType(single, core)) continue;
          if (bestSimilarity(single, core) < WEAK && !fillsRow(s, core.members)) continue;
        } else {
          const kind = kindOf(s);
          if (kind !== kindOf(core.reps[0])) continue;
          if (!sameType(single, core) && !(kind === "text" && swappable(s, core.reps[0]))) continue;
          if (core.core < LEAF_CORE) continue;
          if (diff > (isInteractive(s) ? 4 : 2)) continue;
        }
        if (diff < bestDiff) {
          best = core;
          bestDiff = diff;
        }
      }
      if (best) {
        // Built differently: a member of the group, but its parts are not matched with the others'.
        if ((isGroup(single) || isGroup(best)) && !nested(single, best)) best.parts.push([s]);
        else best.parts[0].push(s);
        best.members.push(s);
        best.reps.push(s);
        best.absorbed++;
        taken.add(single);
      }
    }
    clusters = clusters.filter((c) => !taken.has(c));

    // 5. Members in a state (selected, current, disabled...) look different on purpose:
    //    they join by structure alone.
    for (const s of stateful) {
      const self: Cluster = { members: [s], reps: [s], parts: [[s]], core: 1, absorbed: 0 };
      let best: Cluster | null = null;
      let bestScore = -Infinity;
      for (const c of clusters) {
        const rep = c.reps[0];
        if (typeOf(s) !== typeOf(rep)) continue;
        const bothChildless = kindOf(s) !== "group" && kindOf(rep) !== "group";
        if (bothChildless ? kindOf(s) !== kindOf(rep) : bestSimilarity(self, c) < WEAK) continue;
        const score = c.members.length * 10 - differences(visualOf(s), modalVisual(c.members));
        if (score > bestScore) {
          best = c;
          bestScore = score;
        }
      }
      if (best) {
        best.members.push(s);
        best.reps.push(s);
        best.parts[0].push(s);
      } else {
        clusters.push(self);
      }
    }

    const sorted = (a: number[]): number[] => a.slice().sort((x, y) => x - y);
    return clusters.filter((c) => c.members.length >= minSize).map((c) => ({ members: sorted(c.members), parts: c.parts.map(sorted) }));
  };

  // ---- Labels ----

  const thing = (members: number[]): string => {
    const counts = new Map<string, number>();
    for (const i of members) counts.set(elements[i].tag, (counts.get(elements[i].tag) ?? 0) + 1);
    const tag = Array.from(counts).sort((a, b) => b[1] - a[1])[0][0];
    if (tag === "tr") return "table rows";
    if (tag === "th") return "column headers";
    if (tag === "td") return "table cells";
    if (tag === "li") return "list items";
    if (HEADINGS.has(tag)) return "headings";
    if (tag === "button") return "buttons";
    if (tag === "a") return "links";
    if (tag === "input" || tag === "select" || tag === "textarea") return "form fields";
    if (tag === "img" || tag === "svg") return "images";
    const kind = kindOf(members[0]);
    return kind === "group" ? "boxes" : kind === "text" ? "text items" : "shapes";
  };

  const arrangement = (members: number[]): string => {
    const tops = new Set(members.map((i) => Math.round(elements[i].box.y / 8)));
    const lefts = new Set(members.map((i) => Math.round(elements[i].box.x / 8)));
    if (tops.size === 1) return " in a row";
    if (lefts.size === 1) return " in a column";
    return tops.size < members.length && lefts.size < members.length ? " in a grid" : "";
  };

  const parentsOf = (members: number[]): number => new Set(members.map((i) => elements[i].parent)).size;

  // ---- Emitting ----

  const guessActive = (members: number[]): number => {
    if (members.length < 3) return -1;
    if (members.some((i) => elements[i].state.length > 0) || !members.every(isInteractive)) return -1;
    const usual = modalVisual(members);
    const odd = members.filter((i) => differences(visualOf(i), usual) > 0);
    return odd.length === 1 && differences(visualOf(odd[0]), usual) >= 2 ? odd[0] : -1;
  };

  /** Adds a group; returns its index, or the index of the group with the same members. */
  const emit = (kind: PeerGroupKind, list: number[], parent: number, label: string): number => {
    const members = Array.from(new Set(list)).sort((a, b) => a - b);
    const key = members.join(",");
    const existing = seen.get(key);
    if (existing !== undefined) return existing;
    const index = groups.length;
    groups.push({ kind, members, parent, label, guessedActive: guessActive(members) });
    seen.set(key, index);
    for (const m of members) {
      const of = memberOf.get(m);
      if (of) of.push(index);
      else memberOf.set(m, [index]);
    }
    return index;
  };

  /** True when one existing group already holds all of these elements. */
  const covered = (members: number[]): boolean =>
    (memberOf.get(members[0]) ?? []).some((g) => {
      const set = new Set(groups[g].members);
      return members.every((m) => set.has(m));
    });

  // ---- Level groups, found first ----

  interface LevelRun {
    members: number[];
    /** The plain containers the members are spread over; empty when they share one parent. */
    containers: number[];
  }

  /** The first heading inside an element, in document order. */
  const firstHeading = (i: number, depth = 4): number => {
    for (const c of elements[i].children) {
      if (HEADINGS.has(elements[c].tag) || elements[c].role === "heading") return c;
      if (depth > 1) {
        const found = firstHeading(c, depth - 1);
        if (found >= 0) return found;
      }
    }
    return -1;
  };

  /**
   * Boxes among `candidates` that look like the same kind of box (same
   * background, border, radius and shadow) whatever is inside them. Width is
   * not compared: the columns of a page are often of different widths.
   */
  const levelRuns = (candidates: number[]): number[][] => {
    const buckets = new Map<string, number[]>();
    for (const i of candidates) {
      if (kindOf(i) !== "group" || !hasBox(i) || isTablePart(i)) continue;
      const v = visualOf(i);
      const key = `${v[3]}|${v[4]}|${v[5]}|${elements[i].style.boxShadow}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }
    return Array.from(buckets.values()).filter((run) => run.length >= minSize);
  };

  const pending: LevelRun[] = [];
  /** Element -> the level runs it is in. */
  const runsOf = new Map<number, LevelRun[]>();
  const addRun = (run: LevelRun): void => {
    pending.push(run);
    for (const m of run.members) {
      const list = runsOf.get(m);
      if (list) list.push(run);
      else runsOf.set(m, [run]);
    }
  };

  for (const el of elements) {
    const kids = el.children;
    if (kids.length < 2) continue;
    // Spread over plain containers first: the section cards of a page often sit
    // in two or three columns that are not drawn themselves.
    const byTag = new Map<string, number[]>();
    for (const k of kids) {
      if (kindOf(k) !== "group" || hasBox(k) || isTablePart(k)) continue;
      const list = byTag.get(elements[k].tag);
      if (list) list.push(k);
      else byTag.set(elements[k].tag, [k]);
    }
    for (const wrappers of byTag.values()) {
      if (wrappers.length < 2) continue;
      for (const members of levelRuns(wrappers.flatMap((w) => elements[w].children))) {
        const containers = Array.from(new Set(members.map((m) => elements[m].parent))).sort((a, b) => a - b);
        if (containers.length >= 2) addRun({ members, containers });
      }
    }
    for (const members of levelRuns(kids)) addRun({ members, containers: [] });
  }

  /** True when one level run holds all of these elements. */
  const inLevelRun = (members: number[]): boolean =>
    (runsOf.get(members[0]) ?? []).some((run) => {
      const set = new Set(run.members);
      return members.every((m) => set.has(m));
    });

  // ---- Structural groups ----

  /** Member sets already taken apart. */
  const done = new Set<string>();

  /** Reports the sets of peers among `kids`; returns the elements that ended up in one. */
  const split = (kids: number[], parent: number, describe?: (set: PeerSet, kind: PeerGroupKind) => string | undefined): Set<number> => {
    const grouped = new Set<number>();
    for (const set of cluster(kids)) {
      // A set matched on similarity only adds nothing inside a level group, which
      // already says these boxes are peers, and says it for more of them.
      if (set.parts.length > 1 && inLevelRun(set.members)) continue;
      const parents = parentsOf(set.members);
      const kind: PeerGroupKind = parents === 1 ? "sibling" : parents === set.members.length ? "role" : "cousin";
      peers(set, kind, parent, describe?.(set, kind));
      for (const m of set.members) grouped.add(m);
    }
    return grouped;
  };

  /** `set.members` are peers: report them, then find the peers among their parts. */
  const peers = (set: PeerSet, kind: PeerGroupKind, parent: number, label?: string): void => {
    const { members } = set;
    const key = members.join(",");
    if (done.has(key)) return;
    done.add(key);
    const text = label ?? (kind === "cousin" ? `${members.length} ${thing(members)} in ${parentsOf(members)} lists` : `${members.length} ${thing(members)}${arrangement(members)}`);
    const group = emit(kind, members, parent, text);
    const grouped = new Set<number>();
    // "9 links: the same part of 9 boxes", not the whole chain of where those boxes are.
    const short = text.split(":")[0];

    // Only members with the same structure have their parts matched with each other.
    // A member built differently is taken apart on its own, like any other element.
    const alone: number[] = [];
    for (const part of set.parts) {
      if (part.length < 2) {
        alone.push(...part);
        continue;
      }
      if (part.every((m) => elements[m].tag === "pre")) continue;
      if (part.every(isRow)) {
        // Rows of a table: cells are matched by position, so each column is one group.
        const columns = Math.max(...part.map((m) => elements[m].children.length));
        for (let k = 0; k < columns; k++) {
          const slot = part.map((m) => elements[m].children[k]).filter((c) => c !== undefined);
          for (const m of split(slot, group, (s) => `${s.members.length} ${thing(s.members)}: column ${k + 1} of ${short}`)) grouped.add(m);
        }
      } else {
        const kids = part.flatMap((m) => elements[m].children);
        for (const m of split(kids, group, (s, k) => (k === "role" ? `${s.members.length} ${thing(s.members)}: the same part of ${short}` : undefined))) grouped.add(m);
      }
    }
    for (const m of members) {
      if (elements[m].tag === "pre") continue;
      if (alone.includes(m)) {
        visit(m);
        continue;
      }
      controlRows(elements[m].children, group);
      for (const c of elements[m].children) if (!grouped.has(c)) visit(c);
    }
  };

  /** Finds the groups among the children of one element, then goes down. */
  const visit = (i: number): void => {
    // Preformatted text is source code or sample output: its coloured tokens are not UI parts.
    if (elements[i].tag === "pre") return;
    const kids = elements[i].children;
    if (kids.length === 0) return;
    const grouped = split(kids, -1);
    controlRows(kids, -1);
    for (const c of kids) if (!grouped.has(c)) visit(c);
  };

  /** Level groups of controls: the buttons, fields and toggles that share a row of one container. */
  const controlRows = (kids: number[], parent: number): void => {
    const controls = kids.filter(isControl);
    if (controls.length === 0) return;
    const tallest = Math.max(...controls.map((i) => elements[i].box.height));
    const compound = kids.filter((i) => {
      const el = elements[i];
      if (isControl(i) || el.text || el.box.height > tallest * 1.5) return false;
      return ((el.role !== null && CONTROL_GROUP_ROLES.has(el.role)) || hasBox(i)) && containsControl(i);
    });
    const all = controls.concat(compound).sort((a, b) => elements[a].box.y - elements[b].box.y || a - b);
    const rows: number[][] = [];
    for (const i of all) {
      const box = elements[i].box;
      const row = rows.find((r) => {
        const first = elements[r[0]].box;
        const overlap = Math.min(first.y + first.height, box.y + box.height) - Math.max(first.y, box.y);
        return overlap >= Math.min(first.height, box.height) / 2;
      });
      if (row) row.push(i);
      else rows.push([i]);
    }
    for (const row of rows) {
      if (row.length < minSize || !row.some(isControl) || covered(row)) continue;
      emit("level", row, parent, `${row.length} controls in a row`);
    }
  };

  for (const el of elements) if (el.parent < 0) visit(el.index);

  // ---- Level groups that no structural group already covers ----

  // Largest first, so a run inside a larger one is dropped.
  for (const run of pending.slice().sort((a, b) => b.members.length - a.members.length)) {
    if (covered(run.members)) continue;
    const label = `${run.members.length} boxes at the same level`;
    // The containers that hold them (the columns of a page) are peers too.
    const holder = run.containers.length >= minSize ? emit("sibling", run.containers, -1, `${run.containers.length} containers that hold boxes at the same level`) : -1;
    const group = emit("level", run.members, holder, label);
    // Only what such boxes share is grouped further: their titles and title rows.
    const titles: number[] = [];
    const heads: number[] = [];
    for (const m of run.members) {
      const title = firstHeading(m);
      if (title < 0) continue;
      titles.push(title);
      let head = title;
      while (elements[head].parent !== m) head = elements[head].parent;
      if (head !== title) heads.push(head);
    }
    if (titles.length >= minSize) emit("role", titles, group, `${titles.length} headings: the titles of ${label}`);
    if (heads.length >= minSize) emit("role", heads, group, `${heads.length} boxes: the title rows of ${label}`);
  }

  // Document order, larger groups first, with the parent links kept.
  const order = groups.map((_, i) => i).sort((a, b) => groups[a].members[0] - groups[b].members[0] || groups[b].members.length - groups[a].members.length || a - b);
  const position = new Map(order.map((old, now) => [old, now]));
  return order.map((old) => ({ ...groups[old], parent: groups[old].parent < 0 ? -1 : (position.get(groups[old].parent) ?? -1) }));
}
