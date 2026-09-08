# Brand assets for the asset generator

## The STUDIOLAND wordmark

`studioland-wordmark-charcoal.png` — charcoal `#2C2C2A`, transparent ground. For cream
and other light grounds.
`studioland-wordmark-cream.png` — BUZZ Off-White `#fcf7e8`, transparent ground. For
charcoal, Harbor Teal, Rusty Turnstile and other dark or mid-tone grounds.

Both are 939 x 293 px, the same alpha matte filled with two different flat colors.

### How these were made, and why that matters

**These are keyed off a screenshot, not exported from the real master.** Carl supplied a
screenshot of the wordmark on its Softr page (5 Sept 2026) and these were pulled out of
it by `key-wordmark.py`, which is committed here so the process is repeatable and
auditable.

The key builds an **alpha matte from luminance** rather than knocking out white. Every
pixel's color is replaced with a flat brand color and only its opacity comes from the
source, so there is no white fringe when the mark sits on teal or rust — the classic
failure of a naive white-knockout on a JPEG. Antialiased edges keep their softness;
JPEG mosquito noise below 8% opacity is floored to zero and the remainder renormalised
so the ink still reaches full opacity.

Checked at native resolution: the arrow-"I" signpost reads cleanly, with all four dashes
of the post intact. That detail is required by the bible and is the thing most likely to
be lost in a bad key.

### The limitation — read before using at size

939 px wide is enough for a **corner lockup** on any social size we generate (those land
around 200–320 px wide). It is **not** enough for a hero placement, and it is not a
master. It is also a raster, so it cannot be scaled up.

`SL_REF_Visual_Brand_Bible_v5` (Part 1.3) is firm that the wordmark is bespoke hand-drawn
artwork that must always come from the real logo file and must never be retypeset. This
key is a stand-in that respects the artwork but is a generation removed from it.
**Replace it with the true vector or high-resolution master as soon as that file is to
hand**, and delete this note when you do.

### Rules that apply wherever the generator places it

From the bible, Part 1.3 and Part 4:

- **Clear space** at least the height of the "S" on all sides. Nothing crowds it.
- **Minimum size** roughly 140 px wide on screen. Below that the signpost stops reading
  and you use the Circle badge instead — which we do not have yet.
- **Approved grounds:** cream, charcoal, or a single brand color. Never a low-contrast
  field of its own color.
- The bible also specifies a **stroked/outlined build** for busy, photographic or
  mid-tone backgrounds. We do not have it. On those grounds, place the mark on a solid
  patch rather than faking a stroke.
- **Never** stretch, rotate, recolor outside the palette, add effects, or drop the
  arrow-"I". Never rebuild it by typing in a font — it is not typeset in DW Fairfield or
  anything else.
- The arrow-"I" belongs to the logo **only**. It never appears in typed headlines or body
  copy; there you use a normal "I".

## Still missing

- The **stroked/outlined** wordmark build.
- The **STUDIOLAND MGMT** lockup (wordmark + MGMT + the two speaker icons + underline
  swoosh) — the sub-brand mark for engineer-facing and outreach surfaces, which is most
  of what this generator will produce.
- The **WELCOME TO STUDIOLAND** wide lockup, for EDU surfaces.
- The **Circle badge**, needed for small and square placements.

## The press grain

`grain.webp` — the canonical paper tooth, copied from `wild-ride` at
`games/src/assets/noise.webp`. 512 x 512 native.

The bible is blunt about this: **a colored field with no grain is off-brand.**
StudioLand is screen-printed, not flat. Every colored ground the generator renders
gets this over it.

The application recipe is measured, not guessed — every shipped game draws it the
same way and matching the numbers is what makes a surface the same paper stock
rather than a coarser one:

```css
background-image: url(/brand/grain.webp);
background-repeat: repeat;
background-size: 256px 256px;   /* native is 512 — drawn at 256 */
mix-blend-mode: multiply;       /* never normal: normal desaturates, multiply holds hue */
opacity: .2;
```

Multiply matters. It was measured at a 43% saturation loss on teal when applied with
normal blend. Multiply holds hue and only deepens value.

Note this is **Tier 1** only. The bible defines a second tier — whole-sheet weathering
plates multiplied over individual surfaces — and `wild-ride` has eight of them
(`plate-*.webp`). Those are not copied here yet; add them when a template wants that
depth, and use each sheet whole and fitted, never cropped and tiled.

## BUZZ

`buzz-wave.webp` (549 x 560) and `buzz-ride.webp` (499 x 500), copied from
`wild-ride` at `games/src/assets/index-buzz.webp` and `start-buzz.webp`. Both
carry the screen-print distress baked in, so they arrive on-brand.

BUZZ is the hero mascot and the emotional anchor of the loud/MGMT energy, which
is what the social ad is. The bible describes a much larger pose library than
this — it exists as Carl's source art, not as files in either repo. Two poses is
enough to build against, not enough to ship a varied feed.

**Do not** reuse any BUZZ cutout that still sits on chroma-key green: that green
is a production artifact, not a brand color, and the bible calls out cleaning it
before reuse. Neither file here has that problem.

## Type

Both brand faces are now in `public/fonts/`, so the generator can render in the real
type rather than a fallback:

- **DW Fairfield** (`DWFairfield.woff2`) — display and headlines, all-caps. Plus the
  **Narrow** cut (`DWFairfield-Narrow.woff2`), which `wild-ride` does not carry. One
  weight only: design around that, do not fake heavier weights.
- **TAY Wingman** (`TAYWingman.woff2`) — body, captions, casual copy. Copied from
  `wild-ride` at `games/src/assets/taywingman.woff2`.

DW Fairfield is byte-identical in both repos (md5 `8d0a8e28...`), so there is one
canonical file and no drift to reconcile.

`DMSans-latin.woff2` is **not a brand font.** The bible names DM Sans, Space Mono and
Barlow Condensed explicitly as fallbacks that got mistaken for design intent. The CRM
uses DM Sans for its own body copy, which is its existing choice and out of scope here —
but no generated asset should ever render in it.

Tracking is locked by the bible and worth encoding in the templates rather than
eyeballing per layout: body `-0.1em` with line-height ~1.82; uppercase labels `+0.08em`
(up to `+0.15em` on wide captions); DW Fairfield display `+0.02em` to `+0.12em`, wider on
short banners.
