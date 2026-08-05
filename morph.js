// morph.js — the "corrected face" morph, built the way QOVES builds theirs.
//
// The shape of the thing:
//
//   1. Vector mapping and landmark alignment. The mesh is measured against the
//      ideal ranges in analysis.js — the same numbers the report scores — and
//      each shortfall becomes a geometric edit on the landmarks that define it:
//      canthal tilt, eyelid aperture (scleral show), brow height, nose and
//      mouth width, lip fullness, bigonial width, FWHR, and the vertical thirds
//      pulled toward 1:1:1. Plus a soft midline symmetrization.
//   2. Spline warp with the surroundings locked. The triangulated warp runs over
//      the face mesh PLUS a pinned frame of border vertices, so a jawline can be
//      pulled tighter and the stretch is absorbed in the tissue around it
//      instead of tearing against a static background.
//   3. Two morphs, contrasted. `formulaic` drives every metric all the way to
//      its ideal — the unrestricted, "would need a surgeon" version. `realistic`
//      scales each edit by how far that feature actually moves without surgery,
//      reusing analysis.js's own improvability table so the morph can never
//      promise more than the protocol in the report does.
//   4. The 0–100 slider blends between the real face and the target.
//
// Everything here is an approximation of a direction, and is labelled as such
// in the UI. Ratios are dimensionless so the metric values (measured on
// pose-normalized points) carry over to pixel space unchanged; canthal tilt is
// applied as a *change* in angle, which is first-order invariant to head roll.

import { IDX } from "./landmarks.js";
import { improvability, METRICS } from "./analysis.js";

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

// ---------------------------------------------------------------------------
// The warp mesh: face landmarks + a pinned border.
// ---------------------------------------------------------------------------
// QOVES stretch specific tissue boundaries "while locking surrounding pixels in
// place". Triangulating the landmarks alone cannot do that — the mesh stops at
// the face oval, so any edit that moves the silhouette (bigonial width, FWHR)
// tears against a background that never moved, and everything outside the oval
// is untouchable.
//
// So the mesh comes in three bands, and the vertices are ordered by band:
//   [0, faceCount)        the landmarks. Driven by the edits.
//   [faceCount, freeCount) two rings just outside the face. Free, but moved only
//                         by what carries out from the face — this is the tissue
//                         the deformation decays through.
//   [freeCount, end)      the photo's frame. Pinned, always.
// The middle band is what makes it look like a face changing shape rather than a
// warp. Without it a widened jaw was absorbed by a handful of enormous triangles
// spanning from the cheek to the photo edge, and the surroundings smeared into
// visible streaks. Landmarks keep index 0..faceCount, so every IDX index still
// addresses the vertex it always did.
export function buildWarpMesh(pxPts, w, h, edge = 6) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pxPts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const hx = (maxX - minX) / 2 || 1, hy = (maxY - minY) / 2 || 1;
  const margin = Math.min(w, h) * 0.02;

  const surround = [];
  for (const s of [1.22, 1.6]) {
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      const x = cx + s * hx * Math.cos(a), y = cy + s * hy * Math.sin(a);
      // Anything past the frame is the frame's job, not the surround's.
      if (x < margin || y < margin || x > w - margin || y > h - margin) continue;
      surround.push({ x, y });
    }
  }
  const border = [];
  for (let i = 0; i <= edge; i++) {
    const t = i / edge;
    border.push({ x: t * w, y: 0 }, { x: t * w, y: h });          // top + bottom, corners included
    if (i > 0 && i < edge) border.push({ x: 0, y: t * h }, { x: w, y: t * h }); // sides, no repeats
  }
  const points = pxPts.map((p) => ({ x: p.x, y: p.y })).concat(surround, border);
  return {
    points, tris: delaunay(points),
    faceCount: pxPts.length,
    freeCount: pxPts.length + surround.length,
  };
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
// Signed perpendicular offset of a point from the midline (± = which side).
function perpOffset(p, axis) {
  const vx = p.x - axis.c.x, vy = p.y - axis.c.y;
  return vx * -axis.u.y + vy * axis.u.x;
}

// Which landmark mirrors which is a property of the mesh topology — the same
// for every face — so for everything the analysis names it is known up front
// rather than searched for. IDX spells the side into the key (eyeROuter /
// eyeLOuter, alaR / alaL), so the table derives itself: swap the first side
// letter and keep the pair only if that twin actually exists in IDX. Add a
// left/right landmark there and it is paired here for free.
const MIRROR = (() => {
  const m = new Map();
  const link = (a, b) => { m.set(a, b); m.set(b, a); };
  for (const [key, val] of Object.entries(IDX)) {
    const twin = key.replace("R", "L");           // first capital R only
    if (twin === key || !(twin in IDX)) continue;
    const other = IDX[twin];
    // Single vertices only. The ring arrays (irisRRing / irisLRing) are ordered
    // around the circle, and index k sits at the same angle on BOTH eyes — so
    // pairing them by index is not a mirror, it is a stretch. The iris is
    // handled as a rigid disc at the end of computeTargets instead.
    if (typeof val === "number" && typeof other === "number") link(val, other);
  }
  return m;
})();

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Falloff radius for an edit, from the size of the thing being edited.
//
// This is the rule that makes the edits actually land. Every metric is a ratio
// between two landmarks, so a bump wide enough to reach the landmark it is
// measured AGAINST moves both ends and changes nothing: a 1.8px lift on the
// upper lip under a 17px radius also lifted the inner lip border 1.6px, and the
// vermilion grew by 0.16px. Sized to the feature instead, the bump dies out
// before it reaches the reference and the measured value moves as intended.
// Floored so a very small feature still carries a little tissue with it.
const span = (featureSize, S) => Math.max(S.eyeW * 0.12, featureSize * 0.5);

// ---------------------------------------------------------------------------
// Ideal-driven edit vectors.
// ---------------------------------------------------------------------------
// One entry per frontal metric the photo can actually show. Each receives the
// landmark positions, the current metric value, and `need` — the signed distance
// to the nearest edge of that metric's ideal band, zero when already inside it —
// and adds landmark displacements through `add(index, dx, dy)`.
//
// Every editor reads the ORIGINAL positions, so the edits compose additively and
// none depends on the order they run in. Where two share a denominator (jaw
// width and FWHR both scale against bizygomatic width) the second is very
// slightly off once the first has moved; at these magnitudes that is far below
// what the warp can show.
//
// Deliberately absent: philtrum length and lower-third height, whose only lever
// is the same vertex the lip and thirds editors already own, and the profile
// metrics (chin projection, gonial angle, E-line) — a frontal photo cannot show
// a change in depth, and pretending otherwise would be the one thing this
// preview must not do.
// Each receives (positions, scaled shortfall, bump, current value, scale hints)
// and calls bump(index, dx, dy, falloffRadius).
export const EDITS = {
  // ---- eyes ----
  // Canthal tilt: raise or drop each outer canthus against its inner canthus.
  // A δ° change is a vertical move of tan(δ)·eyeWidth; y grows downward, so a
  // more upturned eye is negative.
  canthalTilt(P, need, bump, cur, S) {
    const t = Math.tan(need * Math.PI / 180);
    const r = S.eyeW * 0.45;
    bump(IDX.eyeROuter, 0, -t * dist(P[IDX.eyeROuter], P[IDX.eyeRInner]), r);
    bump(IDX.eyeLOuter, 0, -t * dist(P[IDX.eyeLOuter], P[IDX.eyeLInner]), r);
  },
  // Scleral show: almondness is width : height, so raising it closes the lids
  // toward the eye's own centre — QOVES' "narrow the eyelids to reduce the
  // visible white beneath the iris".
  eyeAlmondness(P, need, bump, cur, S) {
    if (!(cur > 0) || !(cur + need > 0)) return;
    const f = cur / (cur + need);
    for (const [top, bot] of [[IDX.eyeRTop, IDX.eyeRBottom], [IDX.eyeLTop, IDX.eyeLBottom]]) {
      const midY = (P[top].y + P[bot].y) / 2;
      const r = span(Math.abs(P[top].y - P[bot].y), S);   // the aperture's own scale
      bump(top, 0, (midY + (P[top].y - midY) * f) - P[top].y, r);
      bump(bot, 0, (midY + (P[bot].y - midY) * f) - P[bot].y, r);
    }
  },
  // ---- brows ----
  // Height is measured in eye-widths above the lid, so δ eye-widths of lift.
  browPosition(P, need, bump, cur, S) {
    const dy = -need * S.eyeW;
    const gap = (Math.abs(P[IDX.browRApex].y - P[IDX.eyeRTop].y) +
                 Math.abs(P[IDX.browLApex].y - P[IDX.eyeLTop].y)) / 2;
    const r = span(gap, S);
    for (const i of [IDX.browRApex, IDX.browRInner, IDX.browRTail,
                     IDX.browLApex, IDX.browLInner, IDX.browLTail]) bump(i, 0, dy, r);
  },
  // ---- nose ----
  noseWidth(P, need, bump, cur, S) {
    if (!(cur > 0)) return;
    const f = (cur + need) / cur;
    const r = span(dist(P[IDX.alaR], P[IDX.alaL]), S);
    const mx = (P[IDX.alaR].x + P[IDX.alaL].x) / 2;
    for (const i of [IDX.alaR, IDX.alaL, IDX.alaRInner, IDX.alaLInner])
      bump(i, (mx + (P[i].x - mx) * f) - P[i].x, 0, r);
  },
  // ---- lips ----
  mouthNose(P, need, bump, cur, S) {
    if (!(cur > 0)) return;
    const f = (cur + need) / cur;
    const r = span(dist(P[IDX.mouthR], P[IDX.mouthL]), S);
    const mx = (P[IDX.mouthR].x + P[IDX.mouthL].x) / 2;
    for (const i of [IDX.mouthR, IDX.mouthL]) bump(i, (mx + (P[i].x - mx) * f) - P[i].x, 0, r);
  },
  // Upper : lower vermilion height. Growing the upper lip moves its outer
  // border away from the inner border, i.e. upward.
  lipRatio(P, need, bump, cur, S) {
    const low = Math.abs(P[IDX.lipBottom].y - P[IDX.lipInnerBottom].y);
    if (!(low > 0)) return;
    const up = Math.abs(P[IDX.lipTop].y - P[IDX.lipInnerTop].y);
    const grow = (cur + need) * low - up;
    const r = span(up, S);
    bump(IDX.lipTop, 0, -grow, r);
    bump(IDX.cupidR, 0, -grow * 0.8, r);
    bump(IDX.cupidL, 0, -grow * 0.8, r);
  },
  // ---- jaw / lower face ----
  // Bigonial : bizygomatic — the jawline pulled tighter or squarer.
  jawWidth(P, need, bump, cur, S) {
    if (!(cur > 0)) return;
    const f = (cur + need) / cur, r = S.halfW * 0.34;
    const mx = (P[IDX.gonionR].x + P[IDX.gonionL].x) / 2;
    for (const i of [IDX.gonionR, IDX.gonionL]) bump(i, (mx + (P[i].x - mx) * f) - P[i].x, 0, r);
  },
  // Facial width-to-height: widen or narrow across the cheekbones.
  fwhr(P, need, bump, cur, S) {
    if (!(cur > 0)) return;
    const f = (cur + need) / cur, r = S.halfW * 0.34;
    const mx = (P[IDX.zygoR].x + P[IDX.zygoL].x) / 2;
    for (const i of [IDX.zygoR, IDX.zygoL, IDX.cheekR, IDX.cheekL])
      bump(i, (mx + (P[i].x - mx) * f) - P[i].x, 0, r);
  },
};

// The vertical thirds, pulled toward 1:1:1 — QOVES' "compress or expand the
// midface". Driven straight off the geometry rather than off a metric value,
// because the report scores the thirds as a 0–100 balance which cannot be
// inverted back into a distance. Hairline and chin are held; the two interior
// boundaries move to the equal split between them.
function editThirds(P, bump, S) {
  const yF = P[IDX.foreheadTop].y, yM = P[IDX.menton].y;
  const total = yM - yF;
  if (!(total > 0)) return;
  const third = total / 3, r = S.halfW * 0.55;
  bump(IDX.glabella, 0, (yF + third) - P[IDX.glabella].y, r);
  bump(IDX.subnasale, 0, (yF + 2 * third) - P[IDX.subnasale].y, r);
}

// Re-measure one metric on a warped landmark set, using the same compute() the
// report scores with — so the loop below is closing on the real number and not
// on this file's idea of it.
const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));
function measureMetric(key, F) {
  const m = METRIC_BY_KEY[key];
  if (!m) return null;
  try {
    const v = m.compute({ F });
    return v != null && isFinite(v) ? v : null;
  } catch { return null; }
}

// Signed distance from a value to the nearest edge of its ideal band; 0 inside.
function shortfall(value, range) {
  if (!range || !isFinite(value)) return 0;
  const [lo, hi] = range;
  if (value < lo) return lo - value;
  if (value > hi) return hi - value;
  return 0;
}

// ---------------------------------------------------------------------------
// computeTargets — where every landmark should move to.
// ---------------------------------------------------------------------------
// opts:
//   faceCount   how many leading entries are real landmarks; the rest are the
//               pinned border from buildWarpMesh and never move.
//   metrics     analysis.js results ([{key, value, range}]); omit for symmetry
//               and canthal lift only.
//   mode        'realistic' (default) | 'formulaic'
//   symStrength how far toward the mirrored face, 0–1.
//
// Pairing rule for the symmetrization. For a mirror pair (i, j) the symmetric
// configuration is i → midpoint(i, reflect(j)) and j → midpoint(j, reflect(i));
// those two targets are exact mirrors of each other, so moving both is what
// closes the gap. Finding j matters more than it looks: a plain "nearest point
// to reflect(i)" search is free to return i ITSELF, and the formula then
// degenerates into "slide toward the midline", which narrows that side of the
// face instead of balancing it — measured on a landmark knocked 20px out of
// true, that left the pair 20.5px apart, further out than it started.
export function computeTargets(pts, opts = {}) {
  const {
    faceCount = pts.length,
    freeCount = faceCount,
    metrics = null,
    mode = "realistic",
    symStrength = 0.55,
  } = opts;
  const total = pts.length;
  const n = Math.min(faceCount, total);          // landmarks: driven
  const moving = Math.max(n, Math.min(freeCount, total)); // + surround: carried
  const targets = pts.map((pp) => ({ x: pp.x, y: pp.y }));
  if (!n) return targets;

  const axis = midlineAxis(pts);
  let halfW = 0;
  for (let i = 0; i < n; i++) halfW = Math.max(halfW, Math.abs(perpOffset(pts[i], axis)));
  const axisTol = halfW * 0.02;

  const dx = new Float64Array(total), dy = new Float64Array(total);
  const isAnchor = new Uint8Array(total);
  const anchors = [];
  const mark = (i) => { if (!isAnchor[i]) { isAnchor[i] = 1; anchors.push(i); } };

  // --- 1. Midline symmetrization ------------------------------------------
  // Nearest OTHER point to each reflection, then move only where the pairing is
  // trustworthy: known topology first, since proximity matching is a poor
  // substitute in a mesh whose vertices sit a few pixels apart — which is
  // exactly the spacing facial asymmetry lives at.
  const partner = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const r = reflect(pts[i], axis);
    let bestJ = -1, bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = (pts[j].x - r.x) ** 2 + (pts[j].y - r.y) ** 2;
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    partner[i] = bestJ;
  }
  const symGain = symStrength * (mode === "formulaic" ? 1 : improvability("symmetry"));
  for (let i = 0; i < n; i++) {
    const j = partner[i];
    const known = MIRROR.get(i);
    const onMidline = Math.abs(perpOffset(pts[i], axis)) <= axisTol;
    // known twin, else a midline point folding onto itself, else mutual agreement
    const src = known !== undefined ? known
      : onMidline ? i
      : (j >= 0 && partner[j] === i ? j : -1);
    if (src < 0) continue;
    const mirrored = reflect(pts[src], axis); // ≈ where pts[i] "should" be
    dx[i] = symGain * 0.5 * (mirrored.x - pts[i].x);
    dy[i] = symGain * 0.5 * (mirrored.y - pts[i].y);
    mark(i);
  }

  // --- 2. Carry the field across the vertices that found no partner --------
  // A field defined only where the pairing held is discontinuous — a matched
  // brow vertex slides 4px while the unmatched one 3px away holds still, and the
  // triangle between them shears into a visible crease. Shepard-weighted
  // interpolation over the anchors makes it continuous, so an unmatched vertex
  // rides with its neighbourhood instead of anchoring it. The Gaussian keeps it
  // local: a brow correction must not drag the chin with it. Border vertices are
  // excluded from receiving, which is what pins the frame.
  const localSq = 2 * (halfW * 0.35) ** 2;
  if (anchors.length) {
    for (let i = 0; i < moving; i++) {
      if (isAnchor[i]) continue;              // a matched vertex may legitimately hold still
      let ax = 0, ay = 0, wsum = 0;
      for (const k of anchors) {
        const d2 = (pts[k].x - pts[i].x) ** 2 + (pts[k].y - pts[i].y) ** 2;
        const w = Math.exp(-d2 / localSq) / (d2 + 1); // → large as d → 0, so continuous
        ax += w * dx[k]; ay += w * dy[k]; wsum += w;
      }
      if (wsum > 0) { dx[i] = ax / wsum; dy[i] = ay / wsum; }
    }
  }

  // --- 3. Ideal-driven edits, laid on top as soft bumps --------------------
  // Every edit spreads over a Gaussian rather than moving a lone vertex: the
  // mesh is dense enough that displacing one landmark and leaving its
  // neighbours 3px away untouched is a crease, not a change. This is the local
  // half of the spline warp — a feature moves with the tissue around it, and
  // the bump dies out before it reaches anything it should not touch.
  //
  // `realistic` scales each edit by how far that feature actually moves without
  // surgery — analysis.js's own improvability table, so the morph can never
  // promise more than the protocol in the report. `formulaic` drives every one
  // of them all the way to the ideal.
  const eyeW = dist(pts[IDX.eyeROuter], pts[IDX.eyeRInner]) || halfW * 0.3;
  const S = { eyeW, halfW };
  // Bump into a given field, so the edit layer can be rebuilt independently of
  // the symmetry layer underneath it.
  const bumpInto = (fx, fy) => (i, ax, ay, radius) => {
    if (i == null || i >= n || (!ax && !ay) || !(radius > 0)) return;
    const twoSig = 2 * radius * radius;
    const o = pts[i];
    for (let k = 0; k < moving; k++) {
      const d2 = (pts[k].x - o.x) ** 2 + (pts[k].y - o.y) ** 2;
      const w = Math.exp(-d2 / twoSig);
      if (w < 1e-3) continue;
      fx[k] += ax * w; fy[k] += ay * w;
    }
  };

  // One light smoothing sweep. Neighbours are otherwise free to disagree — a
  // vertex matched to the wrong partner carries a wrong displacement and, being
  // matched, is never revisited — and a disagreement across a 2px gap is a fold
  // in the warp. The border vertices sit in this average at zero, which is what
  // makes the deformation decay into the frame rather than stop at the
  // silhouette.
  const smoothSq = 2 * (halfW * 0.10) ** 2;
  const smoothInto = (fx, fy, ox, oy) => {
    for (let i = 0; i < moving; i++) {
      let ax = 0, ay = 0, wsum = 0;
      for (let k = 0; k < total; k++) {
        if (k === i) continue;
        const d2 = (pts[k].x - pts[i].x) ** 2 + (pts[k].y - pts[i].y) ** 2;
        if (d2 > smoothSq * 3) continue;
        const w = Math.exp(-d2 / smoothSq);
        ax += w * fx[k]; ay += w * fy[k]; wsum += w;
      }
      ox[i] = wsum > 0 ? fx[i] + 0.15 * (ax / wsum - fx[i]) : fx[i];
      oy[i] = wsum > 0 ? fy[i] + 0.15 * (ay / wsum - fy[i]) : fy[i];
    }
  };

  // Which metrics are in play, and the value each one is being driven to.
  const applied = {};
  const goals = [];
  if (metrics) {
    for (const m of metrics) {
      if (!EDITS[m.key]) continue;
      const need = shortfall(m.value, m.range);
      if (!need) continue;
      const gain = mode === "formulaic" ? 1 : improvability(m.key);
      if (!(gain > 0)) continue;
      applied[m.key] = need * gain;                    // the intent, recorded once
      goals.push({ key: m.key, from: m.value, goal: m.value + need * gain });
    }
  }
  const doThirds = !!metrics && metrics.some((m) => m.key === "thirds");
  const thirdsGain = mode === "formulaic" ? 1 : improvability("thirds");
  if (doThirds) applied.thirds = thirdsGain;

  // Open loop lands short. A bump sized to its own feature still carries the
  // landmark the metric is measured against a little way, and the smoothing
  // sweep takes a further slice, so asking for the whole correction delivers
  // maybe two thirds of it. Re-measure through the metric's OWN compute() from
  // analysis.js and correct what is left. Three rounds is enough to land inside
  // the band, and the loop is cheap: the expensive passes above run once.
  const ex = new Float64Array(total), ey = new Float64Array(total);
  const cx2 = new Float64Array(total), cy2 = new Float64Array(total);
  const ROUNDS = goals.length ? 3 : 1;
  for (let round = 0; round < ROUNDS; round++) {
    if (round === 0) {
      for (const g of goals) EDITS[g.key](pts, g.goal - g.from, bumpInto(ex, ey), g.from, S);
      if (doThirds) editThirds(pts, (i, ax, ay, r) => bumpInto(ex, ey)(i, ax * thirdsGain, ay * thirdsGain, r), S);
    } else {
      // measure where the last round actually landed, then correct the residual
      const F = pts.map((p, i) => ({ x: p.x + dx[i] + ex[i], y: p.y + dy[i] + ey[i], z: 0 }));
      for (const g of goals) {
        const cur = measureMetric(g.key, F);
        if (cur == null) continue;
        const residual = g.goal - cur;
        if (Math.abs(residual) < Math.abs(g.goal - g.from) * 1e-3) continue;
        EDITS[g.key](pts, residual, bumpInto(ex, ey), cur, S);
      }
    }
    for (let i = 0; i < moving; i++) { cx2[i] = dx[i] + ex[i]; cy2[i] = dy[i] + ey[i]; }
    smoothInto(cx2, cy2, cx2, cy2);
    // the measurement above wants the smoothed field, so fold it back in
    for (let i = 0; i < moving; i++) { ex[i] = cx2[i] - dx[i]; ey[i] = cy2[i] - dy[i]; }
  }
  for (let i = 0; i < moving; i++) { targets[i].x = pts[i].x + dx[i] + ex[i]; targets[i].y = pts[i].y + dy[i] + ey[i]; }

  // --- 6. The iris is a rigid disc ----------------------------------------
  // It rides with its eye and is never reshaped. Left to the passes above it
  // gets pulled about independently — measured at ±5.8px of stretch on a 10px
  // iris, which tears the pupil visibly. Give every iris vertex the mean
  // displacement of that eye's own lid landmarks instead.
  for (const [center, ring, lids] of [
    [IDX.irisRCenter, IDX.irisRRing, [IDX.eyeROuter, IDX.eyeRInner, IDX.eyeRTop, IDX.eyeRBottom]],
    [IDX.irisLCenter, IDX.irisLRing, [IDX.eyeLOuter, IDX.eyeLInner, IDX.eyeLTop, IDX.eyeLBottom]],
  ]) {
    let ax = 0, ay = 0;
    for (const l of lids) { ax += targets[l].x - pts[l].x; ay += targets[l].y - pts[l].y; }
    ax /= lids.length; ay /= lids.length;
    for (const i of [center, ...ring]) {
      if (i >= n) continue;                   // 468-point meshes carry no iris
      targets[i].x = pts[i].x + ax;
      targets[i].y = pts[i].y + ay;
    }
  }
  targets.applied = applied;
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
//
// Two things this has to get right, both of which it once got wrong:
//
// 1. `srcPts` are in CANVAS space — app.js caps the working canvas at MAX_SIDE
//    and detects landmarks on that, so a 2160x2880 phone photo carries landmarks
//    in a 540x720 frame. Under a per-triangle transform, `drawImage(image, 0, 0)`
//    would paint the source at its NATURAL size — four times too big — so each
//    triangle clipped a magnified fragment and the face collapsed into a flat
//    skin-coloured blob. Every draw goes through the same (0, 0, W, H) box, which
//    is what puts image space and landmark space in the same units.
// 2. The unwarped photo is laid down first and the mesh warps on top of it. With
//    buildWarpMesh's pinned frame the mesh covers the whole photo, so this is
//    belt and braces — but it also closes the hairline seams between clipped
//    triangles, since there is opaque image behind every one of them.
export function renderMorph(ctx, image, srcPts, targetPts, tris, t) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(image, 0, 0, W, H);
  if (t <= 0.001) return;
  const dest = srcPts.map((s, i) => ({ x: s.x + (targetPts[i].x - s.x) * t, y: s.y + (targetPts[i].y - s.y) * t }));
  for (const [i, j, k] of tris) {
    const s = [srcPts[i], srcPts[j], srcPts[k]];
    const d = [dest[i], dest[j], dest[k]];
    const M = affine(s, d);
    if (!M) continue;
    ctx.save();
    // Clip to a slightly grown triangle. Canvas antialiases a clip path, so two
    // triangles sharing an edge each cover it partially and leave a hairline of
    // whatever was underneath. While the warp is gentle that hairline matches
    // its surroundings and hides; drive the face 30px and the photo underneath
    // no longer lines up, and the mesh appears as a web of bright cracks across
    // the cheek. Growing the CLIP by half a pixel makes neighbours overlap
    // instead of abut. The transform is unchanged, so the sliver is filled from
    // this triangle's own mapping — the same texture its neighbour would draw.
    const gx = (d[0].x + d[1].x + d[2].x) / 3, gy = (d[0].y + d[1].y + d[2].y) / 3;
    ctx.beginPath();
    for (let c = 0; c < 3; c++) {
      const vx = d[c].x - gx, vy = d[c].y - gy;
      const len = Math.hypot(vx, vy) || 1;
      const x = d[c].x + (vx / len) * 0.5, y = d[c].y + (vy / len) * 0.5;
      c ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
    ctx.drawImage(image, 0, 0, W, H);
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
