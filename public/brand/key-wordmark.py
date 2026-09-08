from PIL import Image
import numpy as np

SRC = '/root/.claude/uploads/4715296e-d5b5-5ef1-ba27-f8a25c5b0071/43ec142b-image.jpg'
im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.float64)

# Luminance (Rec.709) over the content area only.
lum = a @ np.array([0.2126, 0.7152, 0.0722])

# --- alpha matte from darkness -------------------------------------------
# White point / black point chosen off the measured histogram of the page
# ground vs the ink. Everything at or above WHITE is fully transparent,
# at or below BLACK is fully opaque, linear in between so antialiased
# edges keep their softness.
WHITE, BLACK = 246.0, 66.0
alpha = (WHITE - lum) / (WHITE - BLACK)
alpha = np.clip(alpha, 0.0, 1.0)

# Kill JPEG mosquito noise in the paper, then re-normalise so the ink that
# survives still reaches full opacity.
alpha[alpha < 0.08] = 0.0
alpha = np.clip(alpha / 0.92, 0.0, 1.0)

# --- isolate the wordmark -------------------------------------------------
# Mask out browser chrome, sidebar, taskbar, the Softr badge and the
# Windows watermark: keep only the measured logo box.
keep = np.zeros_like(alpha, dtype=bool)
keep[200:500, 250:1210] = True
alpha = np.where(keep, alpha, 0.0)

ys, xs = np.nonzero(alpha > 0.02)
y0, y1 = ys.min(), ys.max() + 1
x0, x1 = xs.min(), xs.max() + 1
PAD = 4
y0, x0 = max(y0 - PAD, 0), max(x0 - PAD, 0)
y1, x1 = y1 + PAD, x1 + PAD
crop = alpha[y0:y1, x0:x1]
h, w = crop.shape
print(f'wordmark bbox: x {x0}-{x1}  y {y0}-{y1}  -> {w} x {h}')
print(f'opaque px: {(crop > 0.5).sum()}  soft-edge px: {((crop > 0.02) & (crop <= 0.5)).sum()}')

def write(name, rgb):
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = rgb
    out[..., 3] = np.round(crop * 255).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(name)
    print('wrote', name)

CHARCOAL = (0x2C, 0x2C, 0x2A)
CREAM    = (0xFC, 0xF7, 0xE8)
write('studioland-wordmark-charcoal.png', CHARCOAL)
write('studioland-wordmark-cream.png', CREAM)

# --- proof sheet: both marks on their approved grounds --------------------
grounds = [(CREAM, 'studioland-wordmark-charcoal.png'),
           (CHARCOAL, 'studioland-wordmark-cream.png'),
           ((0x3A, 0x61, 0x68), 'studioland-wordmark-cream.png'),
           ((0xBF, 0x75, 0x38), 'studioland-wordmark-cream.png')]
SCALE = 0.62
tw, th = int(w * SCALE), int(h * SCALE)
pad, band = 40, int(th + 80)
proof = Image.new('RGB', (tw + pad * 2, band * len(grounds)), 'white')
for i, (bg, f) in enumerate(grounds):
    tile = Image.new('RGB', (tw + pad * 2, band), bg)
    mark = Image.open(f).resize((tw, th), Image.LANCZOS)
    tile.paste(mark, (pad, 40), mark)
    proof.paste(tile, (0, band * i))
proof.save('proof.png')
print('wrote proof.png', proof.size)
