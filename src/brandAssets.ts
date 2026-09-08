/* The artwork the brand ships with, as things you add rather than things a
 * template owns.
 *
 * BUZZ and the wordmark used to be named slots in the social ad - two of five
 * roles the template placed, sized and drew, with their own branch in the
 * drawing code and their own controls in the panel. They are not roles any
 * more, they are artwork: you add one, move it, resize it, give it more paper
 * or none, and delete it. Everything an uploaded photograph can do, they can
 * do, because there is no longer any code that treats them differently.
 *
 * WHAT SURVIVED THAT is the one rule that was never about the slot. The bible
 * gives the wordmark a minimum size "so the arrow-I signpost stops reading",
 * and that is a fact about the mark itself - it would be just as true if you
 * dropped the file in from your desktop. So it lives here, attached to the
 * asset, and is enforced wherever that asset is used. A rule that belongs to a
 * drawing should not evaporate because the drawing stopped being a slot.
 */

export type BrandAsset = {
  /** The key its decoded image is stored under, and what a layer references. */
  key: string;
  label: string;
  path: string;
  /* A floor on how small it may be drawn, as a fraction of the artboard's
   * WIDTH. A proportion rather than a pixel figure because an exported artboard
   * is viewed at every size, so a literal number would be false precision. */
  minWidth?: number;
};

/** Anything under this fraction of the artboard's width stops reading. */
const MARK_MIN = 0.12;

export const BRAND_ASSETS: BrandAsset[] = [
  { key: "brand:buzz-wave", label: "BUZZ waving", path: "/brand/buzz-wave.webp" },
  { key: "brand:buzz-ride", label: "BUZZ in the car", path: "/brand/buzz-ride.webp" },
  {
    key: "brand:wordmark-cream",
    label: "Wordmark, cream",
    path: "/brand/studioland-wordmark-cream.png",
    minWidth: MARK_MIN,
  },
  {
    key: "brand:wordmark-charcoal",
    label: "Wordmark, charcoal",
    path: "/brand/studioland-wordmark-charcoal.png",
    minWidth: MARK_MIN,
  },
];

export const brandAsset = (key: string): BrandAsset | undefined =>
  BRAND_ASSETS.find((a) => a.key === key);

/* The smallest a given asset may be drawn on a given artboard, expressed in the
 * units a layer stores its width in - a fraction of the SHORT edge. The floor
 * itself is a fraction of the WIDTH, so the two have to be reconciled per
 * format: the same mark needs a larger short-edge fraction on a landscape than
 * on a square to come out the same size on the page. */
export function minLayerWidth(key: string, size: { w: number; h: number }): number {
  const asset = brandAsset(key);
  if (!asset?.minWidth) return 0;
  return (asset.minWidth * size.w) / Math.min(size.w, size.h);
}
