# Kept, not used

These two flats are the original SOLD! and PENDING! badges, as they came from
the designer. The tool no longer ships them: the badge is live type now, so it
can be edited and can say something other than those two words.

They stay here for two reasons, and `scripts/chroma-key.mjs` skips this folder
because it only reads the PNGs directly beside it:

- They are the record of what the design meant by a badge — the pink fill and
  the opaque navy outline in `template.ts` were sampled from them, and they are
  still the honest source if those ever need re-checking.
- **They are set in a different face from TAY Wingman.** Measured off these
  files, SOLD! is 273px wide with an 88px cap height; TAY Wingman renders the
  same word at 265px wide with a 67px cap. Roughly 27% taller for the same
  width — a heavier, more condensed cut. So the live badge does not match these
  exactly, and cannot until that font turns up.
