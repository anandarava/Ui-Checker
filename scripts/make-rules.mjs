#!/usr/bin/env node
// Writes shared/ui-rules.json, the rule catalogue. Edit the table below and run
//   node scripts/make-rules.mjs
// Keeping the catalogue in one compact table makes it easy to review; the JSON
// file is what the extension, the reports and CI read.
//
// `implemented` flags are kept from the existing JSON, so re-running this script
// never switches a finished rule back off.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "shared", "ui-rules.json");
const VERSION = "0.1.0";

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).rules : [];
const wasImplemented = new Set(previous.filter((r) => r.implemented).map((r) => r.id));

/** id, name, category, phase, severity, tolerance [value, unit] or null, description, fix */
const TABLE = [
  ["TYP-01", "Font family differs", "typography", "3A", "High", null, "Text that plays the same role in peer elements uses a different font family.", "Use the same font family as the peer elements."],
  ["TYP-02", "Font size differs", "typography", "3A", "High", [0.5, "px"], "Text that plays the same role in peer elements has a different font size.", "Use the same font size as the peer elements."],
  ["TYP-03", "Font weight differs", "typography", "3A", "Medium", null, "Text that plays the same role in peer elements has a different font weight.", "Use the same font weight as the peer elements."],
  ["TYP-04", "Line height differs", "typography", "3B", "Low", [1, "px"], "Text that plays the same role in peer elements has a different line height.", "Use the same line height as the peer elements."],
  ["TYP-05", "Text colour differs", "typography", "3A", "Medium", [3, "deltaE"], "Text that plays the same role in peer elements has a different colour, or is a link in one and plain text in another.", "Use the same text colour and the same kind of element (link or plain text) as the peers."],
  ["TYP-06", "Text alignment differs", "typography", "3B", "Medium", [2, "px"], "Text in one peer element is aligned differently from the others (measured from the text itself).", "Align the text the same way as in the peer elements."],
  ["LAY-01", "Inner padding differs", "layout", "3A", "High", [2, "px"], "The space between a container edge and its content differs from the same space in peer containers.", "Give the container the same padding as its peers."],
  ["LAY-02", "Uneven padding inside one container", "layout", "3A", "Medium", [1.5, "ratio"], "A container has much more space on one side than on the opposite side.", "Balance the padding, or remove the empty space."],
  ["LAY-03", "Uneven gaps", "layout", "3A", "Medium", [2, "px"], "The gaps between sibling elements are not equal, or the row gap and column gap of a grid are very different.", "Use one gap value between these elements."],
  ["LAY-04", "Edges not aligned", "layout", "3A", "High", [2, "px"], "Peer content does not line up on the same edge: content inside peer containers, a title and the content below it, or a page title and the cards below it.", "Move the element so that its edge lines up with its peers."],
  ["LAY-05", "Size differs", "layout", "3A", "Medium", [2, "px"], "A box whose size is set by the layout (tile, card, avatar, button in a row) has a different width or height from its peers.", "Give the box the same size as its peers."],
  ["LAY-06", "Content inset differs between sections", "layout", "3A", "High", [4, "px"], "The content of one section starts further in from the section edge than the content of sibling sections.", "Start the content at the same distance from the section edge as in the other sections."],
  ["LAY-07", "Not vertically centred in its row", "layout", "3B", "Low", [2, "px"], "Items that sit in one row (icon and text, or values in columns) are not on the same baseline or centre line.", "Centre the items on the same line."],
  ["LAY-08", "Peer columns end at different heights", "layout", "3B", "Low", [8, "px"], "Columns or cards that sit side by side end at different heights.", "Stretch the shorter column, or accept the difference."],
  ["LAY-09", "Table header not aligned with its column", "layout", "3B", "Medium", [2, "px"], "A table header does not line up with the cells of its column, or one column mixes alignments.", "Align the header and the cells of the column the same way."],
  ["LAY-10", "Controls in one row differ", "layout", "3B", "Medium", [2, "px"], "Buttons, inputs and toggles in one row have different heights or uneven gaps.", "Give the controls of the row one height and one gap."],
  ["GRP-01", "Odd element in a group of controls", "group", "3B", "High", null, "A group of buttons, toggles or tabs contains an element that does not match the others.", "Remove the stray element, or make it a proper member of the group."],
  ["GRP-02", "Part missing in one item", "group", "3B", "Medium", null, "One of several repeated items lacks a part the others have, such as an icon or a label.", "Add the missing part, or remove it from all the items."],
  ["GRP-03", "Divider stops short", "group", "3B", "Low", [2, "px"], "A divider or border inside one container stops before the container edge, while it reaches the edge in peer containers.", "Make the divider run the full length, as in the peer containers."],
  ["BOX-01", "Corner radius differs", "box", "3B", "Low", [1, "px"], "A box has a different corner radius from its peers.", "Use the same corner radius as the peers."],
  ["BOX-02", "Border or shadow differs", "box", "3B", "Low", null, "A box has a different border or shadow from its peers.", "Use the same border and shadow as the peers."],
  ["BOX-03", "Background differs", "box", "3B", "Low", [3, "deltaE"], "A box has a different background colour from its peers.", "Use the same background as the peers."],
  ["TYP-07", "Link style differs", "typography", "5", "Medium", [3, "deltaE"], "Links that are styled as links do not all look the same: some are underlined and others are not, or they use different colours.", "Use one style for links: the same colour, and underlined or not."],
  ["TXT-01", "Text is cut off", "content", "5", "Medium", [2, "px"], "Text runs out of its box, or is cut off by it with no ellipsis to show that there is more.", "Give the text room, let it wrap, or shorten it with an ellipsis and offer the full text."],
  ["TXT-03", "Text shortened in different ways", "content", "5", "Medium", null, "Peer elements shorten their text in different ways: the ellipsis is typed into the text in some and added by the browser in others, or it is written differently.", "Shorten every text the same way: let the browser add the ellipsis and keep the full text in the page."],
  ["FMT-01", "Value format differs", "content", "5", "Medium", null, "Values of one column or list field follow different patterns: date formats, number formats or capitalisation.", "Write every value of the column or field in the same format."],
  ["IMG-01", "Image does not load", "content", "6", "High", null, "An image, or the background image of an element, failed to load, so the page shows a gap or a broken-image icon.", "Fix the address of the image, or remove the image."],
];

const rules = TABLE.map(([id, name, category, phase, severity, tolerance, description, fix]) => ({
  id,
  name,
  category,
  phase,
  description,
  fix,
  severity,
  ...(tolerance ? { tolerance: { value: tolerance[0], unit: tolerance[1] } } : {}),
  enabled: true,
  implemented: wasImplemented.has(id),
}));

writeFileSync(OUT, JSON.stringify({ version: VERSION, rules }, null, 2) + "\n");
console.log(`${rules.length} rules written to ${path.relative(process.cwd(), OUT)}`);
