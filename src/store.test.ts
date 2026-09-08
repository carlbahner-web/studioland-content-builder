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
  stickers: [],
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

test("stickers are repaired where they can be and dropped where they cannot", () => {
  const c = hydrateContent(
    {
      stickers: [
        { id: "a", name: "arrow.svg", x: 0.2, y: 0.3, scale: 0.4, rotation: 20 },
        { id: "b", name: "star.svg", x: 99, y: -99, scale: 0, rotation: "nope" },
        { id: "", name: "nameless.svg" },
        { name: "no-id.svg" },
        "not an object",
      ],
    },
    base,
  );
  assert.equal(c.stickers.length, 2, "only the two with an id and a name survive");
  assert.deepEqual(c.stickers[0], {
    id: "a",
    name: "arrow.svg",
    x: 0.2,
    y: 0.3,
    scale: 0.4,
    rotation: 20,
  });
  // Clamped back into reach rather than discarded - an off-canvas sticker
  // should come back grabbable, not vanish.
  const b = c.stickers[1];
  assert.ok(b.x <= 1.5 && b.y >= -0.5, "position clamped");
  assert.ok(b.scale > 0, "a zero scale would be invisible and unselectable");
  assert.equal(b.rotation, 0, "a non-numeric rotation falls back");
});

test("text fields survive a round trip and non-strings do not overwrite", () => {
  const c = hydrateContent({ headline: "kept", body: 12, cta: null }, base);
  assert.equal(c.headline, "kept");
  assert.equal(c.body, base.body);
  assert.equal(c.cta, base.cta);
});

test("artworkNames collects across shared and every override, without duplicates", () => {
  const shared: SocialAdContent = {
    ...base,
    stickers: [{ id: "1", name: "arrow.svg", x: 0.5, y: 0.5, scale: 0.2, rotation: 0 }],
  };
  const overrides = {
    story: {
      stickers: [
        { id: "2", name: "arrow.svg", x: 0.2, y: 0.2, scale: 0.2, rotation: 0 },
        { id: "3", name: "star.svg", x: 0.3, y: 0.3, scale: 0.2, rotation: 0 },
      ],
    },
    post: {},
  };
  assert.deepEqual(artworkNames(shared, overrides).sort(), ["arrow.svg", "star.svg"]);
});
