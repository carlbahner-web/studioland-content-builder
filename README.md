# StudioLand content builder

Make an on-brand asset in whatever proportion you need, without deciding
anything the brand has already decided. A first template — the social ad — plus
the machinery the rest will share.

```
npm install
npm run dev      # http://localhost:5173
npm test         # the brand rules, the boil, stickers, the store
npm run build    # typecheck + dist/
```

Chrome or Edge. The MP4 export needs WebCodecs and the artwork folder needs the
File System Access API; neither has a fallback and both say so in the UI.

## Where it came from

It was prototyped inside the CRM repo (`carlbahner-web/ss-frontend`, branch
`claude/kit-asset-generator-gobh71`) as a second Vite entry point — `studio.html`
beside the engineer-facing `index.html` — deliberately built so it would lift out
by moving three directories and nothing else. This repo is that lift. The
prototype's commit history is still on that branch, and some comments here still
call the tool "the generator" or "the studio"; same thing.

Two mechanisms existed there only because of the shared repo, and are gone rather
than carried over:

- **The `BUILD_STUDIO` gate** in `vite.config.ts`, which kept this tool out of
  the CRM's production build so it could not appear at a guessable URL on the
  live CRM site. Here it is the whole app, so there is nothing to gate.
- **The `/studio` redirect and the `/studio*` header rules** in `netlify.toml`.
  This site is its own origin now, so the noindex header applies to everything.

`src/` is a flattened copy of the prototype's `src/studio/`. Imports were all
relative already, so nothing had to be rewritten.

## Hosting, and the sign-in that isn't there

**Nothing is deployed today.** For a one-person tool, running it locally is the
honest answer: no hosting, no auth, no cost, and browser-local saves are exactly
right. `netlify.toml` is committed so that connecting this repo is a five-minute
job when hosting is wanted — it is not evidence that it is hosted.

**There is no sign-in.** The prototype was hosted unlisted, which was a
deliberate call about what is actually at risk: the bundle holds no customer
data, no key and no write path, so the worst a finder could do is make a
StudioLand-looking graphic. A login in front of a tool used one-handed from a
phone costs more than that is worth.

If it goes up again, unlisted has to be made real rather than assumed. Not
linking to something is not the same as it being unlisted — a URL gets found,
and then indexed, and then it is in search results forever. So all three are
already in place:

- `index.html` carries `<meta name="robots" content="noindex, nofollow">`.
- `netlify.toml` sends `X-Robots-Tag: noindex, nofollow` for everything. The
  header matters because the JS and the brand images are separately fetchable
  URLs that would otherwise be indexable on their own — the meta tag only covers
  the page that contains them.
- `public/robots.txt` asks crawlers not to fetch any of it.

None of that is a security measure and it is not written as one: a crawler that
ignores `robots.txt` is not stopped by it, and neither is a person with the URL.
It keeps the page out of search results, which is the whole of what "unlisted"
means. If this is ever pointed at a public URL, put something real in front of
it — Netlify password protection, Clerk, or a Cloudflare Access rule.

An earlier version gated it with Clerk against an email allowlist. That is in
the prototype history, under "Host the generator at /studio, gated by Clerk with
an email allowlist", if the judgement ever changes.

The day a second person needs to open a design you made is the day saves have to
move off your machine, and that is a different piece of work from anything built
here.

### One self-contained file

`npm run build:single` bundles the whole tool into a single HTML file with every
asset base64'd in — the same trick `wild-ride`'s arcade uses
(`games/src/build.py` inlines each game into one file). It runs from anywhere
with no server and no network: used for a shareable preview, and it doubles as a
way to hand someone the tool as a file.

`assets.ts` is the one seam that makes it possible. Asset paths go through
`assetUrl()`, which returns the plain `/brand/...` path normally and a data URI
when the single-file build has registered one on `window.__SL_INLINE`.

### Handing over the finished file

`save.ts`, because three environments need three different answers:

- **Desktop, served normally** — a plain `<a download>`, which is what people
  expect.
- **iOS, served normally** — `<a download>` on a blob is unreliable there, so
  the export also shows the image to press and hold, which is the gesture that
  actually works.
- **Inside a claude.ai artifact viewer** — the frame is not permitted to
  download at all and the anchor is silently inert. The viewer grants a
  `downloads` capability instead, which confirms with the person and saves.

The capability is feature-detected, never assumed: the Netlify build has no
`window.claude` and must not care. Press-and-hold is only offered when the
browser path was the one that ran; a confirmed save needs no follow-up.

### On a phone

The layout stacks below 860px with the artboard pinned to the top and the
controls scrolling under it. Two things do not work there, and the tool says so
rather than appearing broken:

- **The artwork folder.** No mobile browser implements the File System Access
  API, so arrows and stars are desktop-only.
- **Your saved designs.** They live in this browser's IndexedDB, which is per
  device. A design saved at the desk is not on the phone. The phone is for
  fresh work; that was the deliberate choice, over standing up a backend to sync
  them.

## How it renders, and why not the DOM

Templates draw to a `<canvas>` at true output pixels. The preview element *is*
the artboard — only its CSS box is scaled — so what you see is what exports, with
no second rendering path to drift out of step.

The obvious alternative is to lay templates out in HTML and rasterise them, which
is roughly what the Kit tool this was modelled on appears to do. Three things
about StudioLand's brand push the other way:

1. **The grain is a multiply composite.** In canvas that is one line. Through
   `foreignObject` rasterisation, `mix-blend-mode` support is inconsistent and
   degrades silently to normal — which the bible measured at a 43% saturation
   loss on teal. A texture bug invisible in the preview but present in the export
   is the worst failure this tool could have.
2. **The boil is an SVG filter.** Filters do not survive `foreignObject`
   rasterisation reliably, and `wild-ride` already has a working canvas boil
   (Recipe B) to copy rather than reinvent.
3. **Animated export means drawing frames.** A canvas renderer already is one.

The cost is that text wrapping, balancing and autofitting had to be written
instead of inherited from CSS. That is most of `render.ts`.

## The rules are data, not guidance

`brand.ts` holds the palette, the sanctioned colorways and the sizes. The point
of the tool is that a teammate cannot make a bad choice, so the bible's rulings
live there as data rather than as something to remember:

- **Grounds are limited** to the four the bible names as dominant, plus brand RED
  for "hot" energy. Mustard, Neon Green and CTA Red can never be grounds.
- **Ink follows the ground.** `inkFor()` returns cream on dark fields — boil trap
  #6, which the game paid for twice: charcoal ink on a charcoal-ish field
  disappears and the boil has nothing to show.
- **Action colors go through `ctaReads()`**, which passes on value **or** hue
  separation. This is not a softening of the value-gap rule; it is a different
  rule for a different job. The value gap governs adjacent flat *fields*, which
  dissolve into each other at equal lightness whatever their hues. A CTA badge is
  a small outlined object, and there hue does the separating. Both of the game's
  measured cases fall out of it correctly — Alert Red on rust fails (it measured
  1.23:1, invisible) and Neon Green on that same rust passes (it popped) — which
  a single threshold of either kind gets wrong in both directions.

`brand.test.ts` locks those two measured cases and checks every shipped colorway
against all of it. If someone later collapses `ctaReads()` to one threshold, the
test says so.

## Layout is zones, not a stack

The first draft let each block size and place itself. It looked right in the
portrait and fell apart elsewhere: the supporting line ran under BUZZ in the
square and under both BUZZ and the starburst in the landscape. Autofitting text
cannot dodge a collision it does not know about, so **BUZZ and the CTA claim
their space first** and the type is fitted into what is left.

Landscape is composed separately rather than scaled from the square — a 1200x630
is a different shape, and stacking a headline over a character in it leaves both
cramped. There the headline takes the left, BUZZ takes the right, and the badge
tucks between them.

## Balanced headlines

`balancedWrap()` is our `text-wrap: balance`. Greedy-wrap to find how few lines
the text needs, then binary-search the narrowest width that still needs only that
many — squeezing the box without adding a line is what pulls the last line up
level with the rest.

It matters more here than on a web page. A headline nudged by hand to kill an
orphan does not survive being reused at another aspect ratio; a balanced one is
recomputed per size, so the same sentence sits on two lines in a square and three
in a landscape with nobody touching it.

## Formats

Named for the **job**, not the ratio: "Instagram portrait", not "1080x1350".
Nobody making a hiring post thinks in pixels; they think about where it goes.
Naming these numerically pushes that translation onto the person using the tool
every single time, which is the sort of small tax the whole thing exists to
remove. The pixel size is still shown, because it matters when an upload form
asks — but as the caption, not the name.

**One at a time.** The stage shows the selected format alone, and export is a
single button on that artboard.

An earlier version made "export every format" the primary action, on the
assumption that producing the whole set at once was the point. It is not, and
building around it made the common case worse. The value is that *any* format is
quick and correct — most of the time you want one, sometimes two. Two formats is
two clicks: switch, save. That does not need a bulk mechanism, and a bulk
mechanism as the headline action buries the thing you actually came to do.

Switching format re-lays out the same content rather than cropping it, so
nothing is stranded or cut off — which is what makes "just switch and save
again" cheap enough that bulk export is unnecessary.

**The layout branches on shape, never on a format's name.** `wide` and
`veryTall` are the only two switches, so adding a format is one line in
`FORMATS` and nothing in the drawing code. The YouTube thumbnail was added that
way and composed correctly first time. For the same reason the wide layout
anchors BUZZ's bleed to a fraction of *his own width* rather than the
artboard's: otherwise a 16:9 thumbnail crops his hand noticeably harder than a
1.9:1 link preview, for no reason anyone chose.

Adding a format is a line in `FORMATS` in `brand.ts`. The list there is a
starting guess at what StudioLand actually posts — change it freely.

### Editing one format vs all of them

Content is a **shared base plus per-format overrides**, and a scope toggle at the
top of the Content section decides which one an edit writes to: "All formats" or
"<this format> only".

The toggle is modal, and modes are where this design can hurt you: a change made
in the wrong scope forks something quietly and you find out days later. That
risk was raised and the toggle chosen anyway, so the effort went into making
divergence impossible to miss rather than into avoiding the mode:

- A **rust dot** on any format in the list that carries its own changes.
- A **"this format only ×"** badge on any field that differs here, which is also
  the button that puts it back.
- The whole toggle turns **rust when you are not in the safe mode**, with a
  banner naming the format the next edit will affect.
- **Reset <format> to shared**, under the format list, for the whole thing.

One rule is built into the write path rather than the UI: **editing in "All
formats" clears that field's overrides everywhere.** Leaving them would mean "all
formats" quietly did not mean all formats — you would type a new headline, see
it apply, and not notice that Story kept the old one. Re-overriding costs one
switch; a change that looked like it applied and did not is unrecoverable,
because you never see it.

Colour, ink and motion stay global. They are properties of the asset, not of a
format, and scoping them would multiply the modes without a use case asking for
it.

### The carousel, later

The one case for showing more than one artboard at once is a carousel, where the
point is seeing the slides against each other. The stage is already a list
rendering one entry, which is the seam that arrives through: several slides of a
single format, side by side, rather than one design at several ratios. Not
built.

## Moving things

**Every element is freely placed: dragged, resized, rotated.** Headline,
supporting line, badge, BUZZ, the wordmark, every sticker. Touch works, which
matters because the phone has nothing else to fall back on.

### The reversal

This used to work the other way, and the earlier reasoning is worth keeping
because it was right for a tool this is not. Elements could only be *nudged* off
a layout that owned their real position, so switching format re-flowed
everything and nothing could be put somewhere daft. That is correct design for
self-service: it is what stops a teammate producing a mess, which is the whole
premise of the Kit tool this was modelled on.

It is the wrong design here. This tool has one user and he is the designer. The
constraint was protecting against a risk that does not exist, while getting in
the way of the work that does — and it was defended twice on the strength of an
argument whose premise had already stopped being true.

So the layout changed job rather than going away. It is now the **default
arrangement**, not the only one:

- An untouched element still composes itself per format — a fresh design and a
  format switch both look right without anyone placing anything.
- **Auto-arrange** puts everything back to what the layout would do here.
- What you move stays where you put it, across formats.

Text can be resized now, which it could not be before. The multiplier scales the
ceiling the autofit works against, so wrapping and balancing still happen; the
text is just allowed to be bigger or smaller than its zone suggested.

Hit regions come from the **last draw**, not a second copy of the layout maths —
recomputing it for hit-testing is how the two silently drift apart. And a drag
records both the grab offset and the current position, so nothing jumps its
centre under your finger and each drag continues from the last.

## Presets

**An arrangement and a look, without the words**: transforms, ink, stickers, the
BUZZ pose, the colourway. Not the headline, supporting line or call to action.

That split is why a preset is a different thing from a saved design. A saved
design is one finished ad you reopen to change the role in a hiring post. A
preset is the layout you liked, dropped onto whatever copy is in front of you.

It is also what makes free placement workable. The layout used to guarantee a
sensible arrangement; presets are how you get one back without hand-placing
every element, and they are the answer to "I want full control, but I do not
want to start from nothing each time."

## Motion

Every artboard also exports a looping MP4. At 1080x1920 that is an Instagram
Reel; the card is badged as one.

### Three states, not a switch

The ink control has the same three states as the line in the CRM
(`src/components/Wobble.tsx`), and for the same reasons:

| | What it is | Use |
|---|---|---|
| **Off** | Straight machine edges, no wonk at all. | Mostly for seeing what the boil contributes. |
| **Still** | The wonk drawn once and held. **The default.** | Every PNG. |
| **Boil** | The three phases cycling at about 8fps. | Video, and the previews. |

**A still is not the boil switched off — it is one phase of it held.** That
distinction is the whole reason a still asset still looks hand-inked, and it was
a bug here at first: stills rendered with the ink off, so the starburst came out
as a perfect geometric star. The bible gives the game's props "~1px of permanent
wonk", and `Wobble.tsx` says it plainly: a hand-drawn line is "just what lines
look like here — the brand, not decoration".

The still holds **phase 1, the middle drawing**, copied from `Wobble.tsx`'s
`STILL_FRAME` and for its reason: going live from the middle phase does not jump
on the first frame. So a PNG and the first frame of the same design's MP4 are
the same picture.

The misregistration behind BUZZ follows the mode for free, because it reads the
same phase the linework does — a fixed offset in Still, cycling in Boil. The
bible draws exactly that line: "static offset for props/stills, boiling offset
for things that are alive."

Previews default to not animating when the machine asks for reduced motion.
Exports still animate: a file is not the UI.

Amplitude is a dial rather than a constant ("gentle on big calm shapes, fuller
on hero elements") and lives in the `BOIL` registry in `boil.ts`. It is not
exposed in the panel yet.

**The boil** is the brand's motion signature — linework redrawn on a three-phase
clock at about 8fps, like cels traced by hand. `boil.ts` is Recipe B copied from
the bible and `wild-ride`'s `boil-canvas.html`, not rewritten. The bible is
blunt about why: "Don't reinvent either boil — a from-scratch attempt working
only from the written rules produced an over-complicated, wrong-looking result;
the code and the numbers are what transfer." The hash constants, the 46-unit
wavelength, the +7.31 phase seed shift and the subdivision thresholds are all
left as found.

The one deliberate change is the **clock**. The original reads
`performance.now()` because it runs in a game. An exporter cannot: the preview
and the MP4 have to be the same animation, and wall-clock timing would make
every export different. So the phase is driven by frame index — 4 frames per
phase at 30fps, a 12-frame cycle, and a 180-frame (6.0s) loop that is a whole
number of cycles, so the wobble lands on the same phase at the loop point
instead of jumping.

What moves, and what deliberately does not:

- **The starburst boils.** It is drawn linework, so it takes Recipe B.
- **Text never boils.** The rule is absolute, so `drawStarburst` puts its label
  through the plain context while the shape goes through the boiled one.
- **BUZZ never warps.** "The artwork itself never warps... the linework IS the
  drawing." He is drawn exactly as painted, and a charcoal silhouette behind him
  carries the motion as cycling print misregistration.
- **The curtain wipe** is the standard transition: few big teeth (many small
  ones read as serration, not a tear), one continuous pull, teeth boiling on the
  same clock. It reveals at the head and covers at the tail *in the same
  direction*, so the last frame is one frame's travel short of the first and the
  loop closes. A wipe that came back the other way would read as a loading bar.

**Encoding** is WebCodecs `VideoEncoder` plus `mp4-muxer`, not MediaRecorder
over `captureStream()`. MediaRecorder records in real time: a slow frame becomes
a dropped frame and the duration drifts from what you asked for. Frame-by-frame
encoding gives exactly N frames at exactly 30fps regardless of machine load.
H.264 is preferred and picked by capability detection; VP9 and AV1 are real
fallbacks, because Chromium builds without proprietary codecs report no `avc1`
support at all and a valid VP9-in-MP4 beats a button that fails.

## Saving

Two things, one record. `store.ts`.

A **draft** is written continuously (debounced) and restored on load, so a
reload costs nothing. That mattered more once a design could carry deliberate
per-format overrides, which are tedious to redo. A **saved design** is the same
record under a name, so you can come back to last quarter's hiring ad and change
the role.

One ordering bug is designed out rather than fixed later: the autosave writer is
gated on the restore having finished. Without that gate the empty initial state
gets written over the draft in the same tick the page opens — the classic way an
autosave feature eats the thing it was added to protect.

**Hydration is defensive throughout**, because a stored design outlives the code
that wrote it and `hydrate()` runs at startup, where a throw is a tool that will
not open with no obvious way back. Rename a colourway, drop a format, and
yesterday's draft references something gone. So: unknown colourway or format
falls back to the first, an override for a dropped format is discarded rather
than kept as a ghost that can never be seen or reset, an unknown ink mode falls
back to still, a sticker missing an id or name is dropped, and one with a wild
position or a zero scale is clamped back into reach rather than discarded — an
off-canvas sticker should come back grabbable, not vanish. Anything unreadable
is treated as "no draft", never as an error. `store.test.ts` covers all of it.

**Artwork is stored by file name, never by content**, matching the library's
handle-not-a-copy rule: a design picks up the current version of an arrow rather
than a snapshot. The cost is that a design restored before the folder is
connected has stickers with nothing behind them, so connecting the folder
re-attaches them, and until then the Artwork panel says how many are waiting.
A file renamed or deleted since keeps its place in the design and simply does
not draw — losing the placement would be worse than a gap.

## Your own artwork

Point the tool at a folder of your own arrows, stars and illustrations and drop
them onto an ad. `library.ts`.

**Nothing is eager.** That was the explicit brief, and it shapes the whole
module:

| When | What is read |
|---|---|
| Page load | Nothing. It checks IndexedDB for a saved folder and offers to reconnect. No directory is listed, no file opened. |
| Reconnect / choose | The listing. `getFile()` returns a lazy `File` — name, size, mtime. Still no bytes. |
| Thumbnail | Decoded once, cached in IndexedDB against size + mtime. Later visits paint the grid without touching the originals. |
| Place a sticker | Only now is the full file read and decoded. |

What is stored is a **handle, not the files**. Edit an arrow in Illustrator, save
it, and the tool sees the new version — there is no second copy to drift out of
sync, and re-saving invalidates its thumbnail on its own because the cache key
carries the mtime.

Persistence is best-effort throughout. If the handle cannot be saved — private
browsing, quota, a browser that will not clone it — the folder still works for
this session; it just has to be picked again next time. An earlier version let
that rejection propagate, which threw away a folder the user had just
successfully chosen.

Chrome and Edge only. That narrows nothing: the MP4 export already needs
WebCodecs. Chrome cannot restore directory permission silently, so a return
visit costs one click. That is the browser's rule, not a shortcut here.

**Placement is relative.** A sticker stores its centre as a fraction of width
and height, and its size as a fraction of the artboard's *short* edge. That is
what lets one placement mean something at all four sizes — an arrow put beside
the headline in the square lands beside the headline in the story. Pixels would
pin it to one aspect ratio and make the other three wrong, undoing the point of
the tool. Sizing against the short edge rather than the width is why a sticker
does not balloon in the landscape.

Stickers draw above the design and **below the grain**, and they take the same
treatment as BUZZ: the art never warps, so the ink edge comes from a
misregistered silhouette behind it.

SVG is fine at any size. Chrome re-rasterises SVG at draw size, so a file with
only a `viewBox` (intrinsic 150px) and one with an explicit 1200px width render
byte-identically — measured, not assumed. An SVG with neither a `viewBox` nor
width/height cannot be sized by the browser at all, and the error says so.

### Where artwork should live

Two libraries, and they want different homes. **Scratch** — the photo for this
one ad, an illustration you are trying out — belongs in the disk folder.
**System** does not: the bible lists "Mustard hand-drawn arrows" as *the*
standard emphasis device, alongside the starburst and the Venn. Once a mark is
brand, it belongs in `public/brand/`, versioned, so a teammate opening this tool
can make the same ad. A mark that only exists on one desktop reopens exactly the
self-service gap this tool was built to close.

## What is not built yet

- **GIF and transparent MOV.** The MP4 path is there; these are separate
  containers. Transparent MOV needs an alpha-capable codec and will likely not
  be a browser-side job.
- **Tier 2 texture.** The whole-sheet weathering plates. `wild-ride` has eight;
  none are copied here yet. Use each sheet whole and fitted, never cropped and
  tiled.
- **Photos.** Upload, focal point, zoom, background removal. Needed before any
  template with a person in it.
- **More templates.** `templates/` takes one file per template; the carousel,
  reel word-cards and the EDU title slide are all specified in bible 3.2.
- **Download all as a zip.** Currently it fires staggered single downloads,
  because browsers drop simultaneous programmatic ones.
- **Hosting.** Still local-only. No auth story yet, which is the main thing to
  settle before anyone else uses it.

## Assets

Everything the templates draw lives in `public/brand/`, documented in the README
there — including that the wordmark is currently keyed from a screenshot and
wants replacing with its real master.
