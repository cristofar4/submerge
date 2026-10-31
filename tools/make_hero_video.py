"""Turn the still hero image into a seamless looping cinemagraph.

Effects (all periodic over LOOP seconds so the clip loops without a seam):
  * slow breathing push-in on the camera
  * water-surface ripple / refraction in the open water (masked away from the suites)
  * drifting god-ray shimmer near the surface
Usage: python tools/make_hero_video.py <input image> <output dir>
"""
import sys, os, subprocess, math
import numpy as np
import cv2

src, out_dir = sys.argv[1], sys.argv[2]
W, H, FPS, LOOP = 1920, 1080, 24, 12
N = FPS * LOOP

img = cv2.imread(src, cv2.IMREAD_COLOR)
# a little oversize so zoom/ripple never shows edges
BW, BH = int(W * 1.08), int(H * 1.08)
base = cv2.resize(img, (BW, BH), interpolation=cv2.INTER_LANCZOS4).astype(np.float32)

ys, xs = np.mgrid[0:BH, 0:BW].astype(np.float32)
yn, xn = ys / BH, xs / BW

# mask: open blue water (blue-dominant, not warm-lit), stronger toward the surface
b, g, r = base[..., 0], base[..., 1], base[..., 2]
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

TAU = 2 * math.pi
os.makedirs(out_dir, exist_ok=True)
raw = os.path.join(out_dir, "_frames.raw")

with open(raw, "wb") as fh:
    for i in range(N):
        p = i / N                      # 0..1 loop phase
        w = TAU * p
        # ripple displacement (integer cycles per loop => seamless)
        dx = (2.2 * np.sin(yn * 38 + w * 3 + xn * 6) + 1.2 * np.sin(yn * 71 - w * 4 + xn * 11)) * ripple_mask
        dy = (1.6 * np.sin(xn * 29 + w * 2 + yn * 9) + 0.9 * np.cos(xn * 57 - w * 5)) * ripple_mask
        frame = cv2.remap(base, xs + dx, ys + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

        # god-ray shimmer: slanted bands that drift
        band = xn * 1.0 + yn * 0.35
        rays = 0.5 + 0.5 * np.sin(band * 26 - w * 2) * np.sin(band * 9 + w)
        gain = 1 + 0.10 * rays * ray_zone
        frame = np.clip(frame * gain[..., None], 0, 255)

        # breathing push-in, centred slightly right toward the suites
        z = 1.0 + 0.045 * (1 - math.cos(w)) / 2
        pan = 0.012 * math.sin(w)
        cw, ch = BW / (1.08 * z), BH / (1.08 * z)
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

enc(["-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
     "-movflags", "+faststart", "-an"], "hero.mp4")
enc(["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1", "-an"], "hero.webm")
enc(["-vf", "scale=960:-2", "-c:v", "libx264", "-preset", "slow", "-crf", "26",
     "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"], "hero-960.mp4")
os.remove(raw)
print("done")
