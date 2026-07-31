# Facial Analysis Studio — a QOVES-style aesthetic report

A fully local, in-browser tool that replicates the methodology of a QOVES Studio
facial aesthetics report: it landmarks your face, takes cephalometric-style
measurements, scores them against sex- and ethnicity-aware ideal ranges, and
produces a biometric dashboard, per-feature breakdown, harmony + aging analysis,
and a sequenced, science-cited non-surgical protocol — plus an annotated overlay
and a "corrected face" morph preview.

**Your photos never leave your device.** Landmarking runs client-side via Google
MediaPipe (WASM). Nothing is uploaded.

## Pages

- **`index.html`** — the landing page: a scroll-through crystal "Hall of Mirrors"
  (Three.js) introducing the four tenets. Keep scrolling at the end and you pass
  *through* the grand mirror into a void dimension where the finale ("Meet your
  reflection." + a clickable Begin-analysis button) is rendered as real 3D
  objects floating in a starfield; scrolling back up returns you to the hall.
  Degrades automatically to a styled static page (with a normal DOM finale) when
  WebGL is missing or slow (force it with `/?no3d`).
- **`analyze.html`** — the analysis app itself.
- **`test.html`** — the core-math self-check (all assertions should pass).

## Run it locally

The site uses ES modules and loads MediaPipe/Three.js from CDNs, so it must be
served over HTTP (opening files directly with `file://` breaks WASM/module
loading). From this folder:

```bash
python3 -m http.server 8000
```

Then open **http://localhost:8000/** in a modern browser (Chrome/Edge/Safari).
First load fetches the MediaPipe model (needs internet once); after that the
analysis is fully local.

## Deploy to Vercel

The whole folder is a static site — no build step, no config needed:

```bash
npx vercel        # from this folder; accept the defaults (no framework, no build)
```

or push it to a Git repo and import it in the Vercel dashboard (Framework preset:
**Other**, build command: none, output directory: root). Notes:

- Vercel serves over HTTPS, which the webcam capture requires.
- `index.html` is the landing page and `analyze.html` the app, so `/` and
  `/analyze.html` both just work; no rewrites needed.
- The MediaPipe model and Three.js load from public CDNs at runtime.

## How to get a good result

1. **Front photo** — neutral expression, hair off the face, even lighting, looking
   straight at the camera. Upload or use the webcam (the live pose readout helps
   you square up).
2. **Side profile** — upload a left or right profile, then tap the guided points
   (hairline → glabella → nose bridge → tip → … → jaw corner → ear notch). This is
   how the profile angles (nasofrontal, nasolabial, Ricketts E-line, gonial angle,
   convexity) are measured exactly.
3. **Max accuracy mode (optional)** — adds ¾ and profile shots from each side and
   triangulates true metric 3D landmarks across views, deriving the profile angles
   from reconstruction instead of taps.

## What it measures

- **Frontal (auto):** facial thirds & fifths, FWHR, canthal tilt, eye almondness &
  spacing, brow position, nose width, mouth/nose ratio, lip fullness, philtrum,
  jaw width, lower-third height, and full midline-flip **symmetry**.
- **Profile (tapped or triangulated):** nasofrontal, nasolabial, facial convexity,
  Ricketts E-line (upper/lower lip, in estimated mm), and gonial angle.

Each metric is scored 0–100 against sex-specific ideal ranges (shifted by your
ethnicity where population data exists), then aggregated into the four QOVES
tenets — **proportion, symmetry, averageness, sexual dimorphism** — region scores,
a harmony score, and the headline biometric dashboard.

## Accuracy tiers (mimicking stereophotogrammetry)

QOVES' consumer reports are 2D-photo + AI, not 3dMD hardware. This tool stacks
three accuracy tiers to match/beat that:

1. **Pose normalization** — landmarks are rotated to true frontal before measuring,
   using MediaPipe's head-pose matrix, so a slightly turned photo doesn't skew
   width ratios or canthal tilt. Turned-too-far photos are flagged.
2. **Metric scale** — automatic px→mm from iris diameter (~11.7 mm), unlocking
   real-millimetre E-line etc. (A credit-card calibration would push this to sub-mm.)
3. **Multi-view triangulation** — in Max mode, several angles reconstruct metric 3D
   landmark positions (DLT triangulation).

## Files

| File | Role |
|---|---|
| `index.html` / `styles.css` | UI shell + report layout |
| `landmarks.js` | MediaPipe loader + canonical landmark indices + profile tap points |
| `geometry3d.js` | pose normalization, iris/card scale, DLT triangulation, math helpers |
| `analysis.js` | measurements, sex/ethnic norms, scoring, tenets/regions/harmony, aging, protocol |
| `morph.js` | Delaunay mesh + triangle-warp corrected-face preview |
| `app.js` | orchestration: capture, detect, analyze, render |
| `test.html` | core-math self-check (no camera needed) |

## Honest limitations

- 2D photos carry measurement error; angles/ratios are estimates, not clinical
  cephalometrics. Absolute-mm values (E-line) are scaled from average face size
  unless a reference is used.
- Landmark indices for soft-tissue points (zygion, gonion, trichion) are the
  closest mesh approximations.
- "Attractiveness" scoring encodes population averages and dimorphism research;
  beauty is subjective and cultural. This is educational, not a verdict.
