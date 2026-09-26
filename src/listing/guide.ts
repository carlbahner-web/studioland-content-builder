/* The guided listing flow's plain logic: what she types becomes the address
 * block, and what the saved file is called. Kept apart from the page so it is
 * tested at a desk.
 */
import { datedName, nameWords } from "../filenames.ts";
import { ADDRESS_SEED } from "./doc.ts";

/* Her contact lines - handle, phone, website, brokerage - never change from
 * post to post, so the guided flow never shows them as something to edit. They
 * are the seeded address with its first two lines (the example house) taken
 * off, so there is still exactly one place they are written down. */
export const CONTACT_LINES = ADDRESS_SEED.split("\n").slice(2);

/** The full address block: the two lines she typed, then her contact lines. */
export function addressText(street: string, town: string): string {
  return [street.trim(), town.trim(), ...CONTACT_LINES].join("\n");
}

/* Words that say nothing about which house: the street type and the like. */
const STREET_FILLER = new Set([
  "st", "street", "rd", "road", "ave", "avenue", "ln", "lane", "dr", "drive", "ct", "court",
  "blvd", "boulevard", "way", "pl", "place", "cir", "circle", "ter", "terrace", "pike", "hwy",
  "highway", "pkwy", "parkway", "trl", "trail", "n", "s", "e", "w", "the", "of", "unit", "apt",
]);

/** "Sep26 listing 373 Meetinghouse.png" */
export function listingFilename(street: string, when: Date = new Date()): string {
  return datedName("listing", nameWords(street, STREET_FILLER, 3), when);
}

/* A street over this many characters is set small enough in the address block
 * to be worth a word. The block still shrinks to fit; this is only kindness. */
export const LONG_STREET = 26;

/** What is kept between visits. The photo is not: a file cannot be kept. */
export type Draft = {
  street: string;
  town: string;
  badge: string;
  headshot: string;
  layout: string;
};

export function readDraft(raw: string | null): Partial<Draft> {
  if (!raw) return {};
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object") return {};
    const out: Partial<Draft> = {};
    for (const k of ["street", "town", "badge", "headshot", "layout"] as const) {
      if (typeof d[k] === "string") out[k] = d[k];
    }
    return out;
  } catch {
    return {};
  }
}
