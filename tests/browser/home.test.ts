/* Angela's home page: the bookmark reminder, and the two ways in.
 *
 * The reminder's whole job is to keep coming back until she says she has
 * bookmarked the page, so that is what gets tested: "Skip for now" is not
 * remembered, "I bookmarked it" is.
 */
import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { BASE, newPage, stop } from "./harness.ts";
import type { Page } from "playwright";

after(stop);

const URL = `${BASE}#/angela`;

async function openHome(fresh = true): Promise<{ page: Page; errors: string[] }> {
  const page = await newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  if (fresh) {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForSelector(".home-cards", { timeout: 20_000 });
  return { page, errors };
}

const reminder = (page: Page) => page.getByRole("dialog", { name: /Bookmark this page/ });

test("the reminder keeps coming back until she says she bookmarked it", async () => {
  const { page, errors } = await openHome();

  assert.ok(await reminder(page).isVisible(), "shows on the first visit");
  assert.match(await page.locator(".home-dialog-how").innerText(), /Ctrl/);

  await page.getByRole("button", { name: "Skip for now" }).click();
  assert.equal(await reminder(page).count(), 0, "skip closes it");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-cards");
  assert.ok(await reminder(page).isVisible(), "and it is back on the next visit");

  await page.getByRole("button", { name: "I bookmarked it" }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".home-cards");
  await page.waitForTimeout(200);
  assert.equal(await reminder(page).count(), 0, "gone for good once she has");

  assert.deepEqual(errors, []);
  await page.close();
});

test("the two cards open the two tools, and each comes back home", async () => {
  const { page, errors } = await openHome();
  await page.getByRole("button", { name: "Skip for now" }).click();

  await page.getByRole("link", { name: /A reel title/ }).click();
  await page.waitForSelector("#title-text", { timeout: 20_000 });
  await page.getByRole("link", { name: /Home/ }).click();
  await page.waitForSelector(".home-cards");

  await page.keyboard.press("Escape"); // the reminder again; Escape is "skip"
  await page.getByRole("link", { name: /A listing post/ }).click();
  await page.waitForSelector("#post-street", { timeout: 20_000 });

  assert.deepEqual(errors, []);
  await page.close();
});
