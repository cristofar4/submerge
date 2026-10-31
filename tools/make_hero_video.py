"""Turn the still hero image into a seamless looping cinemagraph.

What moves (everything is periodic over LOOP seconds, so the clip loops without a seam):
  * fish: each fish in the open water is cut out of the still, the water behind it is
    filled in, and the cut-out swims to the right. Fish fade out as they reach the reef
    and come back in from the left edge of the frame
  * manta ray: slow glide with gentle wing-beat and banking
  * water-surface ripple / refraction in the open water (masked away from the suites)
  * drifting god-ray shimmer near the surface
  * slow breathing push-in on the camera

The fish/manta regions are tuned for assets/img/hero-poster.jpg (the 1672x941 resort still).
Usage: python tools/make_hero_video.py <input image> <output dir>
"""
import sys, os, subprocess, math
import numpy as np
import cv2

src, out_dir = sys.argv[1], sys.argv[2]
W, H, FPS, LOOP = 1920, 1080, 24, 16
N = FPS * LOOP
TAU = 2 * math.pi
rng = np.random.default_rng(7)

orig = cv2.imread(src, cv2.IMREAD_COLOR)
OH, OW = orig.shape[:2]

# ---------------------------------------------------------------- source-space regions
# open water where fish swim freely (source image pixels, 1672x941)
WATER_POLY = np.array([(0, 228), (860, 228), (850, 300), (805, 380), (752, 445), (778, 505),
                       (772, 560), (700, 600), (600, 640), (480, 700), (380, 740), (300, 765),
                       (0, 765)], np.int32)
MANTA_BOX = (440, 235, 760, 378)  # x0, y0, x1, y1

water_src = np.zeros((OH, OW), np.uint8)
cv2.fillPoly(water_src, [WATER_POLY], 255)

bg_med = cv2.medianBlur(orig, 31)
diff = np.abs(orig.astype(np.int16) - bg_med.astype(np.int16)).max(2)

# --- fish mask
fish = ((diff > 14) & (water_src > 0)).astype(np.uint8) * 255
mx0, my0, mx1, my1 = MANTA_BOX
fish[my0:my1, mx0:mx1] = 0
fish = cv2.morphologyEx(fish, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
fish = cv2.dilate(fish, np.ones((3, 3), np.uint8))
n, lab, stats, _ = cv2.connectedComponentsWithStats(fish)
fish_ids = [i for i in range(1, n) if 6 <= stats[i, 4] <= 4000]

# --- manta mask: difference from a coarse water estimate (catches the dark wing too)
pad = 60
cx0, cy0, cx1, cy1 = mx0 - pad, my0 - pad, mx1 + pad, my1 + pad
crop = orig[cy0:cy1, cx0:cx1]
small = cv2.resize(crop, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
water_est = cv2.resize(cv2.medianBlur(small, 41), (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_CUBIC)
md = np.abs(crop.astype(np.int16) - water_est.astype(np.int16)).max(2)
mc = (md > 16).astype(np.uint8) * 255
mc[:pad], mc[-pad:], mc[:, :pad], mc[:, -pad:] = 0, 0, 0, 0
mc = cv2.morphologyEx(mc, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
nm, mlab, mst, _ = cv2.connectedComponentsWithStats(mc)
mc = (mlab == 1 + int(np.argmax(mst[1:, 4]))).astype(np.uint8) * 255
ff = mc.copy()
cv2.floodFill(ff, np.zeros((mc.shape[0] + 2, mc.shape[1] + 2), np.uint8), (0, 0), 255)
mc = mc | cv2.bitwise_not(ff)
manta = np.zeros((OH, OW), np.uint8)
manta[cy0:cy1, cx0:cx1] = cv2.dilate(mc, np.ones((3, 3), np.uint8))
manta_hole = cv2.dilate(manta, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))

# --- clean plate: fill the water behind every fish and the manta
hole = np.zeros((OH, OW), np.uint8)
for i in fish_ids:
    hole[lab == i] = 255
hole = cv2.dilate(hole, np.ones((3, 3), np.uint8))
plate = cv2.inpaint(orig, hole, 7, cv2.INPAINT_TELEA)
# the manta leaves a big hole: fill it with smoothly interpolated water (normalized convolution)
valid = (manta_hole == 0).astype(np.float32)
num = cv2.GaussianBlur(plate.astype(np.float32) * valid[..., None], (0, 0), 18)
den = cv2.GaussianBlur(valid, (0, 0), 18)[..., None]
fill = num / np.maximum(den, 1e-4)
mh_soft = cv2.GaussianBlur(manta_hole.astype(np.float32) / 255, (0, 0), 4)[..., None]
plate = (plate * (1 - mh_soft) + fill * mh_soft).astype(np.uint8)
hole = hole | manta_hole
# soften the filled patches so they read as water, not smudges
soft = cv2.GaussianBlur(plate, (0, 0), 4)
hmask = cv2.GaussianBlur(hole.astype(np.float32) / 255, (0, 0), 3)[..., None]
plate = (plate * (1 - hmask) + soft * hmask).astype(np.uint8)

# ---------------------------------------------------------------- base resolution
OVER = 1.08                                # oversize so zoom/ripple never shows edges
BW, BH = int(W * OVER), int(H * OVER)
sc = BW / OW
up = lambda im: cv2.resize(im, (BW, BH), interpolation=cv2.INTER_LANCZOS4)
base_full = up(orig).astype(np.float32)
base = up(plate).astype(np.float32)

water_base = cv2.resize(water_src, (BW, BH), interpolation=cv2.INTER_NEAREST)
row_right = np.array([np.max(np.nonzero(r)[0]) if r.any() else 0 for r in water_base])


def make_sprite(mask_src, x, y, w, h, pad, contrast=False):
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(OW, x + w + pad), min(OH, y + h + pad)
    a = mask_src[y0:y1, x0:x1].astype(np.float32) / 255
    sw, sh = max(1, round((x1 - x0) * sc)), max(1, round((y1 - y0) * sc))
    rgb = cv2.resize(orig[y0:y1, x0:x1], (sw, sh), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
    if contrast:  # keep only the fish's contrast against the water behind it
        rgb = rgb - cv2.resize(plate[y0:y1, x0:x1], (sw, sh), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)
    a = cv2.resize(a, (sw, sh), interpolation=cv2.INTER_LINEAR)
    a = np.clip(cv2.GaussianBlur(a, (0, 0), 0.9 * sc), 0, 1)
    return rgb, a, x0 * sc, y0 * sc


# ---------------------------------------------------------------- fish sprites
fishes = []
for i in fish_ids:
    x, y, w, h, area = stats[i]
    m = ((lab[max(0, y - 2):y + h + 2, max(0, x - 2):x + w + 2] == i) * 255).astype(np.uint8)
    full = np.zeros((OH, OW), np.uint8)
    full[max(0, y - 2):y + h + 2, max(0, x - 2):x + w + 2] = m
    full = cv2.dilate(full, np.ones((3, 3), np.uint8))
    rgb, a, bx, by = make_sprite(full, x, y, w, h, 3, contrast=True)

    # face right: mass sits toward the head, the forked tail is light
    if w > 14:
        cols = a.sum(0)
        cx = (cols * np.arange(len(cols))).sum() / max(cols.sum(), 1e-6)
        if cx < len(cols) / 2 - 0.5:
            rgb, a = rgb[:, ::-1].copy(), a[:, ::-1].copy()

    cyb = int(by + a.shape[0] / 2)
    xr = row_right[min(max(cyb, 0), BH - 1)]
    span = xr + a.shape[1] + 40           # off-frame on the left -> behind the reef on the right
    big = w * h > 300
    fishes.append(dict(rgb=rgb, a=a, x=bx, y=by, xr=xr, span=span, big=big,
                       ph=rng.uniform(0, TAU), ph2=rng.uniform(0, TAU),
                       bob=rng.uniform(1.5, 4.0) * (1.5 if big else 1)))
print(f"{len(fishes)} fish cut out")

# manta sprite
mm_rgb, mm_a, mm_x, mm_y = make_sprite(manta, cx0, cy0, cx1 - cx0, cy1 - cy0, 0)


def paste(dst, rgb, a, x, y, add=False):
    h, w = a.shape
    xi, yi = int(math.floor(x)), int(math.floor(y))
    fx, fy = x - xi, y - yi
    if fx or fy:  # sub-pixel placement keeps slow motion smooth
        M = np.float32([[1, 0, fx], [0, 1, fy]])
        rgb = cv2.warpAffine(rgb, M, (w + 1, h + 1), flags=cv2.INTER_LINEAR)
        a = cv2.warpAffine(a, M, (w + 1, h + 1), flags=cv2.INTER_LINEAR)
        h, w = a.shape
    x0, y0, x1, y1 = max(xi, 0), max(yi, 0), min(xi + w, BW), min(yi + h, BH)
    if x0 >= x1 or y0 >= y1:
        return
    sa = a[y0 - yi:y1 - yi, x0 - xi:x1 - xi, None]
    src = rgb[y0 - yi:y1 - yi, x0 - xi:x1 - xi]
    if add:   # fish: add their contrast onto whatever water they are crossing now
        dst[y0:y1, x0:x1] += src * sa
    else:
        dst[y0:y1, x0:x1] = dst[y0:y1, x0:x1] * (1 - sa) + src * sa


def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- water / light masks
ys, xs = np.mgrid[0:BH, 0:BW].astype(np.float32)
yn, xn = ys / BH, xs / BW
b, g, r = base_full[..., 0], base_full[..., 1], base_full[..., 2]
blue = np.clip((b - r - 25) / 60.0, 0, 1)
warm = np.clip((r - b) / 40.0, 0, 1)
water = blue * (1 - warm)
water *= np.clip(1.25 - xn * 0.9, 0, 1)            # suites live on the right
water = cv2.GaussianBlur(water, (0, 0), 25)
surface = np.clip(1 - yn / 0.45, 0, 1) ** 1.5       # near the waterline
ripple_mask = np.clip(water * 0.6 + surface * 0.9 * np.clip(1.3 - xn, 0, 1), 0, 1)
ripple_mask = cv2.GaussianBlur(ripple_mask, (0, 0), 15)

ray_zone = np.clip(1 - yn / 0.75, 0, 1) * np.clip(1.4 - xn * 1.1, 0, 1)
ray_zone = cv2.GaussianBlur(ray_zone, (0, 0), 30)

# ---------------------------------------------------------------- render
os.makedirs(out_dir, exist_ok=True)
if os.environ.get("PLATE_PREVIEW"):
    cv2.imwrite(os.environ["PLATE_PREVIEW"], plate)
raw = os.path.join(out_dir, "_frames.raw")

with open(raw, "wb") as fh:
    for i in range(N):
        p = i / N                      # 0..1 loop phase
        w = TAU * p
        frame = base.copy()

        # fish: travel exactly one span per loop (seamless), with gentle surges and bobbing
        for f in fishes:
            prog = p + 0.022 * math.sin(w + f["ph"])
            lead = 40 + f["a"].shape[1]   # wrap point sits just off the left edge
            x = (f["x"] + lead + f["span"] * prog) % f["span"] - lead
            y = f["y"] + f["bob"] * math.sin(w * 3 + f["ph2"])
            # tail-beat: tiny horizontal squash
            beat = 1 + 0.035 * math.sin(w * (16 if f["big"] else 22) + f["ph"])
            rgb, a = f["rgb"], f["a"]
            if f["big"]:
                nw = max(1, round(a.shape[1] * beat))
                rgb = cv2.resize(rgb, (nw, a.shape[0]), interpolation=cv2.INTER_LINEAR)
                a = cv2.resize(a, (nw, a.shape[0]), interpolation=cv2.INTER_LINEAR)
            # fade out into the reef, fade in from the far left
            fade = (1 - smooth(f["xr"] - 90 * sc / 2, f["xr"], x + a.shape[1] * 0.6)) * smooth(-a.shape[1], 0, x)
            if fade > 0.01:
                paste(frame, rgb, a * fade, x, y, add=True)

        # manta: slow figure-eight glide, wing-beat and banking
        flap = math.sin(w * 4)
        sy = 1 + 0.045 * flap
        mh, mw = mm_a.shape
        ang = 1.6 * math.sin(w * 2 + 0.6)
        M = cv2.getRotationMatrix2D((mw / 2, mh / 2), ang, 1.0)
        M[1] *= sy
        M[1, 2] += mh * (1 - sy) / 2
        m_rgb = cv2.warpAffine(mm_rgb, M, (mw, mh), flags=cv2.INTER_LINEAR)
        m_a = cv2.warpAffine(mm_a, M, (mw, mh), flags=cv2.INTER_LINEAR)
        paste(frame, m_rgb, m_a,
              mm_x + 26 * sc * math.sin(w),
              mm_y + 9 * sc * math.sin(w * 2) - 3 * sc * flap)

        # ripple displacement (integer cycles per loop => seamless)
        dx = (2.2 * np.sin(yn * 38 + w * 3 + xn * 6) + 1.2 * np.sin(yn * 71 - w * 4 + xn * 11)) * ripple_mask
        dy = (1.6 * np.sin(xn * 29 + w * 2 + yn * 9) + 0.9 * np.cos(xn * 57 - w * 5)) * ripple_mask
        frame = cv2.remap(frame, xs + dx, ys + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

        # god-ray shimmer: slanted bands that drift
        band = xn * 1.0 + yn * 0.35
        rays = 0.5 + 0.5 * np.sin(band * 26 - w * 2) * np.sin(band * 9 + w)
        gain = 1 + 0.10 * rays * ray_zone
        frame = np.clip(frame * gain[..., None], 0, 255)

        # breathing push-in, centred slightly right toward the suites
        z = 1.0 + 0.045 * (1 - math.cos(w)) / 2
        pan = 0.012 * math.sin(w)
        cw, ch = BW / (OVER * z), BH / (OVER * z)
        cx, cy = BW * (0.55 + pan), BH * 0.5
        M = np.float32([[W / cw, 0, -(cx - cw / 2) * W / cw],
                        [0, H / ch, -(cy - ch / 2) * H / ch]])
        out = cv2.warpAffine(frame, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        fh.write(out.astype(np.uint8).tobytes())
        if i % 48 == 0:
            print(f"frame {i}/{N}", flush=True)


def enc(args, name):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", raw] + args + [os.path.join(out_dir, name)]
    subprocess.run(cmd, check=True)


enc(["-c:v", "libx264", "-preset", "slow", "-crf", "25", "-pix_fmt", "yuv420p",
     "-movflags", "+faststart", "-an"], "hero.mp4")
enc(["-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "slow", "-crf", "27",
     "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"], "hero-960.mp4")
os.remove(raw)
print("done")
