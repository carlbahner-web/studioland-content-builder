/* Draw the link-preview card for Angela's page: public/angela/preview.jpg
 * (1200x630, what a shared link shows) and public/angela/icon.png (180x180,
 * what an iPhone home-screen bookmark shows).
 *
 * Drawn from her own artwork by the tools' own code, not by hand: the navy
 * peony paper the reel titles use, and the listing post's arch with her
 * default headshot in it, exactly as a listing post draws it. So if the
 * artwork, the headshot crops or the default change, re-running this is the
 * whole job:
 *
 *   npm run og
 *
 * It starts the dev server, opens a blank page on it, imports the drawing
 * modules there (Vite serves them straight from src/), and saves the canvases.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 5198;
const BASE = `http://localhost:${PORT}/`;

async function reachable() {
  try {
    return (await fetch(BASE, { signal: AbortSignal.timeout(500) })).ok;
  } catch {
    return false;
  }
}

async function launch() {
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

const server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
try {
  const until = Date.now() + 30_000;
  while (!(await reachable())) {
    if (Date.now() > until) throw new Error("the dev server never came up");
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}angela/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.fonts.check('16px "TAYWingman"'), undefined, { timeout: 20_000 });

  const [card, icon] = await page.evaluate(async () => {
    const load = (src) =>
      new Promise((ok, fail) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => fail(new Error(`could not load ${src}`));
        img.src = src;
      });
    const draw = await import("/src/listing/draw.ts");
    const tpl = await import("/src/listing/template.ts");
    const doc = await import("/src/listing/doc.ts");
    const guide = await import("/src/listing/guide.ts");
    const title = await import("/src/title/draw.ts");
    const titleTpl = await import("/src/title/template.ts");

    // Everything a listing post needs, loaded the way the tools load it.
    const art = {};
    for (const name of Object.keys(draw.LAYER_BOXES)) art[name] = await load(`/listing/${name}.png`);
    for (const f of tpl.PHOTO_FILES) art[f] = await load(f);
    for (const h of tpl.HEADSHOTS) if (h.photo) art[h.key] = await load(h.photo.file);

    // A listing post with no house photo and no words - just the frame and her
    // default headshot - from which the arch is cut.
    const layout = tpl.layoutFor("standard");
    const post = document.createElement("canvas");
    post.width = tpl.CANVAS.w;
    post.height = tpl.CANVAS.h;
    const d = doc.emptyDoc();
    d.headshot = guide.DEFAULT_HEADSHOT;
    d.blocks = [];
    draw.drawDoc(post.getContext("2d"), d, art, null);

    // The arch alone: the post's pixels inside the arch's own mask.
    const a = layout.arch;
    const arch = document.createElement("canvas");
    arch.width = a.w;
    arch.height = a.h;
    const ac = arch.getContext("2d");
    ac.drawImage(post, a.x, a.y, a.w, a.h, 0, 0, a.w, a.h);
    ac.globalCompositeOperation = "destination-in";
    ac.drawImage(art[layout.mask], 0, 0, a.w, a.h);

    const paper = title.makePaper(await load("/listing/frame.png"));
    const navy = titleTpl.BANNER_NAVY;
    const ink = titleTpl.TYPE_INK;

    function background(ctx, w, h) {
      ctx.fillStyle = navy;
      ctx.fillRect(0, 0, w, h);
      const pattern = ctx.createPattern(paper, "repeat");
      pattern.setTransform(new DOMMatrix().scaleSelf(1.1, 1.1));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
    function setType(ctx, size, tracking) {
      ctx.font = `${size}px "TAYWingman", sans-serif`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${tracking * size}px`;
    }

    /* The card: arch on the left standing on the bottom edge, the name to the
     * right in her type, and the line from her listing posts underneath. */
    const W = 1200;
    const H = 630;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    background(ctx, W, H);

    const archH = 560;
    const archW = (a.w / a.h) * archH;
    const archX = 70;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 30;
    ctx.drawImage(arch, archX, H - archH, archW, archH);
    ctx.restore();

    const textX = archX + archW + 70;
    const textW = W - textX - 70;
    ctx.fillStyle = ink;
    ctx.textBaseline = "alphabetic";
    // As big as fits the column, the same way the reel titles are sized.
    let size = 110;
    setType(ctx, size, -0.02);
    const lines = ["ANGELA'S", "POST", "BUILDER"];
    while (Math.max(...lines.map((l) => ctx.measureText(l).width)) > textW && size > 40) {
      size -= 2;
      setType(ctx, size, -0.02);
    }
    let y = 190;
    for (const l of lines) {
      ctx.fillText(l, textX, y);
      y += size * 1.02;
    }
    setType(ctx, 30, 0.02);
    ctx.globalAlpha = 0.85;
    ctx.fillText("Listing posts & reel titles,", textX, y + 26);
    ctx.fillText("one step at a time", textX, y + 64);
    ctx.globalAlpha = 1;

    /* The icon: the arch alone on the paper, for a home-screen bookmark. */
    const I = 180;
    const ic = document.createElement("canvas");
    ic.width = I;
    ic.height = I;
    const ictx = ic.getContext("2d");
    background(ictx, I, I);
    const iH = 160;
    const iW = (a.w / a.h) * iH;
    ictx.drawImage(arch, (I - iW) / 2, I - iH, iW, iH);

    /* A JPEG for the card: it has no transparency to keep, and messaging apps
     * quietly drop previews much over ~300KB - WhatsApp first - which the PNG,
     * at 1.5MB, was well past. */
    return [c.toDataURL("image/jpeg", 0.86), ic.toDataURL("image/png")];
  });

  await mkdir(path.join(ROOT, "public/angela"), { recursive: true });
  for (const [name, url] of [["preview.jpg", card], ["icon.png", icon]]) {
    const out = path.join(ROOT, "public/angela", name);
    await writeFile(out, Buffer.from(url.split(",")[1], "base64"));
    console.log(`wrote ${path.relative(ROOT, out)}`);
  }
  await browser.close();
} finally {
  server.kill();
}
