# SUBMERGE

Website for SUBMERGE, an underwater resort. Static site: `index.html`, `styles.css`, `script.js`, `water.js`. No build step needed.

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

## Interactive water (`water.js`)

The hero video is drawn through a WebGL2 wave simulation. Moving the cursor (or tapping on touch screens) drops ripples that refract the video and catch the light, and small ambient drops keep the surface moving. Browsers without WebGL2 float render targets, or visitors who prefer reduced motion, see the plain video.

## Contact form

The enquiry form validates in the browser. To deliver enquiries, set `data-endpoint` on `#contactForm` in `index.html` to a form service or API URL; the script POSTs the form data there and shows the thank-you state on success.
