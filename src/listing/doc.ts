/* What a listing graphic IS: four choices and some text.
 *
 * Deliberately small and deliberately serialisable - no images, no canvases, no
 * React. A photo lives here as the object URL of a File the person picked, which
 * is the one field that does NOT survive a reload, and the editor says so rather
 * than pretending to persist it.
 */
import {
  INK,
  LINE_HEIGHT,
  OUTLINE,
  slotFor,
  type Badge,
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
  badge: Badge;
  /* A list of one - the address. It stays a list because drawing walks it and
   * because a second template may carry more, not because this one can add. */
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
  };
}

export function addressBlock(): TextBlock {
  return inSlot("address", ADDRESS_SEED, "address");
}

export function emptyDoc(): Doc {
  return { photo: null, headshot: "arch", badge: "none", blocks: [addressBlock()] };
}
