/* What a listing graphic IS: four choices and some text.
 *
 * Deliberately small and deliberately serialisable - no images, no canvases, no
 * React. A photo lives here as the object URL of a File the person picked, which
 * is the one field that does NOT survive a reload, and the editor says so rather
 * than pretending to persist it.
 */
import {
  BADGE_OUTLINE_EM,
  BADGE_TRACKING,
  INK,
  LINE_HEIGHT,
  OUTLINE,
  OUTLINE_EM,
  TRACKING,
  slotFor,
  type Headshot,
} from "./template.ts";
import type { PhotoFit, TextBlock } from "./template.ts";

export type Photo = {
  /** Object URL. Revoked when replaced. */
  src: string;
  name: string;
  w: number;
  h: number;
  fit: PhotoFit;
};

export type Doc = {
  photo: Photo | null;
  headshot: Headshot;
  /* The address and the badge, in that order. Fixed - this tool adds and
   * removes nothing - but a list, because drawing walks it and because a second
   * template may carry different ones. */
  blocks: TextBlock[];
};

/* The address block is seeded rather than blank.
 *
 * A blank template teaches nothing: it does not show that the last two lines are
 * the brokerage, or that a blank line is what makes the three groups. Seeding it
 * with the real example means the first edit is a replacement - which is what
 * "replacing the address" actually is - instead of an act of composition.
 */
export const ADDRESS_SEED = [
  "373 Meetinghouse Ln",
  "Lancaster, PA 17601",
  "",
  "@angrera_realtor",
  "717-332-4407",
  "",
  "AngelaReraRealEstate.com",
  "Coldwell Banker Realty",
].join("\n");

/** A block in one of the template's fixed slots. The slot owns where and how big. */
function inSlot(id: string, text: string, slotKey: string): TextBlock {
  const slot = slotFor(slotKey);
  // The badge is set tighter and outlined heavier than the address. Both are
  // measured off the artwork rather than shared - see TRACKING in template.ts.
  const badge = slot.key === "badge";
  return {
    id,
    text,
    slot: slot.key,
    box: { ...slot.box },
    size: slot.size,
    align: slot.align,
    fill: INK,
    outline: OUTLINE,
    lineHeight: LINE_HEIGHT,
    tracking: badge ? BADGE_TRACKING : TRACKING,
    outlineEm: badge ? BADGE_OUTLINE_EM : OUTLINE_EM,
  };
}

export function addressBlock(): TextBlock {
  return inSlot("address", ADDRESS_SEED, "address");
}

/* Empty, so a fresh document carries no badge: most listings are neither sold
 * nor pending yet, and drawBlock skips an empty line, so nothing is painted. */
export function badgeBlock(text = ""): TextBlock {
  return inSlot("badge", text, "badge");
}

export function emptyDoc(): Doc {
  return { photo: null, headshot: "arch", blocks: [addressBlock(), badgeBlock()] };
}
