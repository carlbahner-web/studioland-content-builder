/* MP4 export, frame by frame.
 *
 * WebCodecs `VideoEncoder` plus mp4-muxer, rather than MediaRecorder over
 * `canvas.captureStream()`. MediaRecorder records in REAL TIME: it captures
 * whatever the tab manages to paint while the clock runs, so a slow frame
 * becomes a dropped frame and the output duration drifts from what you asked
 * for. For an exporter that is the wrong shape entirely - the file has to be
 * exactly N frames at exactly 30fps whether the machine is fast or busy.
 * Encoding frame by frame gives that, and it is why the boil clock is keyed to
 * the frame index (see boil.ts) rather than to wall time.
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { FPS } from "./boil.ts";

type Candidate = { codec: string; muxer: "avc" | "vp9" | "av1"; label: string };

/* H.264 first, in descending profile order - it is what Instagram, and every
 * other platform, actually wants. The VP9 and AV1 entries are a real fallback
 * rather than politeness: Chromium builds without proprietary codecs (some
 * Linux distribution builds, and the headless build this was tested against)
 * report no avc1 support at all, and a valid VP9-in-MP4 is far better than an
 * export button that just fails. */
const CANDIDATES: Candidate[] = [
  { codec: "avc1.640028", muxer: "avc", label: "H.264 High" },
  { codec: "avc1.4d0028", muxer: "avc", label: "H.264 Main" },
  { codec: "avc1.42001f", muxer: "avc", label: "H.264 Baseline" },
  { codec: "vp09.00.10.08", muxer: "vp9", label: "VP9" },
  { codec: "av01.0.04M.08", muxer: "av1", label: "AV1" },
];

export async function pickCodec(w: number, h: number): Promise<Candidate | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const c of CANDIDATES) {
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec: c.codec,
        width: w,
        height: h,
        bitrate: bitrateFor(w, h),
        framerate: FPS,
      });
      if (s.supported) return c;
    } catch {
      // An unparseable codec string throws rather than returning false.
    }
  }
  return null;
}

/* ~0.19 bits per pixel per frame: 12 Mbps at 1080x1920/30, which is generous
 * for flat brand color and well inside what the platforms re-encode from. */
function bitrateFor(w: number, h: number): number {
  return Math.round(w * h * FPS * 0.19);
}

export type EncodeOpts = {
  width: number;
  height: number;
  frames: number;
  /** Paint frame `i` onto the canvas. Must be synchronous and deterministic. */
  draw: (frame: number) => void;
  canvas: HTMLCanvasElement;
  onProgress?: (done: number, total: number) => void;
};

export async function encodeMp4(opts: EncodeOpts): Promise<{ blob: Blob; codec: string }> {
  const { width, height, frames, draw, canvas, onProgress } = opts;
  const pick = await pickCodec(width, height);
  if (!pick) throw new Error("This browser cannot encode video (no WebCodecs VideoEncoder).");

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: pick.muxer, width, height, frameRate: FPS },
    // Puts the index at the front so the file plays before it is fully
    // downloaded - what every player and upload form expects.
    fastStart: "in-memory",
  });

  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure({
    codec: pick.codec,
    width,
    height,
    bitrate: bitrateFor(width, height),
    framerate: FPS,
  });

  const frameDuration = 1e6 / FPS; // microseconds
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    draw(i);
    const vf = new VideoFrame(canvas, {
      timestamp: Math.round(i * frameDuration),
      duration: Math.round(frameDuration),
    });
    // A keyframe every two seconds. Also forces frame 0 to be one, so the
    // first frame of the loop decodes without reference to anything.
    encoder.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    onProgress?.(i + 1, frames);
    // Let the queue drain so a long export does not balloon memory or wedge
    // the tab. encodeQueueSize is the encoder's own backpressure signal.
    if (encoder.encodeQueueSize > 8) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  return {
    blob: new Blob([muxer.target.buffer], { type: "video/mp4" }),
    codec: pick.label,
  };
}
