/* Driving the real tool in a real browser.
 *
 * WHY THIS EXISTS. The unit tests cover the pure logic - the boil, the palette
 * rules, the cover maths, the cutout mask, hydration - and they are worth
 * having. But every bug that actually shipped this far was one they structurally
 * could not catch:
 *
 *   - a selection box drawn in a colour that is invisible on the ground it sits
 *     on, which only a screenshot shows;
 *   - a rule whose own resize handles swallowed its entire body, so the most
 *     common shape in the tool could not be dragged at all;
 *   - uploads that silently drew nothing, because a lookup key and a display
 *     label had been conflated in a field that worked for folder images;
 *   - cmd-A sitting below the "nothing is selected" guard, so select-all could
 *     never run from an empty selection;
 *   - an undo tag keyed on the element rather than the gesture, so a group drag
 *     recorded dozens of steps.
 *
 * Not one of those is a wrong return value. They are all "the thing on the
 * screen does not do what it says", and the only way to catch them is to open
 * the thing and press it. So the checks that found them live here now, as
 * assertions rather than as scripts someone reads the output of.
 *
 * These tests are SLOW compared to the unit tests, by a lot, and that is fine:
 * they are a separate `npm run test:browser` rather than part of `npm test`, so
 * the fast suite stays fast and this one runs when the editor is touched.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";

const PORT = 5199;
export const BASE = `http://localhost:${PORT}/`;

let server: ChildProcess | null = null;
let browser: Browser | null = null;

/* Playwright resolves its own browser download, which is right on a machine
 * where `npx playwright install chromium` has been run. Where the browsers live
 * somewhere else and do not match the revision this Playwright wants - a
 * pre-baked image, a shared cache - the default launch throws, so fall back to
 * whatever chromium IS on disk rather than failing the suite over a path. */
async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (err) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) throw err;
    const dir = readdirSync(root).find((d) => d.startsWith("chromium-"));
    if (!dir) throw err;
    return chromium.launch({ executablePath: `${root}/${dir}/chrome-linux/chrome` });
  }
}

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start the dev server and the browser. Called once, by the first spec to need them. */
export async function start(): Promise<void> {
  if (browser) return;
  if (!(await reachable())) {
    server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
      stdio: "ignore",
      detached: false,
    });
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      if (await reachable()) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!(await reachable())) throw new Error(`the dev server never came up on ${BASE}`);
  }
  browser = await launch();
}

export async function stop(): Promise<void> {
  await browser?.close();
  browser = null;
  server?.kill();
  server = null;
}

export type Editor = {
  page: Page;
  /** Every console error and uncaught exception seen so far. */
  errors: string[];
  close: () => Promise<void>;
  /** How many layers the panel is listing. */
  layers: () => Promise<number>;
  /** The names in the layers list, topmost first. */
  layerNames: () => Promise<string[]>;
  /** The selected element's size and position readout, or null. */
  readout: () => Promise<string | null>;
  /** The heading of the selection inspector. */
  selection: () => Promise<string>;
  /** A point on the artboard, from fractions of it. */
  at: (fx: number, fy: number) => { x: number; y: number };
  /** Open one of the panel's folded sections. */
  section: (title: string) => Promise<void>;
  /** Sample one pixel of the real artboard canvas - the thing that exports. */
  pixel: (x: number, y: number) => Promise<number[]>;
  reload: () => Promise<void>;
};

/* A fresh editor with empty storage, unless `keepStorage` says otherwise.
 *
 * Clearing IndexedDB between specs is not tidiness, it is the difference between
 * a suite that tests the tool and one that tests whatever the last spec left
 * behind - drafts, saved designs, uploads and the starred starting point all
 * live there. */
export async function open(opts: { keepStorage?: boolean } = {}): Promise<Editor> {
  await start();
  const page = await browser!.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  const settle = async () => {
    await page.waitForSelector("canvas.chrome");
    // The brand fonts and artwork load before anything can be composed, and the
    // blank start is seeded once they have.
    await page.waitForFunction(
      () => !document.querySelector(".boot-msg"),
      undefined,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(900);
  };

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  if (!opts.keepStorage) {
    await page.evaluate(() => indexedDB.deleteDatabase("studioland-studio"));
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await settle();

  const box = (await page.locator("canvas.chrome").boundingBox())!;

  return {
    page,
    errors,
    close: () => page.close(),
    layers: () => page.locator(".layers li").count(),
    layerNames: () => page.locator(".layers li .open strong").allTextContents(),
    /* The whole sentence, not a prefix of it. Splitting on the first "." looks
       fine until a percentage has a decimal in it, and then "at 20.5%" becomes
       "at 20" and the caller silently reads the wrong number. */
    readout: async () => {
      const el = page.locator(".panel .hint").filter({ hasText: "px at" }).first();
      return (await el.count()) ? ((await el.textContent()) ?? "") : null;
    },
    selection: async () =>
      ((await page.locator(".panel h2").nth(1).textContent()) ?? "").replace("done", "").trim(),
    at: (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy }),
    section: async (title) => {
      const summary = page.locator(".sect > summary", { hasText: title }).first();
      const open = await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open);
      if (!open) await summary.click();
      await page.waitForTimeout(200);
    },
    pixel: (x, y) =>
      page.evaluate(
        ([px, py]) => {
          const c = document.querySelector(".board canvas") as HTMLCanvasElement;
          return [...c.getContext("2d")!.getImageData(px, py, 1, 1).data];
        },
        [Math.round(x), Math.round(y)],
      ),
    reload: async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await settle();
    },
  };
}

/** Drag from one artboard point to another, in steps so every move is seen. */
export async function drag(
  ed: Editor,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { modifiers?: string[] } = {},
): Promise<void> {
  for (const m of opts.modifiers ?? []) await ed.page.keyboard.down(m);
  await ed.page.mouse.move(from.x, from.y);
  await ed.page.mouse.down();
  await ed.page.mouse.move(to.x, to.y, { steps: 8 });
  await ed.page.mouse.up();
  for (const m of opts.modifiers ?? []) await ed.page.keyboard.up(m);
  await ed.page.waitForTimeout(250);
}

/* page.mouse.click() takes no `modifiers` - that is locator.click() - and
 * passing them there is silently ignored, which cost an hour once. */
export async function clickAt(
  ed: Editor,
  pt: { x: number; y: number },
  opts: { shift?: boolean } = {},
): Promise<void> {
  if (opts.shift) await ed.page.keyboard.down("Shift");
  await ed.page.mouse.click(pt.x, pt.y);
  if (opts.shift) await ed.page.keyboard.up("Shift");
  await ed.page.waitForTimeout(250);
}

/** Add a layer from the Add row. */
export async function add(ed: Editor, label: string): Promise<void> {
  await ed.page.getByRole("button", { name: label, exact: true }).first().click();
  await ed.page.waitForTimeout(300);
}

/** Select a layer by what the layers list calls it. */
export async function pick(ed: Editor, name: string): Promise<void> {
  await ed.page.locator(".layers li").filter({ hasText: name }).first().locator(".open").click();
  await ed.page.waitForTimeout(250);
}

/** Read a slider in the panel by its label. */
export function slider(ed: Editor, label: string) {
  return ed.page.locator(`.panel label:has-text("${label}") input`).first();
}
