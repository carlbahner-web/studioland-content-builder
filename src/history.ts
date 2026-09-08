/* Undo.
 *
 * Free placement without undo is a trap, and it was one here: the only way back
 * from a drag you did not mean was "Auto-arrange", which throws away every
 * position in the design to fix one of them. So the whole editable state goes
 * through this, and cmd-Z walks back through it.
 *
 * COALESCING is the only interesting part. A drag emits a state change per
 * pointer move and typing emits one per keystroke; recorded literally, one
 * dragged sticker becomes two hundred undo steps and cmd-Z stops meaning
 * anything. So a push carries a TAG naming what kind of edit it is - "drag:L4f",
 * "text:headline" - and consecutive pushes with the same tag inside a short
 * window replace each other rather than stacking. The result is that one drag is
 * one undo, and a sentence typed without pausing is one undo, which is what a
 * person means by "undo that".
 *
 * A tag of null never coalesces: discrete edits (add a layer, apply a preset,
 * switch colourway) are each worth their own step.
 */

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  /** The tag and time of the last push, for coalescing. */
  tag: string | null;
  at: number;
  limit: number;
};

/** Pushes with the same tag inside this many ms fold into one step. */
export const COALESCE_MS = 700;

/** Steps kept. Deep enough to get out of any mess, shallow enough that a
 *  design's worth of states is not held in memory forever. */
const LIMIT = 120;

export function initHistory<T>(present: T, limit = LIMIT): History<T> {
  return { past: [], present, future: [], tag: null, at: 0, limit };
}

/* A push always REPLACES the future. Editing after undoing is the branch point
 * every editor resolves this way, and any other answer needs a tree the UI has
 * no way to show. */
export function pushHistory<T>(h: History<T>, next: T, tag: string | null, at: number): History<T> {
  if (Object.is(next, h.present)) return h;
  const folds = tag !== null && tag === h.tag && at - h.at < COALESCE_MS;
  if (folds) return { ...h, present: next, at, future: [] };
  const past = [...h.past, h.present];
  return {
    past: past.length > h.limit ? past.slice(past.length - h.limit) : past,
    present: next,
    future: [],
    tag,
    at,
    limit: h.limit,
  };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const present = h.past[h.past.length - 1];
  return {
    ...h,
    past: h.past.slice(0, -1),
    present,
    future: [h.present, ...h.future],
    // Cleared so the next edit cannot fold into the step that was just undone.
    tag: null,
    at: 0,
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return {
    ...h,
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1),
    tag: null,
    at: 0,
  };
}

/* Replace the present without recording a step, and drop the history with it.
 *
 * This is for LOADING - a restored draft, an opened design - where the states
 * before it belong to a different document and undoing into them would be
 * nonsense: you would cmd-Z out of the design you just opened and into the one
 * you had before, with no way to tell what happened. */
export function resetHistory<T>(h: History<T>, present: T): History<T> {
  return { past: [], present, future: [], tag: null, at: 0, limit: h.limit };
}
