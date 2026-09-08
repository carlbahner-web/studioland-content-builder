/* Your own artwork, read straight off disk.
 *
 * The brief was "like Canva, but I would not want them all automatically loaded
 * every time the page loads". So nothing here is eager:
 *
 *   page load        - reads NOTHING. It checks IndexedDB for a saved folder
 *                      handle and, if there is one, offers to reconnect. No
 *                      directory is listed and no file is opened.
 *   reconnect click  - lists the folder. `getFile()` returns a lazy File: name,
 *                      size and modified-time only. Still no bytes read.
 *   thumbnail        - decoded once, then cached in IndexedDB against the file's
 *                      size and mtime. Later visits paint the grid without
 *                      opening the originals at all.
 *   place a sticker  - only NOW is the full file read and decoded.
 *
 * What is stored is a HANDLE, not the files. Edit an arrow in Illustrator, save
 * it, and the tool sees the new version - there is no second copy to drift.
 *
 * Chrome and Edge only. That narrows nothing: the MP4 export already needs
 * WebCodecs, which is the same story.
 *
 * Permission cannot be restored silently. Chrome requires a user gesture to
 * re-grant access to a directory on a fresh page load, so a return visit costs
 * one click. That is the browser's rule, not a shortcut taken here.
 */

import { kvGet, kvSet } from "./kv.ts";

const HANDLE_KEY = "library-folder";

export const IMAGE_EXT = /\.(png|webp|jpe?g|gif|svg)$/i;

/* --------------------------------------------------------------- the folder */

export const SUPPORTED = typeof window !== "undefined" && "showDirectoryPicker" in window;

export type LibraryItem = {
  /** File name, and the id a sticker stores. */
  name: string;
  size: number;
  modified: number;
  /** Cache key: changes when the file on disk changes. */
  stamp: string;
};

let folder: FileSystemDirectoryHandle | null = null;

export function folderName(): string | null {
  return folder?.name ?? null;
}

/** Is there a folder saved from a previous visit? Reads no files. */
export async function savedFolder(): Promise<string | null> {
  if (!SUPPORTED) return null;
  const handle = await kvGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  return handle?.name ?? null;
}

export async function chooseFolder(): Promise<string> {
  const handle = await window.showDirectoryPicker({ id: "studioland-art", mode: "read" });
  folder = handle;
  // Remembering the folder is a convenience, not a precondition. If the save
  // fails - private browsing, a storage quota, a browser that will not clone
  // the handle - the folder still works for this session and you are simply
  // asked for it again next time. Letting that failure reject would have thrown
  // away a folder the user had just successfully chosen.
  try {
    await kvSet(HANDLE_KEY, handle);
  } catch {
    /* not fatal */
  }
  return handle.name;
}

/** Reconnect the saved folder. Must be called from a click - Chrome requires it. */
export async function reconnectFolder(): Promise<boolean> {
  const handle = await kvGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  if (!handle) return false;
  let state = await handle.queryPermission({ mode: "read" });
  if (state !== "granted") state = await handle.requestPermission({ mode: "read" });
  if (state !== "granted") return false;
  folder = handle;
  return true;
}

export async function forgetFolder(): Promise<void> {
  folder = null;
  await kvSet(HANDLE_KEY, undefined);
}

/** List the images. Metadata only - no file contents are read. */
export async function listLibrary(): Promise<LibraryItem[]> {
  if (!folder) return [];
  const items: LibraryItem[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind !== "file" || !IMAGE_EXT.test(entry.name)) continue;
    const fileHandle = entry as unknown as FileSystemFileHandle;
    // getFile() hands back a lazy File. Size and mtime come from the directory
    // entry; the bytes are not touched until something asks for them.
    const file = await fileHandle.getFile();
    items.push({
      name: entry.name,
      size: file.size,
      modified: file.lastModified,
      stamp: `${file.size}:${file.lastModified}`,
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------ reading and decoding */

const decoded = new Map<string, HTMLImageElement>();

export function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      // An SVG with no width/height and no viewBox has no intrinsic size, so the
      // browser cannot raster it. Worth saying plainly rather than failing mute.
      reject(new Error(`${blob.type || "file"} could not be decoded (an SVG needs a viewBox)`));
    };
    img.src = url;
  });
}

/** Read and decode a file. This is the first point any bytes are read. */
export async function loadFromLibrary(name: string): Promise<HTMLImageElement> {
  const hit = decoded.get(name);
  if (hit) return hit;
  if (!folder) throw new Error("no folder connected");
  const handle = await folder.getFileHandle(name);
  const img = await imageFromBlob(await handle.getFile());
  decoded.set(name, img);
  return img;
}

/* ------------------------------------------------------------- thumbnails */

const THUMB = 128;

/** A thumbnail data URL, from cache where possible. */
export async function thumbnail(item: LibraryItem): Promise<string> {
  const key = `thumb:${item.name}:${item.stamp}`;
  const cached = await kvGet<string>(key).catch(() => undefined);
  if (cached) return cached;

  const img = await loadFromLibrary(item.name);
  const c = document.createElement("canvas");
  const scale = Math.min(THUMB / img.width, THUMB / img.height, 1);
  c.width = Math.max(1, Math.round(img.width * scale));
  c.height = Math.max(1, Math.round(img.height * scale));
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d context for a thumbnail");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/png");
  // Keyed by size and mtime, so re-saving the file in Illustrator invalidates
  // it on its own - no cache to clear by hand. A failed write just means the
  // thumbnail is rebuilt next time, which is not worth failing the grid over.
  try {
    await kvSet(key, url);
  } catch {
    /* not fatal */
  }
  return url;
}
