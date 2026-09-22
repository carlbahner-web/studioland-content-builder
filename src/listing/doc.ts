/* What a listing graphic IS: four choices and some text.
 *
 * Deliberately small and deliberately serialisable - no images, no canvases, no
 * React. A photo lives here as the object URL of a File the person picked, which
 * is the one field that does NOT survive a reload, and the editor says so rather
 * than pretending to persist it.
 */
import {
  ADDRESS_ALIGN,
  ADDRESS_BOX,
  ADDRESS_SIZE,
  INK,
  LINE_HEIGHT,
  OUTLINE,
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
  blocks: TextBlock[];
};

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

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

export function addressBlock(): TextBlock {
  return {
    id: "address",
    text: ADDRESS_SEED,
    box: { ...ADDRESS_BOX },
    size: ADDRESS_SIZE,
    align: ADDRESS_ALIGN,
    fill: INK,
    outline: OUTLINE,
    lineHeight: LINE_HEIGHT,
  };
}

/* A block added by hand starts wide, centred and low-ish on the navy - the one
 * region of the artwork with room for type that is not already spoken for. */
export function newBlock(text = "Just listed!"): TextBlock {
  return {
    id: nextId("text"),
    text,
    box: { x: 80, y: 760, w: 920, h: 200 },
    size: 96,
    align: "center",
    fill: INK,
    outline: OUTLINE,
    lineHeight: LINE_HEIGHT,
  };
}

export function emptyDoc(): Doc {
  return { photo: null, headshot: "arch", badge: "none", blocks: [addressBlock()] };
}
