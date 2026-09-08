import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  canRedo,
  canUndo,
  COALESCE_MS,
  initHistory,
  pushHistory,
  redo,
  resetHistory,
  undo,
} from "./history.ts";

test("an untouched history has nowhere to go", () => {
  const h = initHistory("a");
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
  assert.equal(undo(h), h);
  assert.equal(redo(h), h);
});

test("undo and redo walk the same path", () => {
  let h = initHistory("a");
  h = pushHistory(h, "b", null, 0);
  h = pushHistory(h, "c", null, 0);
  assert.equal(h.present, "c");
  h = undo(h);
  assert.equal(h.present, "b");
  h = undo(h);
  assert.equal(h.present, "a");
  assert.equal(canUndo(h), false);
  h = redo(h);
  assert.equal(h.present, "b");
  h = redo(h);
  assert.equal(h.present, "c");
  assert.equal(canRedo(h), false);
});

test("one drag is one undo: same tag inside the window folds", () => {
  let h = initHistory("a");
  for (let i = 0; i < 50; i++) h = pushHistory(h, `drag${i}`, "drag:L1", i * 10);
  assert.equal(h.past.length, 1);
  assert.equal(h.present, "drag49");
  assert.equal(undo(h).present, "a");
});

test("a pause between edits with the same tag starts a new step", () => {
  let h = initHistory("a");
  h = pushHistory(h, "b", "text:headline", 0);
  h = pushHistory(h, "c", "text:headline", COALESCE_MS + 1);
  assert.equal(h.past.length, 2);
  assert.equal(undo(h).present, "b");
});

test("different tags never fold into each other", () => {
  let h = initHistory("a");
  h = pushHistory(h, "b", "drag:L1", 0);
  h = pushHistory(h, "c", "drag:L2", 10);
  assert.equal(h.past.length, 2);
});

test("an untagged edit is always its own step", () => {
  let h = initHistory("a");
  h = pushHistory(h, "b", null, 0);
  h = pushHistory(h, "c", null, 1);
  assert.equal(h.past.length, 2);
});

test("pushing the same value again records nothing", () => {
  let h = initHistory("a");
  h = pushHistory(h, "a", null, 0);
  assert.equal(h.past.length, 0);
});

test("editing after an undo drops the redo branch", () => {
  let h = initHistory("a");
  h = pushHistory(h, "b", null, 0);
  h = pushHistory(h, "c", null, 0);
  h = undo(h);
  assert.equal(canRedo(h), true);
  h = pushHistory(h, "d", null, 0);
  assert.equal(canRedo(h), false);
  assert.equal(undo(h).present, "b");
});

test("an edit straight after an undo cannot fold into the step it undid", () => {
  let h = initHistory("a");
  h = pushHistory(h, "b", "drag:L1", 0);
  h = undo(h);
  h = pushHistory(h, "c", "drag:L1", 10);
  // Folding here would eat "a" - the state the undo just returned to.
  assert.equal(undo(h).present, "a");
});

test("the stack is bounded, and drops the oldest first", () => {
  let h = initHistory(0, 5);
  for (let i = 1; i <= 20; i++) h = pushHistory(h, i, null, i);
  assert.equal(h.past.length, 5);
  assert.deepEqual(h.past, [15, 16, 17, 18, 19]);
});

test("loading a design clears the history rather than joining it", () => {
  let h = initHistory("a");
  h = pushHistory(h, "b", null, 0);
  h = resetHistory(h, "opened");
  assert.equal(h.present, "opened");
  // Undoing into the document you had open before is nonsense.
  assert.equal(canUndo(h), false);
  assert.equal(canRedo(h), false);
});
