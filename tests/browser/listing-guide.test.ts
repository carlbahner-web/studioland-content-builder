/* The guided listing post, walked through the way it is meant to be used:
 * which house, the photo, sold or pending, which photo of her, save.
 *
 * The drawing itself is covered by listing.test.ts against the full editor
 * (#/listing/advanced), which draws with the same drawDoc from the same Doc.
 * This spec is about the flow: that each step asks for one thing, won't go on
 * without it, and that what comes out is the right size, has the photo and
 * the badge in it, and carries the right name.
 */
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { BASE, newPage, stop } from "./harness.ts";
import type { Page } from "playwright";
import { decode } from "../../scripts/lib/png.mjs";

after(stop);

const URL = `${BASE}#/listing`;

async function openGuide(opts: { phone?: boolean } = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await newPage(opts);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#post-street", { timeout: 20_000 });
  await page.waitForFunction(() => document.fonts.check('16px "TAYWingman"'), undefined, { timeout: 20_000 });
  return { page, errors };
}

/** A flat, unmistakable colour as the house photo, so it can be found in the file. */
async function choosePhoto(page: Page, hex = "#2fb04a"): Promise<void> {
  const data = await page.evaluate((color) => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1000;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  }, hex);
  await page.setInputFiles(".listing-file", {
    name: "house.png",
    mimeType: "image/png",
    buffer: Buffer.from(data.split(",")[1], "base64"),
  });
  await page.waitForTimeout(400);
}

const heading = (page: Page) => page.locator(".tb-step h2").innerText();
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("the whole flow on a laptop, down to the saved file", async () => {
  const { page, errors } = await openGuide();

  assert.match(await heading(page), /Which house/);
  const next1 = page.getByRole("button", { name: /Next: add the photo/ });
  assert.equal(await next1.isDisabled(), true, "Next is off until there is a street");
  await page.fill("#post-street", "373 Meetinghouse Ln");
  await page.fill("#post-town", "Lancaster, PA 17601");
  await next1.click();

  assert.match(await heading(page), /Add the photo/);
  const next2 = page.getByRole("button", { name: /Next: sold or pending/ });
  assert.equal(await next2.isDisabled(), true, "Next is off until there is a photo");
  await choosePhoto(page);
  // The side is picked while framing the photo, where the arch's overlap shows.
  await page.locator("#side-mirrored").click();
  assert.equal(await page.locator("#side-mirrored").getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Move the photo" }).click();
  await page.getByRole("button", { name: /Bigger/ }).click();
  await page.getByRole("button", { name: /Put it back/ }).click();
  await next2.click();

  assert.match(await heading(page), /Sold or pending/);
  await page.locator("#badge-sold").click();
  assert.equal(await page.locator("#badge-sold").getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: /Next: your photo/ }).click();

  assert.match(await heading(page), /Which photo of you/);
  assert.equal(await page.locator("[id^=you-]").count(), 7, "every headshot is offered");
  await page.locator("#you-sitting").click();
  assert.equal(await page.locator("[id^=side-]").count(), 0, "the side was already chosen with the photo");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Looks good/ }).click(),
  ]);
  assert.match(download.suggestedFilename(), /^[A-Z][a-z]{2}\d{2} listing 373 Meetinghouse\.png$/);
  assert.match(await heading(page), /Saved/);

  const img = decode(await readFile((await download.path())!));
  assert.equal(img.w, 1080);
  assert.equal(img.h, 1350);
  const px = (x: number, y: number) => [...img.rgba.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 3)];
  const [r, g, b] = px(540, 200);
  assert.ok(g > 150 && r < 90 && b < 110, `the house photo fills the top (got ${r},${g},${b})`);

  assert.match(await page.locator(".tb-howto").innerText(), /instagram\.com/);
  await page.getByRole("button", { name: "From my phone" }).click();
  assert.match(await page.locator(".tb-howto").innerText(), /on your phone/);

  await page.getByRole("button", { name: "Make another post" }).click();
  assert.match(await heading(page), /Which house/);
  assert.equal(await page.inputValue("#post-street"), "", "starting again starts empty");

  assert.deepEqual(errors, []);
  await page.close();
});

test("her own words for the sign, and the draft survives a reload", async () => {
  const { page } = await openGuide();
  await page.fill("#post-street", "12 Elm St");
  await page.getByRole("button", { name: /Next: add the photo/ }).click();
  await choosePhoto(page);
  await page.getByRole("button", { name: /Next: sold or pending/ }).click();
  await page.getByRole("button", { name: /Something else/ }).click();
  await page.fill("#post-badge", "JUST LISTED!");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#post-street");
  assert.equal(await page.inputValue("#post-street"), "12 Elm St");
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("listing-post-draft") ?? "{}"));
  assert.equal(kept.badge, "JUST LISTED!");
  await page.close();
});

test("a file that isn't a photo gets a plain message, not an error", async () => {
  const { page, errors } = await openGuide();
  await page.fill("#post-street", "12 Elm St");
  await page.getByRole("button", { name: /Next: add the photo/ }).click();
  await page.setInputFiles(".listing-file", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  await page.waitForSelector(".tb-problem");
  assert.match(await page.locator(".tb-problem").innerText(), /isn't a photo/);
  assert.deepEqual(errors, []);
  await page.close();
});

test("on a phone: every step fits, and saving falls back to press-and-hold", async () => {
  const { page, errors } = await openGuide({ phone: true });
  assert.ok(await fits(page), "step 1 fits");
  await page.fill("#post-street", "373 Meetinghouse Ln");
  await page.getByRole("button", { name: /Next: add the photo/ }).click();
  await choosePhoto(page);
  assert.ok(await fits(page), "step 2 fits");
  await page.getByRole("button", { name: /Next: sold or pending/ }).click();
  assert.ok(await fits(page), "step 3 fits");
  await page.getByRole("button", { name: /Next: your photo/ }).click();
  assert.ok(await fits(page), "step 4 fits");
  await page.getByRole("button", { name: /Looks good/ }).click();
  await page.waitForSelector(".tb-held", { timeout: 10_000 });
  assert.match(await heading(page), /One more tap/);
  assert.ok(await fits(page), "step 5 fits");
  assert.deepEqual(errors, []);
  await page.close();
});
