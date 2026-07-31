# Hall of Mirrors Landing Page — Design Spec

**Date:** 2026-07-13
**Status:** Approved by user
**Project:** Facial Analysis Studio (QOVES clone) — new landing page

## Purpose

A landing page that leads users into the existing facial-analysis app. As the user
scrolls, they traverse a Versailles-like hall of mirrors rendered in a glassy,
iridescent style (material inspiration: the pearlescent feather shaders on
storytelling.noomoagency.com — **no phoenix or bird imagery**). Tone: simple,
modern, beautiful; nothing unrelated to getting your face analyzed. The journey
narrates the four tenets the app scores, ending in a CTA into the analysis.

## User decisions (locked)

1. Content = lead-up to the QOVES-clone analysis app (already built, same folder).
2. Hall style = **iridescent crystal Versailles** (not gilded baroque, not dark void).
3. Copy = **the four tenets** (Symmetry, Proportion, Averageness, Dimorphism);
   restrained, non-overwhelming.
4. Renderer = **Three.js 3D corridor** (not CSS pseudo-3D, not raymarching).
5. No phoenix — iridescence is the borrowed element, not the bird.

## Experience flow (single page, ~600vh scroll)

| Chapter | Scroll zone | Scene | Copy |
|---|---|---|---|
| Threshold | 0–15% | Camera at corridor mouth, haze ahead | H1 "See yourself clearly." + sub + "scroll to enter" cue |
| Bay 1 Symmetry | 15–30% | Pass mirror pair 1, glint | Tenet panel: name + poetic line + 1 plain sentence |
| Bay 2 Proportion | 30–45% | Pass mirror pair 2 | same pattern |
| Bay 3 Averageness | 45–60% | Pass mirror pair 3 | same pattern |
| Bay 4 Dimorphism | 60–75% | Pass mirror pair 4 | same pattern |
| Finale | 75–100% | Corridor ends at grand arched mirror; camera settles | "Meet your reflection" + **Begin analysis** CTA → `analyze.html` + "100% private — runs entirely in your browser." |

Persistent glassy nav (top): wordmark + always-visible **Begin analysis** button.
Minimal footer text in the finale (disclaimer link to analyze.html's footer text).

### Final copy (verbatim — revised 2026-07-14: no section labels)

Per user direction, the journey has **no labels or section dividers** (no "Bay I",
no "The Hall of Mirrors"/"The Final Mirror" eyebrows, no gauge tick marks): one
cohesive stroll where each tenet appears independently as a monumental
jewel-gradient display word + one plain sentence, unboxed over a soft pearl scrim.

- **Threshold:** H1 "See yourself clearly." · sub "A private, research-grade facial
  analysis: measured, scored, and explained in your browser." · cue "scroll to enter"
- **Symmetry.** — *We mirror your features across the midline and measure how
  closely they agree.*
- **Proportion.** — *Your facial thirds, fifths, and width ratios, compared against
  established ideal ranges.*
- **Averageness.** — *How near each feature sits to population norms, tuned to your
  sex and ethnicity.*
- **Dimorphism.** — *Where your features fall on the feminine–masculine spectrum,
  scored toward your own goal.*
- **Finale:** H2 "Meet your reflection." · CTA button "Begin analysis" · trust line
  "100% private. Your photo never leaves this device."

## Visual language

- **Palette:** high-key pearl/lavender haze; scene fog carries depth. Iridescent
  accents: violet → pink → gold → cyan.
- **Arches/frames:** crystal material using `MeshPhysicalMaterial` native
  **thin-film iridescence** (`iridescence`, `iridescenceIOR`, transmission) — no
  custom shader. Instanced along the corridor.
- **Mirrors:** tinted panes sharing one blurred PMREM environment map (no
  per-mirror render targets); fresnel glint animates with camera position.
- **Floor:** glossy fake reflection — flipped duplicate geometry under a
  semi-transparent floor plane.
- **UI glass:** backdrop-filter blur panels, hairline (1px) borders, soft shadow.
  Display serif for headlines + clean sans for body.
- **Motion:** camera lerps toward scroll progress (native scroll, no hijack);
  subtle sway; panels fade/rise on chapter entry.
- Restraint rule: no particle storms; add small floating dust/chandelier sparkle
  ONLY if the scene feels empty after the corridor reads well.

## Architecture

- **`index.html`** → the landing page (new). Current app `index.html` is renamed
  **`analyze.html`**; all internal references (README, any links) updated.
- **New files:** `landing.css`, `landing.js`. One JS file with clearly-sectioned
  code: scene setup · corridor builder · scroll rig · DOM panel sync · fallback.
- **Three.js** from pinned CDN ESM import (same pattern as MediaPipe in
  `landmarks.js`). No build step, no framework — matches the existing project.
- **Scroll rig:** page height ≈600vh via spacer; rAF loop lerps camera.z to
  scrollProgress-mapped position; chapter thresholds toggle `.visible` classes on
  DOM panels (plain scroll-progress checks; no library).

## Resilience

- **No WebGL / load failure:** static gradient hero with identical copy + working
  CTA. The page must never be blank or broken.
- **`prefers-reduced-motion`:** skip camera flight & sway; chapters crossfade as
  plain sections.
- **Performance:** InstancedMesh for arches/frames, fog culling, `pixelRatio`
  clamped ≤2, no shadow maps (gradient-faked AO). Target 60fps on integrated GPUs.
- **Mobile:** works with touch scroll (native scrolling); panels sized for small
  viewports; corridor FOV widened slightly under 720px.

## Verification

1. Serve locally (`python3 -m http.server 8000`), drive in browser: scroll end to
   end — all six chapters trigger at their zones, panels animate in/out.
2. CTA (nav + finale) navigates to `analyze.html`, and the analysis app still fully
   works at its new path (its own self-check `test.html` still passes).
3. Zero console errors on load and during full scroll.
4. Force-fail WebGL (override `WebGLRenderingContext`/use devtools flag) → static
   fallback renders with working CTA.
5. Lighthouse-style sanity: page interactive quickly; Three.js loaded as module
   without blocking first paint (hero text is DOM, visible before the scene).

## Out of scope

- Sound/music, cursor effects, loading-screen animations beyond a simple fade.
- Real per-mirror reflections (render targets) and webcam-in-mirror effects.
- CMS/content management — copy lives in `landing.js` as a constant.
- Any change to the analysis app beyond the `analyze.html` rename.
