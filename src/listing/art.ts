/* Loading what a listing post is drawn from: the keyed artwork, the arch masks,
 * the photographed headshots, and the webfont. Shared by the full editor and
 * the guided one, which draw the same post and must not disagree about when
 * it is ready. */
import { useEffect, useState } from "react";
import { assetUrl } from "../assets.ts";
import { HEADSHOTS, PHOTO_FILES } from "./template.ts";
import { LAYER_BOXES } from "./draw.ts";
import type { Art } from "./draw.ts";

export function useArt(): { art: Art; ready: boolean; failed: string[] } {
  const [art, setArt] = useState<Art>({});
  const [failed, setFailed] = useState<string[]>([]);
  /* Keyed layers are named by the manifest and live at /listing/<name>.png; the
     mask and the photographed headshots carry their own paths. Loaded together
     because the artboard is not drawable until all of them are in. */
  const wanted: { id: string; url: string }[] = [
    ...Object.keys(LAYER_BOXES).map((name) => ({ id: name, url: `/listing/${name}.png` })),
    ...PHOTO_FILES.map((file) => ({ id: file, url: file })),
    ...HEADSHOTS.filter((h) => h.photo).map((h) => ({ id: h.key, url: h.photo!.file })),
  ];

  useEffect(() => {
    let live = true;
    const loaded: Art = {};
    const bad: string[] = [];
    Promise.all(
      wanted.map(
        ({ id, url }) =>
          new Promise<void>((done) => {
            const img = new Image();
            img.onload = () => {
              loaded[id] = img;
              done();
            };
            img.onerror = () => {
              bad.push(id);
              done();
            };
            img.src = assetUrl(url);
          }),
      ),
    ).then(() => {
      if (!live) return;
      setArt(loaded);
      setFailed(bad);
    });
    return () => {
      live = false;
    };
    // The layer set is a build-time constant; this runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { art, ready: Object.keys(art).length > 0 || failed.length > 0, failed };
}

/* The webfont has to be IN before the first paint that measures it, or every
 * block is laid out against the fallback and then never re-laid out. `document.
 * fonts.load` is the only thing that actually waits for it - `ready` resolves
 * against fonts already requested, and a font nothing has rendered yet has not
 * been requested. */
export function useFontReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    const done = () => live && setReady(true);
    if (!document.fonts?.load) {
      done();
      return;
    }
    document.fonts.load('16px "TAYWingman"').then(done, done);
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

