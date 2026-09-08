# The token and decoration system, reviewed

A read of what `brand.ts`, `boil.ts`, the grain in `render.ts` and the palette
side of `layers.ts` actually do, as against what the README says they do. Every
number below was measured against the shipped constants rather than estimated;
the probes are reproduced so they can be re-run.

Nothing here is a bug report against a broken build. The unit suite is green
(98/98) and the reasoning in the source is unusually good — most of what follows
is a gap between a rule that is written down correctly and a rule that is
*enforced* at the moment it can be broken.

---

## 1. What the system is, in one map

There is no single token registry. There are five, and they do not know about
each other:

| Where | What it holds | Who reads it |
|---|---|---|
| `brand.ts` | `PALETTE`, `TRACKING`, `LEADING_BODY`, `VALUE_GAP`, `HUE_GAP`, `COLORWAYS`, `FORMATS`, `BUZZ_POSES` | the renderer, the starter, the panel |
| `boil.ts` | `BOIL` amplitudes, `FPS`, `FRAMES_PER_PHASE`, the hash/wavelength/phase-shift constants | `drawLayers`, `drawCurtain` |
| `render.ts` | `GRAIN_ALPHA`, `FIRST_BASELINE`, the starburst's own type style | `sheet.ts`, `store.ts`, the panel |
| `layers.ts` | `FACES` (family, tracking, leading), `GRAIN_MODES`, `LAYER_COLORS`, `CROPS`, every `new*()` default | everything |
| `studio.css` | `--cream`, `--charcoal`, `--teal`, and `#bf7538` inline | the tool's own chrome |

That split is defensible — `BOIL` is a motion registry, not a colour one — but
four of the five carry values that also exist in one of the others. Section 5
lists the duplicates.

The **decoration** side is a cleanly separated pipeline, and it is the best-built
thing here: three ink states with a held middle phase, a frame-indexed clock so
the PNG and the MP4's frame 0 are the same picture, a context proxy that boils
any drawing code that only uses `moveTo`/`lineTo`/`arc`, misregistration that
follows the same phase for free, and grain anchored to the artboard so a
per-layer helping reads as the same sheet showing through. The three-way
enforcement of "text never boils" — the panel hides the control (`App.tsx:974`),
`drawLayers` sets amplitude 0 before laying type out, and `drawStarburst` routes
its label through the raw context — is exactly how an absolute rule should be
held.

---

## 2. The load-bearing claim, and how far it actually reaches

> "The point of the tool is that a teammate cannot make a bad choice, so the
> bible's rulings live there as data rather than as something to remember."

This is true of the **catalogue**. `COLORWAYS` is a pre-vetted table and
`brand.test.ts` proves every row legal on ink, accent, CTA, badge ink and
wordmark build. That is real enforcement and it is worth keeping.

It is not true of **composition**. Grep the whole `src/` tree for the functions
that encode the rules:

```
ctaReads      → brand.test.ts only
readsAgainst  → brand.test.ts only
valueGap      → brand.test.ts only
hueGap        → brand.test.ts only
luminance     → brand.test.ts only
inkFor        → sheet.ts:120, once
```

Five of the six rule functions have no production call site. The one that ships
picks the badge ink. So the guarantee holds at the moment a colourway is
*authored* and nowhere at the moment a design is *built*, which is the moment a
teammate is actually making choices. `LAYER_COLORS` is all nine palette entries,
and there is no warning anywhere in the panel — the only `hint bad` elements in
`App.tsx` are the folder error and the custom-size error.

Three concrete consequences follow.

### 2a. Every colour is offered on every ground

Value gap of each offered layer colour against each shipped ground.
`*` marks a pair below `VALUE_GAP` (0.17) — two flat fields that dissolve into
each other.

```
colour        harborTeal       rusty    charcoal    offwhite         red
offwhite          0.826       0.690       0.905       0.000*      0.746
charcoal          0.079*      0.216       0.000*      0.905       0.160*
mustard           0.532       0.395       0.611       0.294       0.452
harborTeal        0.000*      0.136*      0.079*      0.826       0.080*
rusty             0.136*      0.000*      0.216       0.690       0.056*
foggyMint         0.481       0.345       0.560       0.345       0.401
red               0.080*      0.056*      0.160*      0.746       0.000*
neonGreen         0.214       0.077*      0.293       0.612       0.134*
ctaRed            0.135*      0.001*      0.215       0.691       0.055*
```

The most pointed cell is `ctaRed` on `rusty`: 0.001. That is Alert Red on rust —
the 1.23:1 case the panel's own hint cites as the reason Alert Red is withheld
from the warm grounds. It is withheld from the *colourway table*. It is one
click away in the layer swatch row.

Recolouring a starburst by hand reaches these, per ground:

```
harborTeal   illegal-but-offered CTA colours: harborTeal
rusty        illegal-but-offered CTA colours: rusty, red, ctaRed
charcoal     illegal-but-offered CTA colours: charcoal, red
offwhite     illegal-but-offered CTA colours: offwhite
red          illegal-but-offered CTA colours: charcoal, rusty, red, ctaRed
```

### 2b. Changing the colourway does not re-derive anything

`App.tsx:1733` is `commit((d) => ({ ...d, colorway: c.key }))`. It swaps the
ground and leaves every layer holding the palette key it was seeded with. New
layers *are* seeded correctly — `newText({ color: colorway.ink })` at 1102 and
the starburst's `fill: colorway.ctas[0]` at 1110 — so the pairing is honoured
once, at creation, and then frozen.

Seven two-click paths to invisible type:

```
teal     ink (offwhite) on cream    ground: 0.000
rusty    ink (offwhite) on cream    ground: 0.000
charcoal ink (offwhite) on cream    ground: 0.000
cream    ink (charcoal) on teal     ground: 0.079
cream    ink (charcoal) on charcoal ground: 0.000
cream    ink (charcoal) on red      ground: 0.160
red      ink (offwhite) on cream    ground: 0.000
```

Build anything on the default teal colourway, switch to BUZZ Off-White, and the
headline is gone. The panel says "Grounds, ink and action colors are paired for
you" while it is happening.

### 2c. `newShape` defaults ignore the colourway entirely

`layers.ts:255-257` hardcodes `fill: "mustard"`, `stroke: "charcoal"`. Mustard
survives everywhere. The charcoal stroke does not:

```
harborTeal   charcoal stroke 0.079 FAILS
charcoal     charcoal stroke 0.000 FAILS
red          charcoal stroke 0.160 FAILS
```

Three of five grounds. This is precisely boil trap #6 — the trap `inkFor()`
exists to close, sitting one file away from the only place it is called. Add a
rectangle on the charcoal ground and its outline is not faint, it is absent.

**The fix is small and does not need a policy debate.** `inkFor(ground)` already
answers the stroke question; `newShape` needs the colourway passed in the same
way `newText` gets it. The offered-colour question is a genuine design call:
warn-and-allow (a `hint bad` under the swatch row saying what will not read) is
probably right, because "restyle a badge deliberately" is a real thing to want
and hard blocking would make the tool feel arbitrary. What is not defensible is
the current state, where the rule is computed, tested, documented in the UI, and
then not consulted.

---

## 3. The canonical file is a hand copy with nothing checking it

`brand.ts:3-6` names `design-system/tokens/studioland.css` in `wild-ride` as
canonical and says "if something here ever disagrees with that file, this file
is the one that is wrong." There is no import, no generator, no fetch and no
test that compares the two. The nine hex values were typed in once.

`brand.test.ts` locks the *relationships* between them — every colourway is legal
under whatever the values currently are — but not the values. Change `rusty` to
the wrong hex and every assertion still passes, because the ratios move together.

`studio.css` then copies four of them again by hand: `--cream: #fcf7e8`,
`--charcoal: #2c2c2a`, `--teal: #3a6168`, and `#bf7538` inline at four call
sites. Those four currently agree with `PALETTE`. Nothing keeps them agreeing.

Cheapest useful fix, in order of effort: (a) a test asserting the nine literal
hexes, so a change to a brand colour has to be a deliberate edit to a test;
(b) emit the CSS custom properties from `PALETTE` at startup and have
`studio.css` use `var(--sl-rusty)` rather than `#bf7538`; (c) if the two repos
ever sit side by side, a script that diffs `PALETTE` against the canonical file.

---

## 4. The decoration registry contradicts its own rule

`boil.ts:33-34`: "One registry; never inline a number at a call site."

`boil.ts:288`: `setInk(BOIL.curtain * 6, 0);`

`BOIL.curtain` is 0.22. The amplitude the curtain actually draws at is 1.32, and
`0.22` appears in the registry as if it were the value in use. It is the only
one of the four entries multiplied at its call site, and it is the only call
site in the same file as the registry. Either set it to 1.32 and delete the
multiplier, or name what the 6 is.

Related, smaller: `misregOffset`'s phase table (`0.35/0.3`, `0.9/-0.7`,
`-0.6/0.8`) is inline, but that is the recipe rather than a tunable, and
copying it verbatim is the file's whole stated policy. Leave it.

---

## 5. Type tokens are duplicated and partly dead

- `TRACKING.caps` (0.08) has no reader anywhere in `src/`.
- `LEADING_BODY` (1.82) has no reader. The value is re-typed in
  `layers.ts:96` (`lineHeight: 1.82`) and again in `starters/socialAd.ts:190`.
- `FACES` re-types the tracking values rather than referencing `TRACKING`:
  `display` 0.02 and `body` −0.1 happen to match `TRACKING.display` and
  `TRACKING.body` today. `narrow` has no `TRACKING` entry at all, so the
  registry cannot express the face set the app actually offers.
- `drawStarburst` (`render.ts:447`) inlines `tracking: 0.06` for an all-caps
  label. `TRACKING.caps` is 0.08. One of those two numbers is wrong and there is
  no way to tell which from the code.
- Outline weight exists as three separate unnamed constants: `0.055` in
  `drawLayers.ts:205`, a `0.06` default in `drawLines`, and `radius * 0.055` in
  `drawStarburst`.

None of this is currently visible on screen. It is the mechanism by which type
tokens drift later: the registry is not the source, so editing it changes
nothing and the real values are scattered.

Suggested shape: make `FACES` the single type registry (it already carries
family, tracking and leading per face, which is the useful unit), have
`TRACKING`/`LEADING_BODY` either derive from it or go, and give the starburst
label a named face entry rather than an inline style object.

---

## 6. The boil's decorrelation key is dead, so duplicates are pixel-identical

`setInk(amp, key)` takes a second argument whose entire purpose is to
decorrelate the noise field between elements. Every call site passes 0 or omits
it:

```
drawLayers.ts:210  setInk(inked ? BOIL.shape : 0)          // key defaults to 0
drawLayers.ts:218  setInk(inked ? BOIL.starburst : 0)      // key defaults to 0
boil.ts:288        setInk(BOIL.curtain * 6, 0)
```

`inkCtx`'s key function is `K(x, y) = x/S + inkKey + (y/S) * 0.37`, and its
comment calls this "WORLD-STABLE". It is not world-stable in practice, because
`drawLayers` does `translate(cx, cy)` before drawing, so the coordinates
reaching `lineTo` are **layer-local**. With `inkKey` pinned at 0, two identical
shapes anywhere on the artboard receive byte-identical jitter. Verified:

```
two identical shapes at different positions produce identical wobble: true
first 3 points: M-199.1003,-0.6449 L-170.7625,-0.1891 L-143.1363,1.0565
with a per-layer key they differ: true
```

So `Duplicate` on a rule or a badge produces a perfect clone of its hand-drawn
wonk, offset by 3%. That is the one thing the boil exists to prevent — the
README's own framing is that the wobble is "the brand, not decoration", and a
repeated identical wobble reads as a stamp.

The fix is one line at each of the two `drawLayers` call sites: pass a stable
hash of `l.id` as the key. Keying on `l.id` rather than on position matters —
`inkCtx`'s comment already warns that keying on screen position makes the wobble
crawl during a drag, and a layer id is stable across drags, formats and reloads,
so the same design still exports identically every time.

---

## 7. The one file you are forbidden to rewrite has no test

`boil.ts` carries an explicit instruction not to reinvent it: the hash
constants, the 46-unit wavelength, the +7.31 phase shift and the subdivision
thresholds are copied because a from-scratch attempt looked wrong. `boil.test.ts`
covers the *clock* thoroughly — off/still/live, the middle-phase still, the
loop closing on a whole number of cycles — using `misregOffset` as a proxy.

It does not touch `inkCtx`, `vnoise`, `jit`, the three subdivision routines or
`drawCurtain`. The geometry engine — the part that must not change — is the part
with no lock on it. A future refactor that "tidies" the subdivision thresholds
or swaps the cosine interpolation would pass every test in the repo.

The probe in section 6 shows this is cheap to close: `inkCtx` needs nothing but
an object with the six path methods, so a characterization test can record the
emitted points for a known path at a known phase and assert them. That is a
~30-line test that makes the copied numbers genuinely load-bearing. It is the
single highest-value test missing from the suite.

---

## 8. Smaller notes

- **Silhouette cache ignores colour.** `silhouettes` (`render.ts:389`) is keyed
  on the image alone, but `silhouetteOf(img, color)` takes a colour. Today the
  only caller passes `PALETTE.charcoal`, so it is latent — but the first caller
  that wants a cream silhouette on a dark ground will silently get charcoal.
- **The paper slider cannot represent what hydration accepts.** `hydrate`
  clamps `grain` to 0–1 (`store.ts:354`); the range input maxes at 60
  (`App.tsx`). A design carrying 0.8 displays as 60 and is silently rewritten
  to ≤0.6 on the first interaction. Either clamp to 0.6 in `hydrate` or raise
  the slider.
- **`accent` is metadata, not a token in use.** `cw.accent` appears once, as the
  border colour of the colourway chip in the picker. Nothing in the renderer or
  the starter ever colours anything with it, so the "10" of 60/30/10 has no
  production path. Either wire it (a keyword-pop control on a text layer is the
  obvious home) or say in the type that it is a swatch hint.
- **`GRAIN_ALPHA` lives in `render.ts`** while every other brand-measured
  constant lives in `brand.ts`. It is a measured recipe value ("0.2 is the
  game's measured recipe"), so it belongs with the other measured values.

---

## 9. What I would do, in order

1. **`newShape` takes the colourway** and uses `inkFor(ground)` for its default
   stroke. Closes a live invisible-output path on three of five grounds, no
   design decision required. *(small)*
2. **Pass a per-layer key to `setInk`.** Ends identical wobble on duplicates.
   *(one line ×2)*
3. **Characterization test for `inkCtx` and `drawCurtain`.** Locks the copied
   geometry that must not be rewritten. *(small)*
4. **Warn where the rules already know.** A `hint bad` under the layer swatch
   row and on the colourway switch, driven by `readsAgainst` / `ctaReads`, plus
   a re-derive-or-keep prompt when the ground changes. Turns five test-only
   functions into the guarantee the README claims. *(medium; needs a call on
   warn vs. block)*
5. **Assert the nine hexes in a test, and emit the CSS variables from
   `PALETTE`.** Makes "this file is the one that is wrong" checkable rather than
   aspirational. *(small)*
6. **Collapse the type tokens onto `FACES`.** Delete `TRACKING.caps` and
   `LEADING_BODY` or make them the source; name the starburst's label style.
   *(small)*
7. **Fix `BOIL.curtain`** to hold its real amplitude. *(trivial)*

Items 1, 2, 3 and 7 are mechanical and carry no taste question. Item 4 is the
one worth talking through before anyone writes it.
