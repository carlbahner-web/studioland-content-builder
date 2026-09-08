/* The artboard: selecting, dragging, handles, snapping, undo.
 *
 * Every test here corresponds to something that was actually broken and was
 * found by opening the tool rather than by a unit test. The comments say which,
 * because a regression test whose reason has been forgotten is the first one
 * somebody deletes.
 */
import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { add, clickAt, drag, open, pick, slider, stop, type Editor } from "./harness.ts";

after(stop);

/** The px figures out of the panel's readout, e.g. "540 x 21px at 30%, 25%". */
function parse(readout: string | null) {
  const m = readout?.match(/(\d+) × (\d+)px at ([\d.]+)%, ([\d.]+)%/);
  if (!m) return null;
  return { w: +m[1], h: +m[2], x: +m[3], y: +m[4] };
}

const clean = (ed: Editor) => assert.deepEqual(ed.errors, [], "the page logged errors");

test("a blank start is seeded rather than opening a bare ground", async () => {
  const ed = await open();
  assert.ok((await ed.layers()) > 0, "something should be on the artboard");
  clean(ed);
  await ed.close();
});

/* An emptied artboard has to STAY empty across a reload. The seeding triggers on
 * "no draft was found", never on "the artboard is empty" - otherwise the tool
 * undoes a deliberate decision every time you refresh. */
test("deleting everything and reloading gives back the empty artboard", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await ed.page.waitForTimeout(600);
  assert.equal(await ed.layers(), 0);
  await ed.reload();
  assert.equal(await ed.layers(), 0, "the reload must not re-seed");
  clean(ed);
  await ed.close();
});

/* THE RULE BUG. A rule is 540x21 artboard pixels; its top and bottom handles sit
 * ten pixels from its centre and the grab radius is about twenty-four, so its
 * entire body was inside its own handles and every press started a resize. The
 * most common shape in the tool could not be dragged at all. */
test("a thin shape can be dragged, not just resized", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await add(ed, "Rule");

  const centre = ed.at(0.5, 0.5);
  await ed.page.mouse.move(centre.x, centre.y);
  await ed.page.waitForTimeout(150);
  const cursor = await ed.page.locator("canvas.chrome").evaluate((el) => el.style.cursor);
  assert.equal(cursor, "move", "the middle of a rule must offer a move, not a resize");

  await drag(ed, centre, ed.at(0.3, 0.25));
  const at = parse(await ed.readout());
  assert.ok(at && Math.abs(at.x - 30) < 3 && Math.abs(at.y - 25) < 3, `did not move: ${at?.x},${at?.y}`);
  clean(ed);
  await ed.close();
});

test("a corner handle resizes proportionally", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await add(ed, "Rectangle");
  const before = parse(await ed.readout())!;
  assert.equal(before.w, before.h, "the rectangle starts square");

  const c = ed.at(0.5, 0.5);
  const half = (before.w / 2 / 1080) * (ed.at(1, 0).x - ed.at(0, 0).x);
  await drag(ed, { x: c.x + half, y: c.y + half }, { x: c.x + half * 1.4, y: c.y + half * 1.4 });
  const after = parse(await ed.readout())!;
  assert.ok(after.w > before.w, "it should have grown");
  assert.equal(after.w, after.h, "and stayed square");
  clean(ed);
  await ed.close();
});

/* Placing by eye at preview scale is placing by eye at a quarter size. */
test("a dragged element snaps to the artboard's centre", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await add(ed, "Rectangle");
  const c = ed.at(0.5, 0.5);
  await drag(ed, c, ed.at(0.72, 0.68));
  await drag(ed, ed.at(0.72, 0.68), { x: c.x + 4, y: c.y + 3 });
  const at = parse(await ed.readout())!;
  assert.equal(at.x, 50, "it should have snapped back to the centre line");
  assert.equal(at.y, 50);
  clean(ed);
  await ed.close();
});

test("arrow keys nudge by an artboard pixel, shift by ten", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await add(ed, "Rectangle");
  const start = parse(await ed.readout())!;
  for (let i = 0; i < 5; i++) await ed.page.keyboard.press("ArrowRight");
  await ed.page.waitForTimeout(300);
  const nudged = parse(await ed.readout())!;
  // Five pixels on a 1080 artboard is 0.46% - the readout shows one decimal.
  assert.ok(nudged.x > start.x, "it moved right");
  assert.ok(nudged.x - start.x < 1, `five pixels, not five percent: moved ${nudged.x - start.x}%`);
  clean(ed);
  await ed.close();
});

/* CMD-A sat below the "nothing is selected" guard, so select-all could never run
 * from an empty selection - which is exactly the state you press it in. */
test("select-all works when nothing is selected", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Escape");
  await ed.page.waitForTimeout(200);
  await ed.page.keyboard.press("Control+a");
  await ed.page.waitForTimeout(300);
  assert.match(await ed.selection(), /\d+ selected/);
  clean(ed);
  await ed.close();
});

/* THE UNDO TAG BUG. Undo folds consecutive edits carrying the same tag, and the
 * tag used to name the ELEMENT - so two elements moving together emitted
 * "drag:A", "drag:B", "drag:A", none of which folded, and one group drag became
 * dozens of undo steps. */
test("dragging a group is one undo step, not one per element", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await add(ed, "Rectangle");
  await drag(ed, ed.at(0.5, 0.5), ed.at(0.3, 0.3));
  await add(ed, "Ellipse");
  await drag(ed, ed.at(0.5, 0.5), ed.at(0.7, 0.7));

  await ed.page.keyboard.press("Escape");
  await clickAt(ed, ed.at(0.3, 0.3));
  await clickAt(ed, ed.at(0.7, 0.7), { shift: true });
  assert.equal(await ed.selection(), "2 selected");

  await drag(ed, ed.at(0.7, 0.7), ed.at(0.62, 0.62));
  await pick(ed, "Ellipse");
  const moved = parse(await ed.readout())!;

  await ed.page.keyboard.press("Escape");
  await ed.page.keyboard.press("Control+z");
  await ed.page.waitForTimeout(400);
  await pick(ed, "Ellipse");
  const back = parse(await ed.readout())!;
  assert.notDeepEqual(
    [back.x, back.y],
    [moved.x, moved.y],
    "one press of undo should have taken the whole group drag back",
  );
  assert.ok(Math.abs(back.x - 70) < 3, `expected it back at 70%, got ${back.x}%`);
  clean(ed);
  await ed.close();
});

/* The wordmark's minimum size belongs to the ARTWORK, not to a slot it used to
 * sit in, so it holds wherever the mark is used. */
test("the wordmark cannot be shrunk past the point it stops reading", async () => {
  const ed = await open();
  await pick(ed, "Wordmark");
  const min = await slider(ed, "Size").getAttribute("min");
  assert.ok(Number(min) >= 10, `expected a floor, got min=${min}`);
  clean(ed);
  await ed.close();
});

/* Every element is a layer now - there are no roles - so BUZZ takes the same
 * controls as any other image, including the paper control it could not have. */
test("BUZZ is an ordinary layer: it has a paper control and can be deleted", async () => {
  const ed = await open();
  const before = await ed.layers();
  await pick(ed, "BUZZ");
  const paper = await ed.page.locator(".panel .modes.small").filter({ hasText: "Extra" }).count();
  assert.ok(paper > 0, "BUZZ should offer the paper control");
  await ed.page.keyboard.press("Delete");
  await ed.page.waitForTimeout(400);
  assert.equal(await ed.layers(), before - 1, "BUZZ should be deletable");
  clean(ed);
  await ed.close();
});
