/* What actually lands on the artboard: paper, transparency, images, type.
 *
 * These read PIXELS off the real canvas - the one that exports - rather than
 * asking the panel what it thinks. That is the point of them: every bug they
 * cover was a case where the state was right and the picture was wrong.
 */
import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { writeFileSync } from "node:fs";
import zlib from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { add, open, slider, stop, type Editor } from "./harness.ts";

after(stop);

const clean = (ed: Editor) => assert.deepEqual(ed.errors, [], "the page logged errors");

/** Standard deviation of the red channel over a patch - flat colour reads 0. */
function variance(ed: Editor, fx: number, fy: number, size = 0.2) {
  return ed.page.evaluate(
    ([x, y, s]) => {
      const c = document.querySelector(".board canvas") as HTMLCanvasElement;
      const side = Math.round(Math.min(c.width, c.height) * s);
      const d = c
        .getContext("2d")!
        .getImageData(Math.round(c.width * x - side / 2), Math.round(c.height * y - side / 2), side, side).data;
      let n = 0;
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum += d[i];
        sq += d[i] * d[i];
        n++;
      }
      return Math.sqrt(sq / n - (sum / n) ** 2);
    },
    [fx, fy, size] as const,
  );
}

const paper = async (ed: Editor, mode: string) => {
  await ed.page
    .locator(".panel .modes.small")
    .filter({ hasText: "Extra" })
    .getByRole("button", { name: mode, exact: true })
    .click();
  await ed.page.waitForTimeout(500);
};

test("a layer can take the sheet's paper, none of it, or extra", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await add(ed, "Rectangle");
  await slider(ed, "Size").fill("70");
  await ed.page.waitForTimeout(400);

  const dflt = await variance(ed, 0.5, 0.5);
  await paper(ed, "None");
  const none = await variance(ed, 0.5, 0.5);
  await paper(ed, "Extra");
  const extra = await variance(ed, 0.5, 0.5);

  assert.equal(none, 0, "no paper means a perfectly flat field");
  assert.ok(dflt > 0, "the sheet's grain should be visible");
  assert.ok(extra > dflt * 1.4, `extra should be markedly grainier: ${extra} vs ${dflt}`);
  clean(ed);
  await ed.close();
});

/* THE ANCHORING CLAIM, which is the whole reason per-element paper does not read
 * as a sticker: the pattern is filled from the ARTBOARD's origin, so a patch of
 * it clipped to one element lines up with the paper beside it. If it were
 * anchored to the element, the texture would travel when the element moved. */
test("the paper is anchored to the artboard, so it does not travel with an element", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await add(ed, "Rectangle");
  await slider(ed, "Size").fill("70");
  await ed.page.waitForTimeout(300);
  await paper(ed, "Extra");

  const patch = () =>
    ed.page.evaluate(() => {
      const c = document.querySelector(".board canvas") as HTMLCanvasElement;
      const d = c
        .getContext("2d")!
        .getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 24, 24).data;
      return [...d].filter((_, i) => i % 4 === 0).join(",");
    });

  const before = await patch();
  // Seven across and five down - not a multiple of the 256px grain tile.
  for (let i = 0; i < 7; i++) await ed.page.keyboard.press("ArrowRight");
  for (let i = 0; i < 5; i++) await ed.page.keyboard.press("ArrowDown");
  await ed.page.waitForTimeout(600);

  assert.equal(await patch(), before, "the paper moved with the element");
  clean(ed);
  await ed.close();
});

test("no ground means the export carries real alpha, and the grain stays off the hole", async () => {
  const ed = await open();
  const size = await ed.page.evaluate(() => {
    const c = document.querySelector(".board canvas") as HTMLCanvasElement;
    return { w: c.width, h: c.height };
  });

  const opaque = await ed.pixel(4, 4);
  assert.equal(opaque[3], 255, "with a ground, the corner is solid");

  await ed.section("Color");
  await ed.page.getByText("No ground — save with transparency").click();
  await ed.page.waitForTimeout(700);

  const hole = await ed.pixel(4, 4);
  assert.equal(hole[3], 0, "the corner should be a hole, not grey grain");

  // And the artwork on it is still fully opaque.
  const solid = await ed.page.evaluate(([w, h]) => {
    const c = document.querySelector(".board canvas") as HTMLCanvasElement;
    const d = c.getContext("2d")!.getImageData(0, 0, w, h).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) return true;
    return false;
  }, [size.w, size.h] as const);
  assert.ok(solid, "the design itself should still be opaque");
  clean(ed);
  await ed.close();
});

/* A 300x300 PNG: a teal circle on a near-white wall, with a WHITE PATCH inside
 * the circle. The patch is the whole point - it proves the cutout floods from
 * the edges rather than matching colour globally, so a white shirt against a
 * white wall keeps the shirt. */
function subjectPng(): string {
  const W = 300;
  const H = 300;
  const rows: number[] = [];
  for (let y = 0; y < H; y++) {
    rows.push(0);
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 150, y - 150);
      if (d < 90) {
        const inPatch = x > 130 && x < 170 && y > 130 && y < 150;
        rows.push(...(inPatch ? [245, 245, 242] : [58, 97, 104]));
      } else {
        const v = 246 - Math.round((x + y) * 0.02);
        rows.push(v, v, v);
      }
    }
  }

  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.from(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const path = join(tmpdir(), "studioland-subject.png");
  writeFileSync(path, png);
  return path;
}

/* UPLOADS SILENTLY DREW NOTHING once, because an image layer's lookup key and
 * its display label were one field - identical for a folder file, different for
 * an upload. Nothing threw; the layer just never appeared. */
test("an uploaded image is placed and actually draws", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await ed.page.setInputFiles('input[type="file"]', subjectPng());
  await ed.page.waitForTimeout(1200);

  assert.equal(await ed.layers(), 1, "the upload should be on the artboard");
  const readout = await ed.readout();
  assert.ok(readout, "and should report a size, which means it has a box to draw in");

  // The teal subject should be somewhere in the middle of it.
  const drawn = await ed.page.evaluate(() => {
    const c = document.querySelector(".board canvas") as HTMLCanvasElement;
    const p = c.getContext("2d")!.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data;
    return [...p];
  });
  assert.equal(drawn[3], 255, "something is drawn at the centre");
  clean(ed);
  await ed.close();
});

test("removing a background keeps what the background colour surrounds", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await ed.page.setInputFiles('input[type="file"]', subjectPng());
  await ed.page.waitForTimeout(1200);
  await slider(ed, "Size").fill("60");
  await ed.page.waitForTimeout(400);

  const sample = () =>
    ed.page.evaluate(() => {
      const c = document.querySelector(".board canvas") as HTMLCanvasElement;
      const g = c.getContext("2d")!;
      const cx = c.width / 2;
      const cy = c.height / 2;
      const half = Math.min(c.width, c.height) * 0.3;
      const px = (x: number, y: number) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data];
      return {
        corner: px(cx - half + 8, cy - half + 8),
        patch: px(cx - half * 0.07, cy - half * 0.1),
      };
    });

  const before = await sample();
  await ed.page.getByRole("button", { name: "Remove", exact: true }).click();
  await ed.page.waitForTimeout(1200);
  const after = await sample();

  assert.notDeepEqual(after.corner, before.corner, "the wall should be gone from the corner");
  // The enclosed patch is the same near-white as the wall, and must survive.
  assert.ok(after.patch[0] > 200 && after.patch[1] > 200, `the enclosed patch was eaten: ${after.patch}`);
  clean(ed);
  await ed.close();
});

/* The caret is a real <textarea> laid over the artboard, and the whole promise
 * is that what you type is where it lands. Three separate fixes went into that;
 * this pins the one that is easiest to break again - the box growing about its
 * own centre the way the drawn text does. */
test("typing on the artboard grows the caret box symmetrically", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await add(ed, "Text");
  await ed.page.mouse.dblclick(ed.at(0.5, 0.5).x, ed.at(0.5, 0.5).y);
  await ed.page.waitForTimeout(400);
  assert.equal(await ed.page.locator("textarea.caret").count(), 1, "a caret should have opened");

  await ed.page.keyboard.type("One line");
  await ed.page.waitForTimeout(400);
  const before = (await ed.page.locator("textarea.caret").boundingBox())!;
  await ed.page.keyboard.press("Enter");
  await ed.page.keyboard.type("two lines");
  await ed.page.waitForTimeout(500);
  const after = (await ed.page.locator("textarea.caret").boundingBox())!;

  assert.ok(after.height > before.height, "the box should have grown");
  const drift = Math.abs(before.y - after.y - (after.height - before.height) / 2);
  assert.ok(drift < 3, `it grew off-centre by ${drift}px`);

  await ed.page.keyboard.press("Escape");
  await ed.page.waitForTimeout(400);
  assert.equal(await ed.page.locator("textarea.caret").count(), 0, "escape closes it");
  clean(ed);
  await ed.close();
});

test("a saved design can be made the one a blank start opens", async () => {
  const ed = await open();
  await ed.page.keyboard.press("Control+a");
  await ed.page.keyboard.press("Delete");
  await add(ed, "Rule");
  await add(ed, "Starburst");
  assert.equal(await ed.layers(), 2);

  await ed.section("Designs");
  await ed.page.locator('.panel input[placeholder="Name this design"]').fill("Starting point");
  await ed.page.getByRole("button", { name: "Save", exact: true }).last().click();
  await ed.page.waitForTimeout(700);
  await ed.page
    .locator(".saved li")
    .filter({ hasText: "Starting point" })
    .getByTitle("Open this on a blank start")
    .click();
  await ed.page.waitForTimeout(400);

  // Clear only the draft, keeping the saved design and the star.
  await ed.page.evaluate(
    () =>
      new Promise((res) => {
        const req = indexedDB.open("studioland-studio", 1);
        req.onsuccess = () => {
          const tx = req.result.transaction("kv", "readwrite");
          tx.objectStore("kv").delete("draft");
          tx.oncomplete = () => res(null);
        };
      }),
  );
  await ed.reload();
  assert.equal(await ed.layers(), 2, "the blank start should open the starred design");
  clean(ed);
  await ed.close();
});
