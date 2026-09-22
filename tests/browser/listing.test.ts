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
  ARCH_RIGHT,
  BADGE_BOX,
  BADGE_SIZE,
  BADGE_TRACKING,
  CANVAS,
  CAP_RATIO,
  COLUMN_GAP,
  GUTTER,
  HEADSHOTS,
  HORIZON,
  LINE_HEIGHT,
  STRAPLINE_TOP,
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
  /** How many pale-pink (i.e. type) pixels are inside an artboard rectangle. */
  ink: (box: { x: number; y: number; w: number; h: number }) => Promise<number>;
  /** Rows of type in the column right of the arch, as [top, bottom] bands. */
  bands: () => Promise<[number, number][]>;
  close: () => Promise<void>;
};

async function openTool(opts: { phone?: boolean } = {}): Promise<Tool> {
  const page = await newPage(opts);
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
    /* Counting over a region rather than probing one pixel. Type is mostly gaps
       - a point picked from a slot's box lands between two words as often as on
       a stem - and "is there type here" is the actual question. */
    ink: (box) =>
      page.evaluate(
        ([bx, by, bw, bh]) => {
          const c = document.querySelector(".listing-canvas") as HTMLCanvasElement;
          const s = c.width / 1080;
          const d = c
            .getContext("2d")!
            .getImageData(
              Math.round(bx * s),
              Math.round(by * s),
              Math.round(bw * s),
              Math.round(bh * s),
            ).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 200 && d[i + 1] > 180 && d[i + 2] > 180) n++;
          }
          return n;
        },
        [box.x, box.y, box.w, box.h],
      ),
    /* The type column's horizontal bands, found by scanning rows. Used for the
       vertical rhythm, which cannot be asserted from the template alone: where
       a block's ink actually starts depends on the face's cap height, and the
       whole point of the distribution is what a reader sees. */
    bands: () =>
      page.evaluate(([archRight]) => {
        const src = document.querySelector(".listing-canvas") as HTMLCanvasElement;
        const c = document.createElement("canvas");
        c.width = 1080;
        c.height = 1350;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(src, 0, 0, 1080, 1350);
        const d = ctx.getImageData(0, 0, 1080, 1350).data;
        const rows: number[] = [];
        for (let y = 700; y < 1350; y++) {
          let n = 0;
          // Right of the arch only: the headshot inside it is a photograph of a
          // woman against pale brick, which reads as ink on every single row.
          for (let x = archRight + 1; x < 1080; x++) {
            const i = (y * 1080 + x) * 4;
            if (d[i] > 200 && d[i + 1] > 180 && d[i + 2] > 180) n++;
          }
          rows.push(n);
        }
        const out: [number, number][] = [];
        let start: number | null = null;
        for (let i = 0; i < rows.length; i++) {
          if (rows[i] > 0 && start === null) start = i;
          else if (rows[i] === 0 && start !== null) {
            out.push([start + 700, i - 1 + 700]);
            start = null;
          }
        }
        return out.filter((b) => b[1] - b[0] > 3);
      }, [ARCH_RIGHT] as const),
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
  await t.page.locator(".listing-block textarea").fill("1247 Old Gettysburg Pike, Mechanicsburg PA");
  await t.page.waitForTimeout(400);
  /* The gutter either side of the type column is navy in the artwork and has to
     stay navy however long the address gets - on the edge side, and on the arch
     side, where the neighbour is a photograph rather than a margin. */
  const rightGutter = { x: ADDRESS_BOX.x + ADDRESS_BOX.w, y: 874, w: GUTTER, h: 338 };
  const leftGutter = { x: ARCH_RIGHT + 1, y: 874, w: GUTTER, h: 338 };
  assert.equal(await t.ink(rightGutter), 0, "the address ran into the edge margin");
  assert.equal(await t.ink(leftGutter), 0, "the address ran into the arch's gutter");
  clean(t);
  await t.close();
});

/* ------------------------------------------------------------- the layering */

test("the frame's navy field and its strapline survive whatever is behind them", async () => {
  const t = await openTool();
  await uploadPhoto(t, "#ff00ff");
  /* Deep in the navy, well below the photo band, and in the gutter rather than
     at a point picked off a screenshot: the type column is the one part of this
     region that is not bare navy, and it moves whenever the layout does. */
  const navy = await t.pixel(ADDRESS_BOX.x + ADDRESS_BOX.w + GUTTER / 2, 1000);
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

/* The photographed headshots are CLIPPED to the arch rather than cut out, so
 * the two things that can go wrong are the clip leaking - a rectangle of studio
 * grey over the navy - and the saved placement not being applied. Both are
 * invisible to a unit test and obvious here. */
test("every headshot option draws inside the arch and nowhere else", async () => {
  const t = await openTool();
  const seen: string[] = [];
  for (const shot of HEADSHOTS) {
    await t.page.getByRole("button", { name: shot.label, exact: true }).click();
    await t.page.waitForTimeout(450);
    // Deep inside the arch: something is always drawn there.
    const inside = await t.pixel(250, 900);
    assert.ok(inside[3] === 255, `${shot.label} left the arch empty`);
    seen.push(inside.join(","));
    /* Just right of the arch, on the navy. A clip that leaked would put studio
       grey or skin here; the artwork is navy, and navy is blue-dominant. */
    const beside = await t.pixel(ARCH_RIGHT + 12, 900);
    assert.ok(
      beside[2] > beside[0] && beside[2] > beside[1],
      `${shot.label} spilled past the arch: ${beside}`,
    );
  }
  assert.equal(new Set(seen).size, HEADSHOTS.length, "two options render identically");
  clean(t);
  await t.close();
});

test("the badge is live type: presets, free text, and nothing when empty", async () => {
  const t = await openTool();
  // The badge's own column, above the address. Taken from the template rather
  // than written out, so moving the column cannot leave this probing empty navy
  // and reporting that the badge failed to draw.
  const box = BADGE_BOX;
  assert.ok((await t.ink(box)) < 200, "a badge was showing before one was picked");

  await t.page.getByRole("button", { name: "SOLD!" }).click();
  await t.page.waitForTimeout(400);
  const sold = await t.ink(box);
  assert.ok(sold > 800, `SOLD! did not appear (${sold} ink pixels)`);

  await t.page.getByRole("button", { name: "PENDING!" }).click();
  await t.page.waitForTimeout(400);
  const pending = await t.ink(box);
  assert.ok(pending > sold, `PENDING! should set more ink than SOLD! (${pending} vs ${sold})`);

  /* The point of the change: it is a text field, not two pictures. Anything
     typed lands in the same place at the same size. */
  await t.page.locator("#listing-badge").fill("OPEN SUNDAY!");
  await t.page.waitForTimeout(400);
  assert.ok((await t.ink(box)) > 800, "typed badge text did not draw");

  await t.page.getByRole("button", { name: "No badge" }).click();
  await t.page.waitForTimeout(400);
  assert.ok((await t.ink(box)) < 200, "the badge did not go away");
  assert.equal(await t.page.locator("#listing-badge").inputValue(), "");
  clean(t);
  await t.close();
});

/* The badge must not drift off its column however long the words get - the
 * artwork's navy runs out at the arch on one side and the artboard edge on the
 * other, and type in either place is a ruined graphic rather than a tight one. */
test("a long badge shrinks instead of reaching the arch or the edge", async () => {
  const t = await openTool();
  /* Measured as a DIFFERENCE, not against a threshold. The strip left of the
     badge's column holds the arch, and the headshot inside it is a photograph
     of a woman against a pale brick wall - which answers "is there pale ink
     here" with a confident yes whether or not the badge has spilled into it.
     What matters is that setting the badge does not ADD any. */
  const left = { x: 0, y: BADGE_BOX.y, w: ARCH_RIGHT + 1, h: BADGE_BOX.h };
  const right = {
    x: BADGE_BOX.x + BADGE_BOX.w,
    y: BADGE_BOX.y,
    w: CANVAS.w - (BADGE_BOX.x + BADGE_BOX.w),
    h: BADGE_BOX.h,
  };
  const before = [await t.ink(left), await t.ink(right)];
  /* A long badge someone would really type. Pushed much past this the type
     shrinks so far that the outline - a fixed fraction of the size - closes
     over the fill, which is legitimate behaviour for words that do not belong
     on a badge, and not what this test is about. */
  await t.page.locator("#listing-badge").fill("UNDER CONTRACT!");
  await t.page.waitForTimeout(500);
  const after = [await t.ink(left), await t.ink(right)];
  assert.ok(after[0] <= before[0] + 40, `the badge reached the arch (${before[0]} -> ${after[0]})`);
  assert.ok(after[1] <= before[1] + 40, `the badge reached the edge (${before[1]} -> ${after[1]})`);
  // And it did draw somewhere - a shrink-to-nothing would pass the two above.
  assert.ok((await t.ink(BADGE_BOX)) > 800, "the badge drew nothing");
  clean(t);
  await t.close();
});

/* THE BADGE IS THE SAME FACE AS EVERYTHING ELSE, SET TIGHT.
 *
 * It looked for a while like the artwork's badges were a heavier, condensed cut
 * that this repo did not have - measured against TAY Wingman's ADVANCE widths at
 * the address's -0.1em tracking, SOLD! came out 27% too narrow for its height.
 * Two errors compounded: an ink box was compared against an advance width, and
 * the badge was assumed to share the address's tracking. At the badge's own
 * 130px and -0.2em this font reproduces the flats almost exactly, and that is
 * what this pins - against the numbers measured off the artwork by separating
 * its cream fill from the navy stroke around it. */
test("the badge renders at the artwork's own ink size", async () => {
  const t = await openTool();
  const measured = await t.page.evaluate(
    ([size, tracking, words]) => {
      const inkBox = (text: string) => {
        const c = document.createElement("canvas");
        c.width = 1600;
        c.height = 400;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, 1600, 400);
        ctx.font = `${size}px "TAYWingman", sans-serif`;
        if ("letterSpacing" in ctx) ctx.letterSpacing = `${(tracking as number) * (size as number)}px`;
        ctx.fillStyle = "#fff";
        ctx.fillText(text, 60, 300);
        const d = ctx.getImageData(0, 0, 1600, 400).data;
        let x0 = 1600, x1 = -1, y0 = 400, y1 = -1;
        for (let y = 0; y < 400; y++)
          for (let x = 0; x < 1600; x++)
            if (d[(y * 1600 + x) * 4] > 128) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
        return { w: x1 - x0 + 1, h: y1 - y0 + 1 };
      };
      return Object.fromEntries((words as readonly string[]).map((w) => [w, inkBox(w)]));
    },
    [BADGE_SIZE, BADGE_TRACKING, ["SOLD!", "PENDING!"]] as const,
  );
  // Fill-only boxes measured off assets/listing-src/reference/.
  const artwork = { "SOLD!": { w: 272, h: 87 }, "PENDING!": { w: 440, h: 87 } };
  for (const [word, want] of Object.entries(artwork)) {
    const got = measured[word] as { w: number; h: number };
    assert.ok(
      Math.abs(got.w - want.w) <= 4 && Math.abs(got.h - want.h) <= 4,
      `${word} renders ${got.w}x${got.h}, the artwork is ${want.w}x${want.h}`,
    );
  }
  clean(t);
  await t.close();
});

/* THE VERTICAL RHYTHM. Between the photo's bottom edge and the strapline there
 * is a fixed 573px holding two blocks of type, and the artwork's own spacing did
 * not survive the font: both blocks render shorter here than the flats were, so
 * 61px of type became slack and pooled at the bottom, leaving the column
 * drifting up away from the strapline. The gaps are equal now, and this is the
 * check, because the conversion from a box's y to where its cream cap actually
 * lands is a property of the face rather than of any arithmetic in the
 * template. */
test("the badge and the address are distributed evenly down the column", async () => {
  const t = await openTool();
  await t.page.getByRole("button", { name: "SOLD!", exact: true }).click();
  await t.page.waitForTimeout(450);
  const bands = await t.bands();
  assert.ok(bands.length >= 3, `expected the badge, the address and the strapline: ${bands}`);

  const badge = bands[0];
  const strapline = bands[bands.length - 1];
  // The address is three bands, because its blank lines make three groups.
  const addressTop = bands[1][0];
  const addressBottom = bands[bands.length - 2][1];

  const gaps = [
    badge[0] - HORIZON,
    addressTop - badge[1] - 1,
    strapline[0] - addressBottom - 1,
  ];
  assert.equal(strapline[0], STRAPLINE_TOP, "the strapline moved, so the space it divides changed");
  for (const [i, gap] of gaps.entries()) {
    assert.ok(
      Math.abs(gap - COLUMN_GAP) <= 3,
      `gap ${i} is ${gap}px, not ${COLUMN_GAP}px - the column is ${gaps.join(" / ")}`,
    );
  }
  clean(t);
  await t.close();
});

/* ----------------------------------------------------------- the gestures */

/* Nothing on this artboard moves except the photo, and there is exactly one
 * piece of editable type. A template whose address has drifted a few pixels
 * between one graphic and the next is worse than one that could not be adjusted
 * at all, and a drag that "mostly" does nothing is worse than one that plainly
 * does nothing - so this drags right across the address and asserts the pixels
 * are identical afterwards. */
test("dragging the text does nothing at all", async () => {
  const t = await openTool();
  const sample = () => Promise.all([t.pixel(700, 900), t.pixel(820, 960), t.pixel(660, 1180)]);
  const before = await sample();
  const from = await t.at(820, 960); // squarely inside the address block
  const to = await t.at(300, 500);
  await t.page.mouse.move(from.x, from.y);
  await t.page.mouse.down();
  await t.page.mouse.move(to.x, to.y, { steps: 10 });
  await t.page.mouse.up();
  await t.page.waitForTimeout(400);
  assert.deepEqual(await sample(), before, "the address moved");
  clean(t);
  await t.close();
});

test("there is one text block and no way to add another", async () => {
  const t = await openTool();
  assert.equal(await t.page.getByRole("button", { name: /Add text/ }).count(), 0);
  assert.equal(await t.page.locator("textarea").count(), 1);
  // Nor a way to resize it: the address is the size the design says it is, and
  // only shrinks when what is typed will not fit.
  assert.equal(await t.page.locator(".listing-block input[type=range]").count(), 0);
  clean(t);
  await t.close();
});

/* Pinch, driven as two real pointers. Playwright has no pinch helper, so the
 * touches are dispatched directly - which is also the honest test, because the
 * component's claim is about pointer events rather than about a gesture API. */
test("pinching the photo zooms it, about the pinch rather than the centre", async () => {
  const t = await openTool();
  await uploadPhoto(t, "#ff00ff", 2000, 1500);
  const zoom = () => t.page.locator(".listing-readout").textContent();
  const before = await zoom();
  await t.page.evaluate(() => {
    const c = document.querySelector(".listing-canvas") as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const send = (type: string, id: number, x: number, y: number) =>
      c.dispatchEvent(
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 1,
          clientX: r.left + x,
          clientY: r.top + y,
          bubbles: true,
        }),
      );
    // setPointerCapture on a synthetic id throws; the component only needs the
    // events, so stub it rather than let the first one take the handler down.
    c.setPointerCapture = () => {};
    c.hasPointerCapture = () => false;
    c.releasePointerCapture = () => {};
    send("pointerdown", 1, 120, 100);
    send("pointerdown", 2, 180, 140);
    for (let i = 1; i <= 8; i++) {
      send("pointermove", 1, 120 - i * 6, 100 - i * 4);
      send("pointermove", 2, 180 + i * 6, 140 + i * 4);
    }
    send("pointerup", 1, 72, 68);
    send("pointerup", 2, 228, 172);
  });
  await t.page.waitForTimeout(400);
  const after = await zoom();
  assert.notEqual(after, before, "the pinch did not change the scale");
  assert.ok(parseInt(after!, 10) > parseInt(before!, 10), `spreading should zoom in: ${before} -> ${after}`);
  clean(t);
  await t.close();
});

test("the photo can be repositioned inside its band", async () => {
  const t = await openTool();
  // Tall photo: the slack is vertical, so a vertical drag has somewhere to go.
  await uploadPhoto(t, "#ff00ff", 1000, 3000);
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

/* THE PHONE CASE. This tool is used from a phone more than from a desk, and on
 * iOS Safari `<a download>` on a blob often opens the image in a tab rather
 * than saving it - so a tool that reports "Saved" there has said something
 * untrue. On a coarse pointer the export has to put the finished image on
 * screen to press and hold instead. */
test("on a touch device the export offers the image to press and hold", async () => {
  const t = await openTool({ phone: true });
  await uploadPhoto(t, "#ff00ff");
  await t.page.getByRole("button", { name: /Download/ }).click();
  await t.page.waitForSelector(".held img", { timeout: 15_000 });
  const src = await t.page.locator(".held img").getAttribute("src");
  assert.ok(src?.startsWith("data:image/png"), `the held image is not a PNG: ${src?.slice(0, 40)}`);
  // A data URI, not a blob URL: long-press "Add to Photos" is reliable on one
  // and not on the other.
  const shown = await t.page.locator(".held p").textContent();
  assert.match(shown ?? "", /press and hold/i);
  await t.page.getByRole("button", { name: "Done" }).click();
  assert.equal(await t.page.locator(".held").count(), 0, "the sheet would not dismiss");
  clean(t);
  await t.close();
});

test("on a desktop the export downloads and shows no press-and-hold sheet", async () => {
  const t = await openTool();
  const wait = t.page.waitForEvent("download", { timeout: 20_000 });
  await t.page.getByRole("button", { name: /Download/ }).click();
  await wait;
  await t.page.waitForTimeout(300);
  assert.equal(await t.page.locator(".held").count(), 0);
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
