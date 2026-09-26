/* The reel title builder, walked through the way it is meant to be used: type,
 * check, pick a layout, save, read how to put it on the video, start again.
 *
 * The laptop run is the real one - the title is made on the same Windows laptop
 * the reel is edited on - so it checks the saved file itself: its name, and that
 * it is a full-frame picture with the banner at the top and nothing below. The
 * phone run checks the press-and-hold fallback and that nothing is wider than
 * a small screen.
 */
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { BASE, newPage, stop } from "./harness.ts";
import type { Page } from "playwright";
import { decode } from "../../scripts/lib/png.mjs";

after(stop);

const URL = `${BASE}#/title`;

async function openTool(opts: { phone?: boolean } = {}): Promise<{ page: Page; errors: string[] }> {
  const page = await newPage(opts);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // Start from nothing: a draft from an earlier run would skip the empty state.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#title-text", { timeout: 20_000 });
  await page.waitForFunction(() => document.fonts.check('16px "TAYWingman"'), undefined, {
    timeout: 20_000,
  });
  return { page, errors };
}

const heading = (page: Page) => page.locator(".tb-step h2").innerText();

test("the whole flow on a laptop, down to the saved file", async () => {
  const { page, errors } = await openTool();

  assert.match(await heading(page), /What should your title say/);
  const next = page.getByRole("button", { name: /Next: see how it looks/ });
  assert.equal(await next.isDisabled(), true, "Next is off until something is typed");

  await page.fill("#title-text", "Pet owners: to fence or not to fence?");
  await next.click();
  assert.match(await heading(page), /Here's your title/);

  // More than one way to split it, and picking one changes which is selected.
  const choices = page.locator(".tb-choice");
  assert.ok((await choices.count()) >= 2, "offers other ways to split the lines");
  await choices.nth(1).click();
  assert.equal(await choices.nth(1).getAttribute("aria-pressed"), "true");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Looks good/ }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "Reel title - Pet owners to fence or not to fence.png");
  assert.match(await heading(page), /Saved/);
  assert.match(await page.locator(".tb-filename").innerText(), /Reel title - Pet owners/);

  const file = await download.path();
  const img = decode(await readFile(file!));
  assert.equal(img.w, 1080);
  assert.equal(img.h, 1920);
  const alpha = (x: number, y: number) => img.rgba[(y * img.w + x) * 4 + 3];
  assert.equal(alpha(540, 100), 255, "the banner is solid");
  assert.equal(alpha(540, 1200), 0, "below the banner is see-through");

  await page.getByRole("button", { name: /put it on your video/ }).click();
  assert.match(await heading(page), /Descript/);
  assert.match(await page.locator(".tb-howto").innerText(), /Reel title - Pet owners/);

  await page.getByRole("button", { name: /Make another title/ }).click();
  assert.match(await heading(page), /What should your title say/);
  assert.equal(await page.inputValue("#title-text"), "", "starting again starts empty");

  assert.deepEqual(errors, []);
  await page.close();
});

test("a draft survives closing the page", async () => {
  const { page } = await openTool();
  await page.fill("#title-text", "Open house Sunday");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#title-text");
  assert.equal(await page.inputValue("#title-text"), "Open house Sunday");
  await page.close();
});

test("on a phone: fits the screen, and saving falls back to press-and-hold", async () => {
  const { page, errors } = await openTool({ phone: true });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  assert.ok(await fits(), "step 1 fits");
  await page.fill("#title-text", "Just listed in Lancaster");
  await page.getByRole("button", { name: /Next/ }).click();
  assert.ok(await fits(), "step 2 fits");

  await page.getByRole("button", { name: /Looks good/ }).click();
  await page.waitForSelector(".tb-held", { timeout: 10_000 });
  assert.match(await heading(page), /One more tap/);
  assert.ok(await page.locator(".tb-held").isVisible(), "the picture is there to press and hold");
  assert.ok(await fits(), "step 3 fits");

  assert.deepEqual(errors, []);
  await page.close();
});
