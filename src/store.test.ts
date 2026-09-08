import { test } from "node:test";
import assert from "node:assert/strict";
import { artworkNames, hydrate, hydrateContent } from "./store.ts";
import { COLORWAYS, FORMATS } from "./brand.ts";
import type { SocialAdContent } from "./templates/socialAd.ts";

const base: SocialAdContent = {
  headline: "base headline",
  body: "base body",
  cta: "base cta",
  buzz: "wave",
  layers: [],
  transforms: {},
  inkOverrides: {},
};

/* A stored design outlives the code that wrote it, and hydrate() runs at
 * startup. Anything it throws on is a tool that will not open. */
test("garbage is treated as no draft, never as an error", () => {
  for (const junk of [null, undefined, 42, "a string", [], true]) {
    assert.equal(hydrate(junk, base), null, `${JSON.stringify(junk)} should not hydrate`);
  }
});

test("missing fields fall back rather than throwing", () => {
  const r = hydrate({}, base)!;
  assert.deepEqual(r.shared, base);
  assert.deepEqual(r.overrides, {});
  assert.equal(r.colorway.key, COLORWAYS[0].key);
  assert.equal(r.format.key, FORMATS[0].key);
  assert.equal(r.ink, "still");
  assert.equal(r.curtain, true);
});

test("a colorway or format that no longer exists falls back", () => {
  const r = hydrate({ colorway: "chartreuse", format: "billboard" }, base)!;
  assert.equal(r.colorway.key, COLORWAYS[0].key);
  assert.equal(r.format.key, FORMATS[0].key);
});

test("an override for a dropped format is discarded, not kept as a ghost", () => {
  const r = hydrate(
    { overrides: { story: { headline: "keep" }, billboard: { headline: "drop" } } },
    base,
  )!;
  assert.deepEqual(Object.keys(r.overrides), ["story"]);
  assert.equal(r.overrides.story.headline, "keep");
});

test("an empty override is not carried, so it cannot dot a format for nothing", () => {
  const r = hydrate({ overrides: { story: {}, post: { nonsense: 1 } } }, base)!;
  assert.deepEqual(r.overrides, {});
});

test("an unknown ink mode falls back to still", () => {
  assert.equal(hydrate({ ink: "disco" }, base)!.ink, "still");
  assert.equal(hydrate({ ink: "live" }, base)!.ink, "live");
});

test("layers are repaired where they can be and dropped where they cannot", () => {
  const c = hydrateContent(
    {
      layers: [
        { kind: "image", id: "a", name: "arrow.svg", src: "library", x: 0.2, y: 0.3, w: 0.4, rotation: 20 },
        { kind: "image", id: "b", name: "star.svg", x: 99, y: -99, w: 0, rotation: "nope", opacity: 5 },
        { kind: "image", id: "", name: "nameless.svg" },
        { kind: "image", name: "no-id.svg" },
        { kind: "hologram", id: "d", name: "future.svg" },
        "not an object",
      ],
    },
    base,
  );
  assert.equal(c.layers.length, 2, "only the two with an id and a name survive");
  assert.deepEqual(c.layers[0], {
    kind: "image",
    id: "a",
    name: "arrow.svg",
    src: "library",
    x: 0.2,
    y: 0.3,
    w: 0.4,
    rotation: 20,
    opacity: 1,
    hidden: false,
    locked: false,
    ink: null,
    flipX: false,
    flipY: false,
  });
  // Clamped back into reach rather than discarded - a layer dragged off the
  // artboard by an older build should come back grabbable, not vanish.
  const b = c.layers[1];
  assert.ok(b.x <= 1.5 && b.y >= -0.5, "position clamped");
  assert.ok(b.kind === "image" && b.w > 0, "a zero width would be invisible and unselectable");
  assert.equal(b.rotation, 0, "a non-numeric rotation falls back");
  assert.equal(b.opacity, 1, "an out-of-range opacity is clamped, not kept");
});

/* A kind this build does not know is DROPPED rather than guessed at. A
 * half-understood layer that draws as something else is worse than one that is
 * gone, because nothing tells you it happened. */
test("an unknown layer kind is dropped", () => {
  const c = hydrateContent({ layers: [{ kind: "video", id: "v", name: "clip.mp4" }] }, base);
  assert.deepEqual(c.layers, []);
});

test("a text layer keeps its type and rejects off-brand values", () => {
  const c = hydrateContent(
    {
      layers: [
        {
          kind: "text",
          id: "t",
          text: "Hello",
          face: "comic-sans",
          color: "#ff00ff",
          align: "justify",
          size: 900,
          w: 0.5,
        },
      ],
    },
    base,
  );
  const t = c.layers[0];
  assert.equal(t.kind, "text");
  if (t.kind !== "text") return;
  assert.equal(t.text, "Hello");
  assert.equal(t.face, "display", "an unknown face falls back rather than failing to draw");
  assert.equal(t.color, "offwhite", "a hex colour is not a palette key, so it is refused");
  assert.equal(t.align, "left");
  assert.ok(t.size <= 1, "a size that would fill the artboard many times over is clamped");
});

test("a shape layer falls back to a known shape", () => {
  const c = hydrateContent(
    { layers: [{ kind: "shape", id: "s", shape: "dodecahedron", fill: "mustard" }] },
    base,
  );
  const s = c.layers[0];
  assert.equal(s.kind, "shape");
  if (s.kind !== "shape") return;
  assert.equal(s.shape, "rect");
  assert.equal(s.fill, "mustard");
});

/* Designs written before layers existed carried `stickers`. They were image
 * layers in all but name, so they are converted rather than dropped: a design
 * saved last quarter still opens. */
test("stickers from an older build become image layers", () => {
  const c = hydrateContent(
    {
      stickers: [
        { id: "a", name: "arrow.svg", x: 0.2, y: 0.3, scale: 0.4, rotation: 20 },
        { id: "", name: "nameless.svg" },
      ],
    },
    base,
  );
  assert.equal(c.layers.length, 1);
  const l = c.layers[0];
  assert.equal(l.kind, "image");
  if (l.kind !== "image") return;
  assert.equal(l.id, "a");
  assert.equal(l.name, "arrow.svg");
  assert.equal(l.w, 0.4, "the old `scale` was this `w` - same short-edge fraction");
  assert.equal(l.rotation, 20);
  assert.equal(l.src, "library");
});

test("layers win over stickers where a design somehow carries both", () => {
  const c = hydrateContent(
    {
      layers: [{ kind: "image", id: "new", name: "new.svg" }],
      stickers: [{ id: "old", name: "old.svg", x: 0.5, y: 0.5, scale: 0.2, rotation: 0 }],
    },
    base,
  );
  assert.equal(c.layers.length, 1);
  assert.equal(c.layers[0].id, "new");
});

test("text fields survive a round trip and non-strings do not overwrite", () => {
  const c = hydrateContent({ headline: "kept", body: 12, cta: null }, base);
  assert.equal(c.headline, "kept");
  assert.equal(c.body, base.body);
  assert.equal(c.cta, base.cta);
});

test("artworkNames collects across shared and every override, without duplicates", () => {
  const img = (id: string, name: string) => ({ kind: "image", id, name, src: "library" });
  const shared = hydrateContent({ layers: [img("1", "arrow.svg")] }, base);
  const overrides = {
    story: hydrateContent({ layers: [img("2", "arrow.svg"), img("3", "star.svg")] }, base),
    post: {},
  };
  assert.deepEqual(
    artworkNames(shared, overrides)
      .map((a) => `${a.src}:${a.name}`)
      .sort(),
    ["library:arrow.svg", "library:star.svg"],
  );
});

test("an upload keeps its source, so the panel can say why it is missing", () => {
  const shared = hydrateContent(
    { layers: [{ kind: "image", id: "u", name: "upload:abc", src: "upload" }] },
    base,
  );
  assert.deepEqual(artworkNames(shared, {}), [{ name: "upload:abc", src: "upload" }]);
});

test("a text or shape layer contributes no artwork name", () => {
  const shared = hydrateContent(
    { layers: [{ kind: "text", id: "t", text: "hi" }, { kind: "shape", id: "s", shape: "rect" }] },
    base,
  );
  assert.deepEqual(artworkNames(shared, {}), []);
});
