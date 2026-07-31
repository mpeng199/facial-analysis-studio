// morph.js — "corrected face" preview via triangle warping.
//
// Works in image-pixel space (NOT pose-normalized). Given the detected frontal
// landmarks we build a target landmark set that is softly symmetrized toward the
// facial midline (QOVES' midline-flip idea) plus a mild canthal lift, then warp
// the photo from source → blended-target using per-triangle affine maps over a
// self-contained Delaunay mesh. A 0–100% slider blends between the real face and
// the corrected target. It is an approximation, labelled as such in the UI.

import { IDX } from "./landmarks.js";

// ---- Delaunay (Bowyer–Watson), self-contained ----
function inCircum(p, a, b, c) {
  const ax = a.x - p.x, ay = a.y - p.y;
  const bx = b.x - p.x, by = b.y - p.y;
  const cx = c.x - p.x, cy = c.y - p.y;
  const d = (ax * ax + ay * ay) * (bx * cy - cx * by) -
            (bx * bx + by * by) * (ax * cy - cx * ay) +
            (cx * cx + cy * cy) * (ax * by - bx * ay);
  // Orientation-aware: assumes CCW; flip sign handles both.
  const orient = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  return orient >= 0 ? d > 0 : d < 0;
}
const sameEdge = (e, f) => (e[0] === f[0] && e[1] === f[1]) || (e[0] === f[1] && e[1] === f[0]);

export function delaunay(points) {
  const n = points.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const dmax = Math.max(maxX - minX, maxY - minY) || 1;
  const midx = (minX + maxX) / 2, midy = (minY + maxY) / 2;
  const pts = points.concat([
    { x: midx - 20 * dmax, y: midy - dmax },
    { x: midx, y: midy + 20 * dmax },
    { x: midx + 20 * dmax, y: midy - dmax },
  ]);
  let tris = [[n, n + 1, n + 2]];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const edges = [];
    tris = tris.filter((t) => {
      if (inCircum(p, pts[t[0]], pts[t[1]], pts[t[2]])) {
        edges.push([t[0], t[1]], [t[1], t[2]], [t[2], t[0]]);
        return false;
      }
      return true;
    });
    for (let a = 0; a < edges.length; a++)
      for (let b = a + 1; b < edges.length; b++)
        if (edges[a] && edges[b] && sameEdge(edges[a], edges[b])) { edges[a] = null; edges[b] = null; }
    for (const e of edges) if (e) tris.push([e[0], e[1], i]);
  }
  return tris.filter((t) => t[0] < n && t[1] < n && t[2] < n);
}

// ---- symmetry axis + reflection ----
function midlineAxis(pts) {
  const central = [IDX.foreheadTop, IDX.glabella, IDX.nasion, IDX.noseTip, IDX.subnasale, IDX.lipTop, IDX.menton]
    .map((i) => pts[i]);
  const cx = central.reduce((s, p) => s + p.x, 0) / central.length;
  const cy = central.reduce((s, p) => s + p.y, 0) / central.length;
  // principal direction via 2x2 covariance
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of central) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // pick the axis closer to vertical
  let ux = Math.cos(theta), uy = Math.sin(theta);
  if (Math.abs(uy) < Math.abs(ux)) { const t = ux; ux = -uy; uy = t; }
  return { c: { x: cx, y: cy }, u: { x: ux, y: uy } };
}
function reflect(p, axis) {
  const vx = p.x - axis.c.x, vy = p.y - axis.c.y;
  const projLen = vx * axis.u.x + vy * axis.u.y;
  const px = projLen * axis.u.x, py = projLen * axis.u.y; // parallel component
  const perpx = vx - px, perpy = vy - py;
  return { x: axis.c.x + px - perpx, y: axis.c.y + py - perpy };
}

// Target landmark set: soft symmetrization toward the midline + mild canthal lift.
export function computeTargets(pts, { symStrength = 0.55, canthalLift = 0.35 } = {}) {
  const axis = midlineAxis(pts);
  const targets = pts.map((pp) => ({ x: pp.x, y: pp.y }));
  for (let i = 0; i < pts.length; i++) {
    const r = reflect(pts[i], axis);
    // nearest original to the reflection = mirror partner
    let bestJ = -1, bestD = Infinity;
    for (let j = 0; j < pts.length; j++) {
      const d = (pts[j].x - r.x) ** 2 + (pts[j].y - r.y) ** 2;
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    const mirroredPartner = reflect(pts[bestJ], axis); // ≈ where pts[i] "should" be
    targets[i].x = pts[i].x + symStrength * 0.5 * (mirroredPartner.x - pts[i].x);
    targets[i].y = pts[i].y + symStrength * 0.5 * (mirroredPartner.y - pts[i].y);
  }
  // mild canthal lift: nudge outer eye corners upward proportional to eye width
  const eyeW = Math.hypot(pts[IDX.eyeROuter].x - pts[IDX.eyeRInner].x, pts[IDX.eyeROuter].y - pts[IDX.eyeRInner].y);
  targets[IDX.eyeROuter].y -= canthalLift * 0.12 * eyeW;
  targets[IDX.eyeLOuter].y -= canthalLift * 0.12 * eyeW;
  return targets;
}

// affine mapping source triangle → dest triangle (maps image coords → canvas)
function affine(s, d) {
  const [s0, s1, s2] = s, [d0, d1, d2] = d;
  const det = s0.x * (s1.y - s2.y) - s0.y * (s1.x - s2.x) + (s1.x * s2.y - s2.x * s1.y);
  if (Math.abs(det) < 1e-9) return null;
  const a = (d0.x * (s1.y - s2.y) - s0.y * (d1.x - d2.x) + (d1.x * s2.y - d2.x * s1.y)) / det;
  const c = (s0.x * (d1.x - d2.x) - d0.x * (s1.x - s2.x) + (s1.x * d2.x - s2.x * d1.x)) / det;
  const e = (s0.x * (s1.y * d2.x - s2.y * d1.x) - s0.y * (s1.x * d2.x - s2.x * d1.x) + d0.x * (s1.x * s2.y - s2.x * s1.y)) / det;
  const b = (d0.y * (s1.y - s2.y) - s0.y * (d1.y - d2.y) + (d1.y * s2.y - d2.y * s1.y)) / det;
  const dd = (s0.x * (d1.y - d2.y) - d0.y * (s1.x - s2.x) + (s1.x * d2.y - s2.x * d1.y)) / det;
  const f = (s0.x * (s1.y * d2.y - s2.y * d1.y) - s0.y * (s1.x * d2.y - s2.x * d1.y) + d0.y * (s1.x * s2.y - s2.x * s1.y)) / det;
  return { a, b, c, d: dd, e, f };
}

// Render the warped face at blend t∈[0,1] (0 = original, 1 = corrected target).
export function renderMorph(ctx, image, srcPts, targetPts, tris, t) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (t <= 0.001) { ctx.drawImage(image, 0, 0, W, H); return; }
  const dest = srcPts.map((s, i) => ({ x: s.x + (targetPts[i].x - s.x) * t, y: s.y + (targetPts[i].y - s.y) * t }));
  for (const [i, j, k] of tris) {
    const s = [srcPts[i], srcPts[j], srcPts[k]];
    const d = [dest[i], dest[j], dest[k]];
    const M = affine(s, d);
    if (!M) continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d[0].x, d[0].y); ctx.lineTo(d[1].x, d[1].y); ctx.lineTo(d[2].x, d[2].y); ctx.closePath();
    ctx.clip();
    ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
