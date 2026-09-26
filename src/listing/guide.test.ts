import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CONTACT_LINES, DEFAULT_HEADSHOT, addressText, listingFilename, readDraft } from "./guide.ts";
import { HEADSHOTS } from "./template.ts";
import { ADDRESS_SEED } from "./doc.ts";

test("her contact lines are the seed's, and the typed lines go on top", () => {
  assert.deepEqual(CONTACT_LINES, ADDRESS_SEED.split("\n").slice(2));
  assert.ok(CONTACT_LINES.includes("@angrera_realtor"));
  assert.equal(addressText(" 373 Meetinghouse Ln ", "Lancaster, PA 17601"), ADDRESS_SEED);
});

test("listing file names: month and day, 'listing', then the street words that matter", () => {
  const sep26 = new Date(2026, 8, 26);
  assert.equal(listingFilename("373 Meetinghouse Ln", sep26), "Sep26 listing 373 Meetinghouse.png");
  assert.equal(listingFilename("1247 Old Gettysburg Pike, Unit 2", new Date(2026, 2, 3)), "Mar03 listing 1247 Old Gettysburg.png");
  assert.equal(listingFilename("", sep26), "Sep26 listing.png");
  assert.equal(listingFilename('12 "Elm" St?', sep26), "Sep26 listing 12 Elm.png");
});

test("a draft reads back only the fields it knows, and survives junk", () => {
  assert.deepEqual(readDraft(JSON.stringify({ street: "1 A St", badge: "SOLD!", photo: "x", layout: 3 })), {
    street: "1 A St",
    badge: "SOLD!",
  });
  assert.deepEqual(readDraft("not json"), {});
  assert.deepEqual(readDraft(null), {});
});

test("the default headshot is one that exists: Hands in pockets", () => {
  const shot = HEADSHOTS.find((h) => h.key === DEFAULT_HEADSHOT);
  assert.ok(shot, `${DEFAULT_HEADSHOT} is not a headshot`);
  assert.equal(shot!.label, "Hands in pockets");
});
