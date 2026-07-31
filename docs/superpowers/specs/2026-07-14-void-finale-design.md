# Void Finale — scroll through the end mirror (2026-07-14)

Extends the Hall of Mirrors landing (see `2026-07-13-hall-of-mirrors-landing-design.md`).

## Goal

At the end of the hall, keep scrolling and pass *through* the grand end mirror.
You are transported into a void dimension where the finale preview ("Meet your
reflection." + Begin analysis + trust lines) exists as an actual 3D rendering,
not a DOM overlay.

## Design

**Runway & camera.** `.spacer` grows 650vh → 900vh. Camera travel extends
`Z0=6 → Z1=-74` (still linear in scroll progress). The grand mirror pane sits at
`MIRROR_Z=-58`, i.e. the camera crosses it at p≈0.80; the last ~20% of scroll is
the flight through the void toward the diorama at `VOID_Z=-84`. Chapter
`data-zone`s in `index.html` were compressed accordingly (hero 0–0.11, tenets
between 0.135–0.61).

**The crossing.** All hall objects live in a `corridor` Group; the void lives in
a `voidGroup` (built by `buildVoid()`). As the camera nears the pane, its
emissive flares (`k² ramp` within 9 units). Crossing `MIRROR_Z+0.4` (with
hysteresis to +0.9) triggers `setVoid(on)`: a fixed `.veil-flash` div snaps
white (0.12s in / 0.8s out; gentle 0.45s crossfade under reduced motion), and
140ms in, the worlds swap — group visibilities, `scene.background`
(pearl ↔ #0b0a14), `scene.fog` (pearl fog ↔ none), and `body.void` (recolors
nav + depth gauge for the dark world). Fully reversible by scrolling back; a
sequence counter guards rapid re-crossings.

**The void diorama** (all in `voidGroup`):
- The arch mirror floating free (same `archGeo`/`paneGeo`, scale 1.5), pane
  emissive kept LOW (0.16 ± 0.05 pulse) so type in front stays legible.
- A large radial halo sprite behind it (canvas gradient, toneMapped off) — the
  finale glimpse's bloom, full size.
- The finale set in type as canvas-texture planes using the real webfonts
  (`document.fonts.load` first): title in Italiana (world width 7.2, wider than
  the mirror, floating in front), Begin-analysis pill, trust + smallprint lines
  in Albert Sans. All text uses **dark ink halos** (`shadowBlur`) — invisible
  against the void, crisp separation over the bright pane.
- 800-star shell (`Points`) centred on the diorama, slow rotation; violet
  point light for the crystal frame's sheen.
- Gentle per-object bobbing; pointer parallax steers camera sway/height/gaze
  (`voidMix` eases hall↔void framing). All motion off under reduced motion.

**Interaction.** Raycast picking on the pill and the pane: hover = pointer
cursor + button scale 1.07; click → `analyze.html`; Enter key works too. The
DOM finale is `display:none` in cinema mode (it *is* the void now) but remains
the ending of the static/`?no3d` page, so no-WebGL users keep a CTA.

**Debug hooks.** `window.__hall = { p, void, tick(), snap(), scene, camera,
voidGroup }` — `tick`/`snap` let rAF-less environments (the Claude browser pane)
step the loop; verification there is via `gl.readPixels` probes + luminance
mosaics, since pane screenshots composite stale frames.

## Verified

Crossing both directions (state + veil + body class), void render (pixel
probes: title #f6f4fd strokes over darkened halo, iris button, dimmed pane),
composition (64×30 luminance mosaics), 3D button click → analyze.html, static
fallback intact.
