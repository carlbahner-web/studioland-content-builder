# StudioLand content builder

Make an on-brand asset in whatever proportion you need, without deciding
anything the brand has already decided — and then keep going, because a template
that composes the first ninety percent is no use if the last ten is impossible.
A first template — the social ad — a layer editor over it, and the machinery the
rest will share.

```
npm install
npm run dev      # http://localhost:5173
npm test         # the brand rules, the boil, layers, history, snapping, the store
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
  API, so a connected folder of arrows and stars is desktop-only. *Uploading* an
  image works everywhere, which is most of what the folder was wanted for on a
  phone anyway.
- **Your saved designs.** They live in this browser's IndexedDB, which is per
  device. A design saved at the desk is not on the phone, and neither are its
  uploads. The phone is for fresh work; that was the deliberate choice, over
  standing up a backend to sync them.

Everything else does work there, including the editor: dragging, the resize and
rotate handles and snapping are all pointer events, so they take touch without
anything extra.

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

## Two things on one artboard

A design is **the template plus a list of layers**, and the split is the load-bearing
idea in the whole tool.

The **template** owns five named elements — headline, supporting line, CTA badge,
BUZZ, wordmark — and composes them per format. That is what makes a new asset
on-brand in one second and what makes switching format re-lay out rather than
crop. It is worth keeping and it was kept.

**Layers** are what you add: text boxes, rules, rectangles, ellipses, the brand's
own starburst, and images. They sit over whatever the template composed, in the
order you stacked them, under the grain. They are the answer to everything the
five slots cannot express — a second block of copy, a rule under a word, three
photos in a row — and without them the tool could produce one shape of thing
very well and nothing else at all.

The two are stored differently and it matters. A template element carries a
*scale multiplier* against whatever the layout chose for this format, so an
untouched one still composes itself and a nudged one keeps its nudge. A layer
carries its size outright, because nothing ever chose one for it. Everywhere
else that difference is invisible: `Manipulator` in `Artboard.tsx` is the single
place the two are translated, so selection, dragging, handles, snapping, undo
and the keyboard are written once and work on both.

Layers are constrained exactly where the brand is:

- **Colour is a palette key, never a hex string.** A free-text colour field is
  precisely how an off-brand choice gets made. The offered set is in
  `LAYER_COLORS`, so the swatch row and the hydrator cannot drift apart.
- **The faces are the three brand faces.** There is no font menu.
- **Text never boils, drawn shapes do.** Both are rules rather than defaults, so
  a text layer has no ink control at all instead of one that does nothing, and a
  rectangle takes Recipe B through the same context proxy the starburst uses —
  which is also why `rectPath` and `ellipsePath` are built from `moveTo`,
  `lineTo` and `arc` rather than from the canvas's own `roundRect` and
  `ellipse`. The boil proxy overrides those three calls and nothing else, so a
  shape drawn the convenient way would come out machine-perfect while everything
  beside it wobbled.
- **Artwork never warps.** An image layer is drawn exactly as painted with a
  misregistered silhouette behind it — the treatment BUZZ gets, for his reason.

### The artboard is two canvases

The lower one is the real 1080px artboard: the thing that exports, with nothing
on it that is not in the design. The upper one is chrome — the selection box, the
handles, the snap guides — and it never touches the export path.

The obvious alternative is one canvas that draws the chrome and clears it before
exporting. That is a trap: the export would depend on the editor having tidied
up after itself, and the first time it did not you would ship a PNG with a
selection rectangle on it. Two surfaces makes that impossible rather than
unlikely.

Two details on the overlay are worth keeping:

- **Handles are sized in screen pixels**, not artboard pixels. A 1080px board
  shown at 380px would otherwise draw a 10px handle at 3.5px, which is not
  grabbable with a finger and barely with a mouse. The overlay is sized to its
  displayed box times the device pixel ratio and artboard coordinates are scaled
  into it, which also means the handles come out crisp rather than resampled.
- **The selection box is stroked twice, cream under charcoal.** Every colour in
  this palette is also a ground, so a single-colour selection box is invisible on
  the colourway that happens to match it. A light halo under a dark line reads on
  all five. This was a real bug, found by looking at a teal box on the teal
  colourway.

Hit regions still come from the **last draw** rather than a second copy of the
layout maths, which is the rule the template already followed and the reason the
overlay effect is declared after the drawing effect: effects run in declaration
order, so the handles are placed on regions the draw has just produced.

### Undo

Free placement without undo is a trap, and it was one here: the only way back
from a drag you did not mean was Auto-arrange, which throws away every position
in the design to fix one of them.

`history.ts` holds the whole document. The interesting part is **coalescing**: a
drag emits a state change per pointer move and typing emits one per keystroke,
so recorded literally, one dragged layer is two hundred undo steps and cmd-Z
stops meaning anything. Each push carries a tag naming the kind of edit —
`drag:L4f`, `text:headline` — and consecutive pushes with the same tag inside
700ms replace each other. One drag is one undo; a sentence typed without pausing
is one undo. An untagged push never coalesces, so adding a layer or applying a
preset is always its own step.

Two smaller rulings:

- **Loading a design resets the stack rather than appending to it.** The states
  before it belong to a different document, and undoing into them would take you
  out of the design you just opened with no way to tell what happened.
- **The format is not in the document.** It is which view you are looking at, not
  something about the design. Putting it in would mean cmd-Z sometimes switched
  format instead of taking back your edit, which is how people learn not to trust
  undo. It is still saved with the draft, so reopening puts you back where you
  were.

While the caret is in a text field the editor's shortcuts stay out of the way
entirely: there, cmd-Z should take back the word you typed, not the layer you
added five minutes ago.

### Snapping

Placing by eye at preview scale is placing by eye at a quarter size — a headline
centred on a 270px preview can be four artboard pixels out in the export, which
is invisible until it is printed. So a dragged element snaps to the artboard's
centre lines, its margin and its edges, and to the edges and centres of
everything else placed, with a guide drawn to say which. Alt overrides it.

Each axis resolves independently, so a box can align its left edge to a
neighbour while its centre takes the artboard's middle — which is the case that
makes snapping worth having rather than merely tidy. A **rotated** box passes no
extent and snaps only its centre: its axis-aligned bounds are no longer its
edges, so snapping them would align something that is not there.

### More than one at a time

Shift-click to add or remove, sweep a marquee across empty artboard, or cmd-A
for everything. The selection moves, nudges, aligns, distributes, duplicates and
deletes as one thing, and a group duplicate or delete is **one undo step**, not
one per element.

- A group move applies **one delta** computed from every element's position at
  grab time, rather than each element tracking the pointer. The group keeps its
  internal spacing exactly, and one snap decision applies to all of it instead of
  each element being pulled to a different guide. The snap is measured against
  the selection's bounds *at grab time* — using the current bounds counts the
  drag twice and asks the snapper about a position twice as far out as the
  pointer actually is.
- **Handles belong to a lone selection.** Resizing or rotating several things at
  once has to decide what it means — about the group's centre, or about each
  element's own? — and getting that wrong silently scatters a layout. Moving and
  aligning are what multi-select is for.
- **Align targets the artboard for one element and the selection's own bounds for
  several.** That is the convention every design tool uses and the only useful
  one: aligning six things to the artboard's left margin stacks them on top of
  each other. Spacing is by *centre* rather than by gap, because gap-spacing
  surprises you the moment the things are different sizes — three items of
  different widths, evenly gapped, have centres that are not evenly spaced, and
  the centres are usually what the eye was asking about.

### Resizing a selection

The group gets corner handles and a rotate stalk. Scaling grows the
**arrangement**: every element's position scales about the group's centre as
well as its size, so the spacing between things grows with the things instead of
everything piling into the middle. Rotating turns each element on its own axis
and orbits it around the centre.

**Corners only**, and that is the ruling rather than the omission it looks like.
A uniform scale about the centre is unambiguous — the arrangement grows and
everything keeps its proportions — while a side handle on a group would have to
mean stretching text and photographs out of shape, which is never what "make
these bigger" meant.

The undo tag identifies the **gesture**, not the element, and that was a bug
worth recording: undo folds consecutive edits carrying the same tag, so tagging
by element works for a single drag and falls apart the moment a drag touches
more than one. Two elements moving together emit `drag:A`, `drag:B`, `drag:A`, …
and because each push differs from the one before it, none of them fold — a
two-element move was recording dozens of undo steps, so taking it back meant
holding cmd-Z. One tag per gesture makes any drag one step, however many things
it moves.

### Handles need room

A handle only appears on an axis with space for both it and a grabbable
interior. This was a bug, and a bad one: a rule is 540×21 artboard pixels, its
top and bottom handles sit 10 pixels from its centre, and the grab radius is
about 24 — so the entire body of the rule was inside its own handles, every
press started a resize, and **the most common shape in the tool could not be
dragged at all**. Below the threshold the press means move, which is the more
common intent, and the size is still adjustable from the panel and from the axis
that does have room.

### The keyboard

Arrow keys nudge by one artboard pixel and shift by ten — artboard pixels rather
than screen ones, so the same keypress means the same thing whatever the preview
is scaled to. cmd-D duplicates, delete removes, escape deselects, cmd-[ and
cmd-] restack, and shift with either sends a layer to the very back or front.

cmd-A selects everything, and it deliberately sits *above* the "nothing is
selected" guard — an empty selection is exactly the state you press it in, which
it did not do at first.

Only layers are deletable. The template's five are part of the composition; the
way to be rid of one is to empty its text.

### Typing on the artboard

Double-click a text layer and the caret opens where the letters are, in that
layer's own face, size, colour, caps and alignment.

It is a **real `<textarea>`**, laid over the artboard and styled from the same
numbers the canvas draws with. Selection, the system keyboard, autocorrect, IME
composition, spellcheck and every accessibility affordance come free that way,
and every one would have had to be reimplemented badly on a canvas-drawn caret.
The layer itself is left undrawn while it is being typed into — a `hide` render
option only the preview ever sets — so the caret and the canvas copy are never
both on screen.

Making "what you type is where it lands" actually true took three fixes, each a
place where canvas and CSS quietly disagree:

- **The baseline.** Canvas puts the first baseline 78% of the way down its line
  box; CSS splits the leading evenly around the glyphs. On the display face
  those land within a pixel of each other; on the body face's 1.82 leading they
  are a quarter of an em apart, and the text visibly hopped the moment you
  stopped typing. The shift is measured from the font's own metrics rather than
  assumed, and the 78% is one exported constant so the two cannot drift.
- **What is centred.** The canvas centres the *ink* — the width the letters
  actually run to, which is what makes a selection box hug a short centred line
  instead of a stretch of empty artboard. A textarea can only centre its box. So
  the box is placed to put its text where the canvas puts it, while keeping the
  full measure width so the wrap still breaks in the same places.
- **Who owns the height.** Measuring the content means letting the height go
  `auto` and reading `scrollHeight`, which is a DOM write React knows nothing
  about. Sharing the property does not work: React only writes when the value it
  last rendered changed, so once the measured height settles it stops writing and
  the `auto` left over from measuring is what sticks — the box stayed two lines
  tall however much you typed. The layout effect owns the whole geometry; React
  owns the typography.

The caret is offered **only where it can be honest**. The template's headline and
supporting line are fitted to a zone, so their size changes as you type; a caret
there would need the autofit re-run per keystroke to stay on the letters, and
would still jump every time the fit stepped. Those keep the panel field, which
does not pretend otherwise.

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
starting guess at what StudioLand actually posts — change it freely. You can
also **add a size in the tool**, which is the same thing without editing a
source file mid-design because a client asked for a 4:5 at 1440.

Custom sizes live *outside* the document, in their own key, because a size is a
fact about where you post rather than about one asset: adding "LinkedIn banner"
once should make it available to every design, including the ones already saved.

The consequence to be careful about is `hydrate()`. It drops overrides for
formats it does not recognise — deliberately, so a dropped format cannot leave a
ghost that can never be seen or reset — which means a custom size has to be
**known before** a design that uses it is hydrated, or its per-format work is
silently thrown away. So `hydrate` takes the format list rather than reaching for
the constant, and the sizes are loaded before the draft is read.
`formats.test.ts` locks that down.

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
supporting line, badge, BUZZ, the wordmark, and every layer you add. Touch works,
which matters because the phone has nothing else to fall back on. The handles,
the keyboard and undo that make this workable are described under *Two things on
one artboard*; what follows is why free placement is the right design here at
all, which was not obvious and was got wrong first.

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
centre under your finger and each drag continues from the last. A handle drag
records the element as it was at *grab time* and measures from there rather than
from the last frame, so a long resize does not compound rounding error.

The one constraint that survived the reversal is the **wordmark's minimum size**
— the bible sets one "so the arrow-I signpost stops reading". It is enforced in
the write path rather than on the slider, because a corner handle is now a second
way to get below it, and a limit only one of two paths respects is not a limit.

## Presets

**An arrangement and a look, without the words**: transforms, ink, layers, the
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

## Paper, and who gets it

The grain is a **multiply over the whole field**, and for a long time that was
all it was: one pass at a hard-coded 0.2, over everything, at the end. It is now
a dial, and any layer can take more of it or none of it.

The reason it took a ruling rather than a checkbox: **the grain is the paper.**
It sits over everything because the whole artboard is one printed object, and
grain on one element but not another says "this bit was printed and that bit was
not", which is incoherent as a physical metaphor. Per-element texture is how you
get something that reads as a sticker.

**What resolves it is anchoring.** The pattern is filled from the artboard's
origin at identity in every pass, never from the element's. So turning grain on
for one photograph clips *the sheet's own texture* to that shape — the run of it
lines up seamlessly with the paper on the ground beside it, because it is the
same paper showing through. You are choosing what got printed, not printing
things separately. Anchoring to the element would break the texture at every
edge, and the eye reads that instantly even when it cannot say why.

That is a testable claim rather than a hope, and it was tested: nudge an element
seven pixels under a patch of its own grain and the patch does not change,
because the paper never moved.

Three states per layer, mirroring the ink control for the same reason — a global
default with a per-element override:

| | What it is | Use |
|---|---|---|
| **Default** | The sheet's grain, like everything else. | Almost everything. |
| **None** | Stays crisp. | A logo, a QR code, a screenshot — things being *reproduced* rather than printed. |
| **Extra** | A second helping of the same sheet. | A stock photograph that is far too clean to sit beside boiled linework. |

Both exceptions are drawn after the sheet's pass, and the implementations are
chosen to be exact rather than approximately right:

- **None re-draws the layer on top of the grain**, using the same drawing code
  with the same inputs, so the pixels land identically. The obvious alternative
   — excluding the element's bounding box from the grain — would have taken the
  paper off the *ground around it* too, leaving a clean rectangle in the middle
  of a printed sheet, and would have been wrong for anything rotated, cut out, or
  shaped like a letterform.
- **Extra takes the layer's real alpha as a mask** rather than its box, so a
  cut-out subject gets more paper on the subject and none on the space around it.

## Transparency, and what a browser will not do

**Save PNG can leave the ground unpainted**, so the file carries real alpha —
for dropping an asset onto someone else's slide or onto a photograph. The
colourway still picks the ink, because choosing one is still saying what the
asset is *for*; you are only declining to paint the field behind it.

The grain is the interesting part. Multiply against a transparent pixel does not
leave it transparent — there is nothing to multiply with, so the grain lands as
flat grey and the hole comes out as a dirty rectangle. So with no ground, the
alpha the canvas had *before* the grain is taken as a copy and re-applied after,
which keeps the texture on the artwork and off the hole. It costs one
full-canvas copy, which is why it is only paid when there is a hole to protect.

The preview puts a **checkerboard behind the artboard**, because the artboard is
genuinely see-through now; without it a transparent asset reads as a cream one
against the cream panel and you find out when you drop it on something dark.

**MP4 is never transparent**, whatever the design says, and the export paints the
ground back in rather than shipping a black rectangle. This is measured, not
assumed: `VideoEncoder.isConfigSupported` rejects `alpha: "keep"` for VP8, VP9
*and* AV1 in current Chromium, so there is no browser-side path to an alpha video
at all. Getting one means a PNG sequence and ffmpeg — a different tool, honestly
outside this one. The panel says so where the option is offered.

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
back to still, a layer missing an id or an unrecognised kind is dropped, and one
with a wild position or a zero size is clamped back into reach rather than
discarded — a layer dragged off the artboard by an older build should come back
grabbable, not vanish. An unknown *kind* is dropped rather than guessed at: a
half-understood layer that draws as something else is worse than one that is
gone, because nothing tells you it happened. Designs written before layers
existed carried `stickers`, which were image layers in all but name — same
relative placement, same short-edge sizing — so they are migrated rather than
dropped, and last quarter's hiring ad still opens. Anything unreadable
is treated as "no draft", never as an error. `store.test.ts` covers all of it.

**Folder artwork is stored by file name, never by content**, matching the
library's handle-not-a-copy rule: a design picks up the current version of an arrow rather
than a snapshot. The cost is that a design restored before the folder is
connected has layers with nothing behind them, so connecting the folder
re-attaches them, and until then the Artwork panel says how many are waiting.
A file renamed or deleted since keeps its place in the design and simply does
not draw — losing the placement would be worse than a gap.

## Your own artwork

Two ways in, and they are a deliberate pair.

A **folder** is a handle, not a copy: point the tool at your arrows, stars and
illustrations and it draws the current version of each. That is right for a
library of marks you maintain. `library.ts`.

An **upload** is a copy, in IndexedDB. That is right for the photo you were sent
this morning: it needs no folder connected, it works on the phone — where no
browser implements the File System Access API at all — and a design that uses it
keeps working after the original has left your Downloads. `uploads.ts`. The cost
is that it is per browser, like saved designs and for the same reason.

Which library a piece of artwork came from is **stored on the layer**, never
guessed from its name, because the two fail differently and the panel has to say
which: a folder image is missing until the folder is reconnected, and an upload
is missing because it is in another browser. Guessing would collapse those into
one unhelpful "could not be found".

### The folder, in detail

**Nothing is eager.** That was the explicit brief, and it shapes the whole
module:

| When | What is read |
|---|---|
| Page load | Nothing. It checks IndexedDB for a saved folder and offers to reconnect. No directory is listed, no file opened. |
| Reconnect / choose | The listing. `getFile()` returns a lazy `File` — name, size, mtime. Still no bytes. |
| Thumbnail | Decoded once, cached in IndexedDB against size + mtime. Later visits paint the grid without touching the originals. |
| Place an image | Only now is the full file read and decoded. |

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

**Placement is relative.** A layer stores its centre as a fraction of width and
height, and its size as a fraction of the artboard's *short* edge. That is
what lets one placement mean something at all four sizes — an arrow put beside
the headline in the square lands beside the headline in the story. Pixels would
pin it to one aspect ratio and make the other three wrong, undoing the point of
the tool. Sizing against the short edge rather than the width is why a layer
does not balloon in the landscape.

Layers draw above the design and **below the grain**, and images take the same
treatment as BUZZ: the art never warps, so the ink edge comes from a
misregistered silhouette behind it.

SVG is fine at any size. Chrome re-rasterises SVG at draw size, so a file with
only a `viewBox` (intrinsic 150px) and one with an explicit 1200px width render
byte-identically — measured, not assumed. An SVG with neither a `viewBox` nor
width/height cannot be sized by the browser at all, and the error says so.

### Cropping a photograph

An image either **fits** its own aspect or **fills** a frame you gave it.

Fitting is the right default: artwork — an arrow, a star, BUZZ — has a shape, and
cropping or stretching it is vandalism. A photograph is the other case entirely:
it arrives at whatever shape the camera was, and the design needs a square, or a
4:5, or a band across the top. So a frame is opt-in, and while there is one the
artwork fills it and is cropped rather than squashed. There is deliberately **no
third mode** where the image is distorted to fit, because that is never what
anyone wanted.

Inside the frame, zoom scales past the tightest fill and the focal point picks
which part of the artwork sits in the middle. Two rulings:

- **The focal point is stored on the artwork**, as a fraction of it, not as a
  pixel offset — so the crop survives the frame being resized and the format
  being switched, which is the same reason every other position here is
  relative.
- **The offset is clamped so the frame stays covered.** Without that, dragging
  the focus to a corner slides the artwork off its own frame and leaves a band of
  ground showing through, and a crop that does not stay filled is not a crop.
  `crop.test.ts` checks that every focal point, including ones outside the
  artwork entirely, still leaves the frame covered.

The frame also **clips**, and that includes the misregistered silhouette — or the
ink edge would spill past the crop and give the frame a soft charcoal halo on
exactly the sides the artwork was cut off at.

One field split in two while this was built. An image layer's `name` was doing
double duty as both the label and the key its decoded bitmap is stored under.
For a folder image those are the same string, so one field appeared to work; for
an upload the key is an opaque id and the label is the file you dragged in, so
**uploads silently drew nothing**. `file` is the key and is never shown; `name`
is the label and is yours to rename.

### Taking the background out

**A flood fill inward from the edges**, removing what is both close in colour to
the border *and connected to it*. Not a global colour match, and that is the
difference that matters: a photograph of an engineer in a white shirt against a
white wall loses the wall and keeps the shirt, because the shirt is not touching
the border. "Remove every white pixel" would punch a hole through him, and it
would look like it worked right up until someone opened the export.
`cutout.test.ts` locks exactly that case.

**It is not a matting model, and the boundary is worth knowing before you reach
for it.** It has no idea what a person is. Give it a plain backdrop — a studio
wall, a product on white, a logo on a flat field — and it is exactly right and
instant. Give it a band photo in a cluttered rehearsal room and it will not save
you, and no amount of tolerance-fiddling will change that. This is the
deterministic 90% case, not remove.bg. A real matting model is possible in a
browser and is not here on purpose: it means shipping tens or hundreds of
megabytes of weights, which breaks the single-file build outright and is a
dependency worth choosing deliberately rather than arriving at.

Details that matter:

- The mask **multiplies** the alpha already there rather than replacing it, so a
  PNG that arrives with soft edges keeps them, and one that arrives with holes
  keeps those too — anything already transparent is treated as background
  whatever colour it claims to be.
- **The edge is feathered** by a few passes of a separable 3×3 average. A hard
  mask cuts along the pixel grid and reads as a sticker with a jagged outline,
  which is the giveaway that something was cut out.
- The working resolution is **capped at 2048** on the long edge. A 24MB photo can
  be 8000×6000, which is 48 million pixels and nearly 200MB of `ImageData` for a
  mask nobody will see at that resolution — the artboard's longest edge is 1920.
- The **ink silhouette follows the cutout**, not the rectangle the photograph
  arrived in, so a cut-out subject gets a misregistered edge around the subject.
- A cutout that cannot be computed **falls back to the original**. `getImageData`
  throws on a canvas tainted by a cross-origin image, and a background that could
  not be removed should look like one that was not asked about, not like a layer
  that vanished.

### Where artwork should live

Two libraries, and they want different homes. **Scratch** — the photo for this
one ad, an illustration you are trying out — belongs in the disk folder.
**System** does not: the bible lists "Mustard hand-drawn arrows" as *the*
standard emphasis device, alongside the starburst and the Venn. Once a mark is
brand, it belongs in `public/brand/`, versioned, so a teammate opening this tool
can make the same ad. A mark that only exists on one desktop reopens exactly the
self-service gap this tool was built to close.

## What is not built yet

- **GIF, and transparent video.** The MP4 path is there; GIF is a separate
  container. Transparent video is not a browser-side job at all — measured, see
  *Transparency, and what a browser will not do*. A PNG sequence handed to
  ffmpeg is the route, and nothing here builds one yet.
- **Cutting a subject out of a busy background.** The edge flood handles a plain
  backdrop; a real matting model is a deliberate dependency nobody has chosen.
- **Tier 2 texture.** The whole-sheet weathering plates. `wild-ride` has eight;
  none are copied here yet. Use each sheet whole and fitted, never cropped and
  tiled. The per-layer paper control is tier 1 only.
- **Per-element paper on the template's five.** The headline, BUZZ and the
  wordmark take the sheet's grain and cannot opt out of it; only layers you add
  can. Redrawing a template element after the grain means re-running its layout,
  which the drawing code is not currently shaped for.
- **More templates.** `templates/` takes one file per template; the carousel,
  reel word-cards and the EDU title slide are all specified in bible 3.2. Layers
  are template-agnostic, so a new one gets the whole editor for free by calling
  `drawLayers`.
- **Grouping.** Several things can be selected and moved together, but the
  grouping is not a thing that persists — reselect them next time.
- **Non-uniform group resize.** A group scales uniformly from a corner; there
  is no group side handle, and *Resizing a selection* says why.
- **Download all as a zip.** Currently it fires staggered single downloads,
  because browsers drop simultaneous programmatic ones.
- **Hosting.** Still local-only. No auth story yet, which is the main thing to
  settle before anyone else uses it.

## Assets

Everything the templates draw lives in `public/brand/`, documented in the README
there — including that the wordmark is currently keyed from a screenshot and
wants replacing with its real master.
