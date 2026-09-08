/* Images you drop in, as against images in a folder on disk.
 *
 * The artwork library deliberately holds a HANDLE rather than a copy, so an
 * arrow edited in Illustrator is the arrow the tool draws. That is exactly right
 * for a library of marks you maintain, and exactly wrong for the photo you were
 * sent this morning: it needs the folder connected, it is desktop-only because
 * no mobile browser implements the File System Access API, and it means a
 * one-off image has to be filed somewhere before it can be used.
 *
 * So an upload is the other half of the pair, and it is a COPY on purpose. The
 * bytes go into IndexedDB, which means the phone can use one, no folder has to
 * be connected, and a design that refers to it keeps working after the original
 * has been deleted from Downloads. The cost is that it is per browser, like
 * saved designs and for the same reason, and that is the same trade the rest of
 * the tool already makes.
 *
 * Which library a piece of artwork came from is stored on the layer (`src`), not
 * guessed from its name - so the Artwork panel can say precisely what is missing
 * and why, rather than "a file could not be found".
 */
import { kvDelete, kvGet, kvKeys, kvSet } from "./kv.ts";
import { imageFromBlob, IMAGE_EXT } from "./library.ts";

const PREFIX = "upload:";
const THUMB = 128;

type Stored = { name: string; blob: Blob; added: number };

export type UploadItem = {
  /** The key a layer stores. Opaque; never parsed. */
  id: string;
  /** The original file name, for the list. */
  name: string;
  added: number;
};

/** 24MB. Past that a single design starts to threaten the storage a browser
 *  will hand a site, and taking an image that big is not doing anyone a favour. */
export const MAX_UPLOAD = 24 * 1024 * 1024;

export function uploadable(file: File): string | null {
  if (!IMAGE_EXT.test(file.name)) return `${file.name} is not a PNG, WebP, JPEG, GIF or SVG.`;
  if (file.size > MAX_UPLOAD) {
    return `${file.name} is ${(file.size / 1e6).toFixed(1)}MB - the limit is ${MAX_UPLOAD / 1e6}MB.`;
  }
  return null;
}

const decoded = new Map<string, HTMLImageElement>();

export async function addUpload(file: File): Promise<UploadItem> {
  const bad = uploadable(file);
  if (bad) throw new Error(bad);
  // Decoded BEFORE it is stored, so a file the browser cannot raster is refused
  // at the point you chose it rather than becoming a layer that never draws.
  const img = await imageFromBlob(file);
  const id = `${PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const record: Stored = { name: file.name, blob: file, added: Date.now() };
  await kvSet(id, record);
  decoded.set(id, img);
  return { id, name: file.name, added: record.added };
}

export async function listUploads(): Promise<UploadItem[]> {
  const keys = await kvKeys(PREFIX).catch(() => []);
  const out: UploadItem[] = [];
  for (const id of keys) {
    const rec = await kvGet<Stored>(id).catch(() => undefined);
    if (rec?.blob) out.push({ id, name: rec.name, added: rec.added });
  }
  return out.sort((a, b) => b.added - a.added);
}

export async function loadUpload(id: string): Promise<HTMLImageElement> {
  const hit = decoded.get(id);
  if (hit) return hit;
  const rec = await kvGet<Stored>(id);
  if (!rec?.blob) throw new Error("that upload is no longer in this browser");
  const img = await imageFromBlob(rec.blob);
  decoded.set(id, img);
  return img;
}

export async function deleteUpload(id: string): Promise<void> {
  decoded.delete(id);
  await kvDelete(id).catch(() => {});
  await kvDelete(`thumb:${id}`).catch(() => {});
}

/** A thumbnail data URL, cached. An upload's bytes never change, so unlike the
 *  folder's cache key this one needs no stamp. */
export async function uploadThumb(id: string): Promise<string> {
  const key = `thumb:${id}`;
  const cached = await kvGet<string>(key).catch(() => undefined);
  if (cached) return cached;
  const img = await loadUpload(id);
  const c = document.createElement("canvas");
  const scale = Math.min(THUMB / img.width, THUMB / img.height, 1);
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d context for a thumbnail");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/png");
  try {
    await kvSet(key, url);
  } catch {
    /* not fatal - it is rebuilt next time */
  }
  return url;
}
