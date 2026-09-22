/* A minimal PNG codec: enough of the spec to read the artwork exports and write
 * what comes out the other side, with no dependency to install.
 *
 * Reads 8-bit non-interlaced PNGs of any color type and hands back RGBA; writes
 * 8-bit RGBA. That is the whole of what this repo's art pipeline needs, and the
 * unsupported cases throw rather than producing quietly wrong pixels.
 */
import { inflateSync, deflateSync } from "node:zlib";

/* ------------------------------------------------------------------- decode */

export function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let w, h, depth, color, interlace;
  let palette = null;
  let alphaTable = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") alphaTable = data;
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`bit depth ${depth} unsupported`);
  if (interlace !== 0) throw new Error("interlaced PNG unsupported");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const flat = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const guess = a + b - c;
        const da = Math.abs(guess - a);
        const db = Math.abs(guess - b);
        const dc = Math.abs(guess - c);
        line[i] = (line[i] + (da <= db && da <= dc ? a : db <= dc ? b : c)) & 255;
      }
    }
    line.copy(flat, y * stride);
    prev = line;
  }

  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (color === 6) flat.copy(rgba, i * 4, i * 4, i * 4 + 4);
    else if (color === 2) {
      flat.copy(rgba, i * 4, i * 3, i * 3 + 3);
      rgba[i * 4 + 3] = 255;
    } else if (color === 3) {
      const idx = flat[i];
      palette.copy(rgba, i * 4, idx * 3, idx * 3 + 3);
      rgba[i * 4 + 3] = alphaTable && idx < alphaTable.length ? alphaTable[idx] : 255;
    } else if (color === 0) {
      rgba.fill(flat[i], i * 4, i * 4 + 3);
      rgba[i * 4 + 3] = 255;
    } else {
      rgba.fill(flat[i * 2], i * 4, i * 4 + 3);
      rgba[i * 4 + 3] = flat[i * 2 + 1];
    }
  }
  return { w, h, rgba };
}

/* ------------------------------------------------------------------- encode */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/* Filter each row with whichever of the five predictors gives the smallest sum
 * of absolute residuals - the heuristic the spec itself recommends. On the
 * headshots it is worth roughly a third of the file over filtering with none. */
export function encode(w, h, rgba) {
  const stride = w * 4;
  const rows = Buffer.alloc(h * (stride + 1));
  const candidate = Buffer.alloc(stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const line = rgba.subarray(y * stride, (y + 1) * stride);
    let bestFilter = 0;
    let bestScore = Infinity;
    let best = null;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? line[i - 4] : 0;
        const b = prev[i];
        const c = i >= 4 ? prev[i - 4] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const guess = a + b - c;
          const da = Math.abs(guess - a);
          const db = Math.abs(guess - b);
          const dc = Math.abs(guess - c);
          pred = da <= db && da <= dc ? a : db <= dc ? b : c;
        }
        const v = (line[i] - pred) & 255;
        candidate[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
        best = Buffer.from(candidate);
      }
    }
    rows[y * (stride + 1)] = bestFilter;
    best.copy(rows, y * (stride + 1) + 1);
    prev = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
