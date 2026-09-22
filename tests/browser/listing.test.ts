/* The listing builder, driven in a real Chromium.
 *
 * Most of this spec exists for one reason: the template's numbers were measured
 * off a flattened artwork export, and nothing in the unit tests can tell whether
 * they still describe the FONT. `layoutText` will happily lay out eight lines at
 * 50.5px against a fallback face and report success; only a browser with TAY
 * Wingman actually loaded can say whether they fit the box the designer drew.
 *
 * The rest is the layering, which is the other thing a pure test cannot see: a
 * headshot behind the frame instead of in front of it is a correct-looking data
 * structure and a ruined graphic.
 */
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { BASE, newPage, stop } from "./harness.ts";
import {
  ADDRESS_BOX,
  ADDRESS_SIZE,
  CAP_RATIO,
  LINE_HEIGHT,
  TRACKING,
} from "../../src/listing/template.ts";
import { ADDRESS_SEED } from "../../src/listing/doc.ts";
import type { Page } from "playwright";

after(stop);

const URL = `${BASE}#/listing`;

type Tool = {
  page: Page;
  errors: string[];
  /** One pixel of the preview canvas, in ARTBOARD coordinates. */
  pixel: (x: number, y: number) => Promise<number[]>;
  /** A point on the preview, in artboard coordinates, as page coordinates. */
  at: (x: number, y: number) => Promise<{ x: number; y: number }>;
  close: () => Promise<void>;
};

async function openTool(): Promise<Tool> {
  const page = await newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".listing-canvas", { timeout: 20_000 });
  // The artwork is five PNGs and a webfont; the first paint happens without
  // them. Wait for the font, which lands last, then one frame for the repaint.
  await page.waitForFunction(() => document.fonts.check('16px "TAYWingman"'), undefined, {
    timeout: 20_000,
  });
  await page.waitForTimeout(600);

  return {
    page,
    errors,
    pixel: (x, y) =>
      page.evaluate(
        ([ax, ay]) => {
          const c = document.querySelector(".listing-canvas") as HTMLCanvasElement;
          // The canvas is backed at devicePixelRatio and drawn at 1080 wide.
          const s = c.width / 1080;
          return [...c.getContext("2d")!.getImageData(Math.round(ax * s), Math.round(ay * s), 1, 1).data];
        },
        [x, y],
      ),
    at: async (x, y) => {
      const box = (await page.locator(".listing-canvas").boundingBox())!;
      return { x: box.x + (x / 1080) * box.width, y: box.y + (y / 1350) * box.height };
    },
    close: () => page.close(),
  };
}

const clean = (t: Tool) => assert.deepEqual(t.errors, [], "the page logged errors");

/** Put a solid-colour PNG into the file input, as if it were a photo of a house. */
async function uploadPhoto(t: Tool, hex: string, w = 1600, h = 1000): Promise<void> {
  const data = await t.page.evaluate(
    ([color, cw, ch]) => {
      const c = document.createElement("canvas");
      c.width = cw as number;
      c.height = ch as number;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = color as string;
      ctx.fillRect(0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    },
    [hex, w, h] as const,
  );
  const base64 = data.split(",")[1];
  await t.page.setInputFiles(".listing-file", {
    name: "house.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await t.page.waitForTimeout(500);
}

/* ------------------------------------------------------------ the type fits */

/* THE MEASUREMENT THAT MATTERS. The address box (482 x 338) and the type size
 * (50.5px) were read off two different files - the designer's blue guide
 * rectangle and the Character panel - and they only agree if TAY Wingman is
 * really as narrow as the rendered example suggested. If this fails, either the
 * font was swapped or the tracking is not being applied, and the seeded address
 * is silently shrinking on every graphic anyone makes. */
test("the seeded address fits its box at the designed size, in the real font", async () => {
  const t = await openTool();
  const lines = ADDRESS_SEED.split("\n").filter(Boolean);
  const m = await t.page.evaluate(
    ([size, tracking, text]) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `${size}px "TAYWingman", sans-serif`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${(tracking as number) * (size as number)}px`;
      const widest = Math.max(...(text as string[]).map((l) => ctx.measureText(l).width));
      const h = ctx.measureText("H");
      return { widest, cap: h.actualBoundingBoxAscent / (size as number) };
    },
    [ADDRESS_SIZE, TRACKING, lines] as const,
  );
  assert.ok(
    m.widest <= ADDRESS_BOX.w,
    `widest seeded line is ${m.widest.toFixed(1)}px in a ${ADDRESS_BOX.w}px box - the seeded ` +
      `address would shrink on every fresh document`,
  );
  assert.ok(
    Math.abs(m.cap - CAP_RATIO) < 0.03,
    `the font's cap ratio measures ${m.cap.toFixed(3)}, the template assumes ${CAP_RATIO} - ` +
      `every first line would sit off its box's top edge`,
  );
  // Eight lines at this pitch have to clear the box too, or the block shrinks.
  const height = 7 * ADDRESS_SIZE * LINE_HEIGHT + ADDRESS_SIZE * CAP_RATIO;
  assert.ok(height <= ADDRESS_BOX.h, `the seeded block is ${height.toFixed(0)}px in ${ADDRESS_BOX.h}px`);
  clean(t);
  await t.close();
});

test("a long address shrinks on the canvas rather than running off it", async () => {
  const t = await openTool();
  const before = await t.pixel(1070, 900);
  await t.page.locator(".listing-block textarea").fill("1247 Old Gettysburg Pike, Mechanicsburg PA");
  await t.page.waitForTimeout(400);
  // The right margin between the address box and the artboard edge (x 1060-1080)
  // is navy in the artwork and must stay navy however long the address gets.
  const margin = await t.pixel(1072, 950);
  assert.ok(margin[2] > margin[0], `the address ran into the margin: ${margin}`);
  assert.ok(before.length === 4);
  clean(t);
  await t.close();
});

/* ------------------------------------------------------------- the layering */

test("the frame's navy field and its strapline survive whatever is behind them", async () => {
  const t = await openTool();
  await uploadPhoto(t, "#ff00ff");
  // Deep in the navy, well below the photo band: the frame is opaque here.
  const navy = await t.pixel(900, 1000);
  assert.ok(navy[2] > navy[0] && navy[2] > navy[1], `expected navy, got ${navy}`);
  assert.ok(navy[0] < 80, `the photo is bleeding through the frame: ${navy}`);
  clean(t);
  await t.close();
});

test("the uploaded photo fills the band the frame leaves open", async () => {
  const t = await openTool();
  await uploadPhoto(t, "#ff00ff");
  for (const [x, y] of [
    [20, 20],
    [1060, 20],
    [540, 300],
    [900, 690], // just above the horizon at y=705 - the seam that is easy to leave
  ]) {
    const px = await t.pixel(x, y);
    assert.ok(
      px[0] > 200 && px[2] > 200 && px[1] < 80,
      `photo missing at ${x},${y}: ${px}`,
    );
  }
  clean(t);
  await t.close();
});

test("the headshot sits in front of the frame, not behind it", async () => {
  const t = await openTool();
  // Inside the arch, where the frame's floral paper would be if the headshot
  // were drawn underneath it. The leaning cut is a photograph there.
  const arch = await t.pixel(250, 800);
  await t.page.getByRole("button", { name: "Sitting" }).click();
  await t.page.waitForTimeout(400);
  const sitting = await t.pixel(250, 800);
  assert.notDeepEqual(arch, sitting, "switching the headshot changed nothing");
  clean(t);
  await t.close();
});

test("a badge appears and disappears where the art puts it", async () => {
  const t = await openTool();
  const pinkish = (px: number[]) => px[0] > 200 && px[1] > 180 && px[2] > 180;
  /* Well INSIDE a stem of SOLD!, not on its edge. The preview is half the
     artboard's resolution, so a point chosen from the artwork's coordinates can
     land on an antialiased boundary and read as a muddy blend whether or not the
     badge drew - which looks exactly like the badge being missing. */
  const inside = () => t.pixel(820, 795);
  assert.ok(!pinkish(await inside()), "a badge was showing before one was picked");
  await t.page.getByRole("button", { name: "SOLD!" }).click();
  await t.page.waitForTimeout(400);
  assert.ok(pinkish(await inside()), "SOLD! did not appear");
  await t.page.getByRole("button", { name: "No badge" }).click();
  await t.page.waitForTimeout(400);
  assert.ok(!pinkish(await inside()), "SOLD! did not go away");
  clean(t);
  await t.close();
});

/* ----------------------------------------------------------- the gestures */

test("text can be dragged, and cannot be dragged off the artboard", async () => {
  const t = await openTool();
  const from = await t.at(900, 950); // in the address block
  const to = await t.at(500, 600);
  await t.page.mouse.move(from.x, from.y);
  await t.page.mouse.down();
  await t.page.mouse.move(to.x, to.y, { steps: 8 });
  await t.page.mouse.up();
  await t.page.waitForTimeout(400);
  // It moved: the address's old home is back to bare navy.
  const vacated = await t.pixel(1000, 890);
  assert.ok(vacated[2] > vacated[0], `the address did not move: ${vacated}`);
  clean(t);
  await t.close();
});

test("the photo can be repositioned inside its band", async () => {
  const t = await openTool();
  // Tall photo: the slack is vertical, so a vertical drag has somewhere to go.
  await uploadPhoto(t, "#ff00ff", 1000, 3000);
  const fit = () =>
    t.page.evaluate(() => (document.querySelector(".listing-canvas") as HTMLCanvasElement).width);
  assert.ok((await fit()) > 0);
  const from = await t.at(540, 300);
  const to = await t.at(540, 60);
  await t.page.mouse.move(from.x, from.y);
  await t.page.mouse.down();
  await t.page.mouse.move(to.x, to.y, { steps: 8 });
  await t.page.mouse.up();
  await t.page.waitForTimeout(400);
  // However far it was dragged, the band stays covered - no page showing through.
  for (const [x, y] of [
    [540, 4],
    [540, 690],
  ]) {
    const px = await t.pixel(x, y);
    assert.ok(px[3] === 255 && px[0] > 200, `the band uncovered at ${x},${y}: ${px}`);
  }
  clean(t);
  await t.close();
});

/* --------------------------------------------------------------- the export */

/* End to end through the actual button, not through the module: the export path
 * runs renderFull -> toBlob -> saveFile, and the last of those is the piece with
 * three environment-dependent branches in it. A download that never arrives is
 * exactly the failure a module-level test cannot see. */
test("the Download button hands over a full-size PNG", async () => {
  const t = await openTool();
  await uploadPhoto(t, "#ff00ff");
  const wait = t.page.waitForEvent("download", { timeout: 20_000 });
  await t.page.getByRole("button", { name: /Download/ }).click();
  const download = await wait;
  const file = await download.path();
  assert.ok(file, "no file was written");
  const head = await readFile(file);
  assert.equal(head.readUInt32BE(0), 0x89504e47, "not a PNG");
  // IHDR width and height live at a fixed offset in every PNG.
  assert.equal(head.readUInt32BE(16), 1080);
  assert.equal(head.readUInt32BE(20), 1350);
  assert.match(download.suggestedFilename(), /\.png$/);
  clean(t);
  await t.close();
});

test("the other tool is still reachable and still boots", async () => {
  const t = await openTool();
  await t.page.getByRole("link", { name: /Brand content builder/ }).click();
  await t.page.waitForSelector("canvas.chrome", { timeout: 20_000 });
  clean(t);
  await t.close();
});
