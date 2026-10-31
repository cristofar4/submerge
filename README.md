# SUBMERGE

Landing page for SUBMERGE, an underwater resort. Static site: `index.html`, `styles.css`, `script.js`. No build step needed.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Hero video

`assets/video/hero.mp4` (1920×1080) and `hero-960.mp4` (mobile) are a seamless 12-second looping cinemagraph generated from the still `assets/img/hero-poster.jpg`. The loop adds a slow camera push-in, water ripple in the open water and drifting god-ray shimmer. To regenerate it:

```bash
pip install numpy opencv-python-headless   # ffmpeg must also be installed
python3 tools/make_hero_video.py <source-image> assets/video
```
