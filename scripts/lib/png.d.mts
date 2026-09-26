/* Types for png.mjs, so the browser tests can decode a saved picture. */
export function decode(buf: Uint8Array): { w: number; h: number; rgba: Uint8Array };
export function encode(w: number, h: number, rgba: Uint8Array): Buffer;
