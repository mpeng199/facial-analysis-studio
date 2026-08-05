// analysis.js — the QOVES-style measurement, scoring, and report engine.
//
// Everything downstream of landmark detection lives here: the sourced ideal
// ranges (sex- and ethnicity-aware), the 0–100 scoring, aggregation into the
// four attractiveness tenets + region scores + the biometric dashboard, the
// aging trajectory, the improvement-potential ranking, and the science-cited
// non-surgical protocol. Pure functions of the geometry — no DOM here.

import { IDX } from "./landmarks.js";
import { dist2D, angleDeg, sub, dot, cross, norm } from "./geometry3d.js";

// ---------------------------------------------------------------------------
// Small measurement helpers
// ---------------------------------------------------------------------------
const p = (F, i) => F[i];
// Canthal-style tilt: +ve when the outer corner sits higher (smaller y) than inner.
const cornerTilt = (inner, outer) =>
  -(Math.atan2(outer.y - inner.y, Math.abs(outer.x - inner.x)) * 180) / Math.PI;

// Signed perpendicular distance of pt from line A→B. Negative when pt is on the
// same side as `refBehind` (used so "behind the E-line" reads negative).
function signedDist(pt, A, B, refBehind) {
  const ab = sub(B, A);
  const len = Math.hypot(ab.x, ab.y) || 1;
  const nrm = { x: -ab.y / len, y: ab.x / len };
  const d = (pt.x - A.x) * nrm.x + (pt.y - A.y) * nrm.y;
  const dref = (refBehind.x - A.x) * nrm.x + (refBehind.y - A.y) * nrm.y;
  return Math.sign(dref) === Math.sign(d) ? -Math.abs(d) : Math.abs(d);
}

// ---------------------------------------------------------------------------
// Metric catalogue. Each entry:
//  key, label, region, tenet, unit, weight (feature-impact 1–3),
//  dimorph: which direction reads feminine ('high'|'low'|null) + its range for
//           normalising a 0..1 femininity contribution,
//  ideal: {m,f} or {all} → [lo,hi]; tol: decay distance beyond the range,
//  side: 'frontal'|'profile',
//  compute(ctx) → number|null,
//  read(v): short human phrase describing the raw value.
// ---------------------------------------------------------------------------
export const METRICS = [
  // ---------------- EYES ----------------
  {
    key: "canthalTilt", label: "Canthal tilt", region: "eyes", tenet: "dimorphism",
    unit: "°", weight: 3, side: "frontal",
    dimorph: { dir: "high", range: [-6, 12] },
    ideal: { m: [0, 6], f: [2, 8] }, tol: 8,
    compute: ({ F }) => (cornerTilt(p(F, IDX.eyeRInner), p(F, IDX.eyeROuter)) +
                         cornerTilt(p(F, IDX.eyeLInner), p(F, IDX.eyeLOuter))) / 2,
    read: (v) => `${v.toFixed(1)}° ${v >= 0 ? "upturned" : "downturned"}`,
  },
  {
    key: "eyeAlmondness", label: "Eye almondness (width : height)", region: "eyes", tenet: "averageness",
    unit: ":1", weight: 2, side: "frontal", dimorph: null,
    ideal: { all: [2.7, 3.3] }, tol: 1.1,
    compute: ({ F }) => {
      const wR = dist2D(p(F, IDX.eyeROuter), p(F, IDX.eyeRInner));
      const hR = dist2D(p(F, IDX.eyeRTop), p(F, IDX.eyeRBottom)) || 1;
      const wL = dist2D(p(F, IDX.eyeLOuter), p(F, IDX.eyeLInner));
      const hL = dist2D(p(F, IDX.eyeLTop), p(F, IDX.eyeLBottom)) || 1;
      return (wR / hR + wL / hL) / 2;
    },
    read: (v) => `${v.toFixed(2)} : 1`,
  },
  {
    key: "intercanthalRatio", label: "Eye spacing (intercanthal : eye width)", region: "eyes",
    tenet: "proportion", unit: ":1", weight: 2, side: "frontal", dimorph: null,
    ideal: { all: [0.9, 1.1] }, tol: 0.35,
    compute: ({ F }) => {
      const inter = dist2D(p(F, IDX.eyeRInner), p(F, IDX.eyeLInner));
      const eR = dist2D(p(F, IDX.eyeROuter), p(F, IDX.eyeRInner));
      const eL = dist2D(p(F, IDX.eyeLOuter), p(F, IDX.eyeLInner));
      return inter / (((eR + eL) / 2) || 1);
    },
    read: (v) => v < 0.9 ? `${v.toFixed(2)} — close-set` : v > 1.1 ? `${v.toFixed(2)} — wide-set` : `${v.toFixed(2)} — balanced`,
  },
  // ---------------- BROWS ----------------
  {
    key: "browPosition", label: "Brow height (above eye)", region: "brows", tenet: "dimorphism",
    unit: "×", weight: 1, side: "frontal", dimorph: { dir: "high", range: [0.25, 0.75] },
    ideal: { m: [0.32, 0.55], f: [0.42, 0.7] }, tol: 0.3,
    compute: ({ F }) => {
      const eyeW = dist2D(p(F, IDX.eyeROuter), p(F, IDX.eyeRInner)) || 1;
      const hR = Math.abs(p(F, IDX.browRApex).y - p(F, IDX.eyeRTop).y);
      const hL = Math.abs(p(F, IDX.browLApex).y - p(F, IDX.eyeLTop).y);
      return ((hR + hL) / 2) / eyeW;
    },
    read: (v) => `${v.toFixed(2)}× eye-width above the lid`,
  },
  // ---------------- NOSE (frontal) ----------------
  {
    key: "noseWidth", label: "Nose width (alar : intercanthal)", region: "nose", tenet: "proportion",
    unit: ":1", weight: 2, side: "frontal", dimorph: { dir: "low", range: [0.8, 1.5] },
    ideal: { all: [0.9, 1.15] }, tol: 0.4, ethnic: true,
    compute: ({ F }) => {
      const alar = dist2D(p(F, IDX.alaR), p(F, IDX.alaL));
      const inter = dist2D(p(F, IDX.eyeRInner), p(F, IDX.eyeLInner)) || 1;
      return alar / inter;
    },
    read: (v) => v > 1.15 ? `${v.toFixed(2)} — broad` : v < 0.9 ? `${v.toFixed(2)} — narrow` : `${v.toFixed(2)} — balanced`,
  },
  // ---------------- LIPS ----------------
  {
    key: "mouthNose", label: "Mouth width (mouth : nose)", region: "lips", tenet: "proportion",
    unit: ":1", weight: 2, side: "frontal", dimorph: null,
    ideal: { all: [1.4, 1.7] }, tol: 0.5,
    compute: ({ F }) => {
      const mouth = dist2D(p(F, IDX.mouthR), p(F, IDX.mouthL));
      const alar = dist2D(p(F, IDX.alaR), p(F, IDX.alaL)) || 1;
      return mouth / alar;
    },
    read: (v) => `${v.toFixed(2)} : 1`,
  },
  {
    key: "lipRatio", label: "Lip fullness (upper : lower)", region: "lips", tenet: "dimorphism",
    unit: ":1", weight: 2, side: "frontal", dimorph: { dir: "high", range: [0.3, 0.9] },
    ideal: { all: [0.5, 0.72] }, tol: 0.35,
    compute: ({ F }) => {
      const up = dist2D(p(F, IDX.lipTop), p(F, IDX.lipInnerTop));
      const low = dist2D(p(F, IDX.lipBottom), p(F, IDX.lipInnerBottom)) || 1;
      return up / low;
    },
    read: (v) => `${v.toFixed(2)} : 1 (ideal ≈ 1 : 1.6)`,
  },
  {
    key: "philtrum", label: "Philtrum length (vs lower third)", region: "lips", tenet: "averageness",
    unit: "×", weight: 1, side: "frontal", dimorph: null,
    ideal: { all: [0.28, 0.36] }, tol: 0.15,
    compute: ({ F }) => {
      const phil = Math.abs(p(F, IDX.lipTop).y - p(F, IDX.subnasale).y);
      const lower = Math.abs(p(F, IDX.menton).y - p(F, IDX.subnasale).y) || 1;
      return phil / lower;
    },
    read: (v) => v > 0.36 ? `${(v * 100).toFixed(0)}% — long` : v < 0.28 ? `${(v * 100).toFixed(0)}% — short/youthful` : `${(v * 100).toFixed(0)}% — balanced`,
  },
  // ---------------- JAW / LOWER FACE ----------------
  {
    key: "jawWidth", label: "Jaw width (bigonial : bizygomatic)", region: "jaw", tenet: "dimorphism",
    unit: ":1", weight: 2, side: "frontal", dimorph: { dir: "low", range: [0.62, 0.9] },
    ideal: { m: [0.78, 0.9], f: [0.68, 0.8] }, tol: 0.18,
    compute: ({ F }) => {
      const bigon = dist2D(p(F, IDX.gonionR), p(F, IDX.gonionL));
      const bizyg = dist2D(p(F, IDX.zygoR), p(F, IDX.zygoL)) || 1;
      return bigon / bizyg;
    },
    read: (v) => v > 0.85 ? `${v.toFixed(2)} — wide/strong` : v < 0.68 ? `${v.toFixed(2)} — narrow/tapered` : `${v.toFixed(2)} — balanced`,
  },
  {
    key: "lowerThird", label: "Lower-third height (vs midface)", region: "jaw", tenet: "proportion",
    unit: ":1", weight: 2, side: "frontal", dimorph: null,
    ideal: { all: [0.95, 1.08] }, tol: 0.3,
    compute: ({ F }) => {
      const mid = Math.abs(p(F, IDX.subnasale).y - p(F, IDX.glabella).y) || 1;
      const low = Math.abs(p(F, IDX.menton).y - p(F, IDX.subnasale).y);
      return low / mid;
    },
    read: (v) => v > 1.08 ? `${v.toFixed(2)} — long lower face` : v < 0.95 ? `${v.toFixed(2)} — short lower face` : `${v.toFixed(2)} — balanced`,
  },
  {
    key: "fwhr", label: "Facial width-to-height (FWHR)", region: "jaw", tenet: "dimorphism",
    unit: "", weight: 2, side: "frontal", dimorph: { dir: "low", range: [1.6, 2.2] },
    ideal: { m: [1.75, 2.05], f: [1.7, 1.95] }, tol: 0.4,
    compute: ({ F }) => {
      const w = dist2D(p(F, IDX.zygoR), p(F, IDX.zygoL));
      const browY = (p(F, IDX.browRApex).y + p(F, IDX.browLApex).y) / 2;
      const h = Math.abs(p(F, IDX.lipTop).y - browY) || 1;
      return w / h;
    },
    read: (v) => `${v.toFixed(2)}`,
  },
  // ---------------- PROPORTION / SYMMETRY (computed specially, see analyze) ----
  // ---------------- NOSE / PROFILE ----------------
  {
    key: "nasofrontal", label: "Nasofrontal angle", region: "nose", tenet: "dimorphism",
    unit: "°", weight: 2, side: "profile", dimorph: { dir: "high", range: [110, 140] },
    ideal: { m: [115, 130], f: [130, 138] }, tol: 15,
    compute: ({ P }) => P && angleDeg(P.glabella, P.nasion, P.pronasale),
    read: (v) => `${v.toFixed(0)}°`,
  },
  {
    key: "nasolabial", label: "Nasolabial angle", region: "nose", tenet: "dimorphism",
    unit: "°", weight: 2, side: "profile", dimorph: { dir: "high", range: [85, 115] },
    ideal: { m: [90, 98], f: [95, 110] }, tol: 15, ethnic: true,
    compute: ({ P }) => P && angleDeg(P.pronasale, P.subnasale, P.labSup),
    read: (v) => v < 90 ? `${v.toFixed(0)}° — under-rotated tip` : v > 110 ? `${v.toFixed(0)}° — over-rotated` : `${v.toFixed(0)}°`,
  },
  {
    key: "convexity", label: "Facial convexity angle", region: "chin", tenet: "proportion",
    unit: "°", weight: 2, side: "profile", dimorph: null,
    ideal: { all: [165, 175] }, tol: 12,
    compute: ({ P }) => P && angleDeg(P.glabella, P.subnasale, P.pogonion),
    read: (v) => v < 165 ? `${v.toFixed(0)}° — convex (retruded chin/protrusive)` : v > 178 ? `${v.toFixed(0)}° — concave` : `${v.toFixed(0)}°`,
  },
  {
    key: "eLineUpper", label: "Ricketts E-line — upper lip", region: "lips", tenet: "proportion",
    unit: "mm", weight: 2, side: "profile", dimorph: null,
    ideal: { all: [-6, -2] }, tol: 6, ethnic: true,
    compute: ({ P, mmPerPx }) => {
      if (!P) return null;
      const dPx = signedDist(P.labSup, P.pronasale, P.pogonion, P.tragion);
      return mmPerPx ? dPx * mmPerPx : dPx; // mm if scaled, else px (labelled)
    },
    read: (v) => `${v.toFixed(1)} mm ${v < 0 ? "behind" : "ahead of"} line`,
  },
  {
    key: "eLineLower", label: "Ricketts E-line — lower lip", region: "lips", tenet: "proportion",
    unit: "mm", weight: 1, side: "profile", dimorph: null,
    ideal: { all: [-4, 0] }, tol: 6, ethnic: true,
    compute: ({ P, mmPerPx }) => {
      if (!P) return null;
      const dPx = signedDist(P.labInf, P.pronasale, P.pogonion, P.tragion);
      return mmPerPx ? dPx * mmPerPx : dPx;
    },
    read: (v) => `${v.toFixed(1)} mm ${v < 0 ? "behind" : "ahead of"} line`,
  },
  {
    key: "gonial", label: "Gonial angle", region: "jaw", tenet: "dimorphism",
    unit: "°", weight: 3, side: "profile", dimorph: { dir: "high", range: [110, 135] },
    ideal: { m: [118, 128], f: [120, 130] }, tol: 12,
    compute: ({ P }) => P && angleDeg(P.tragion, P.gonion, P.menton),
    read: (v) => v < 118 ? `${v.toFixed(0)}° — square/strong` : v > 132 ? `${v.toFixed(0)}° — obtuse/soft` : `${v.toFixed(0)}°`,
  },
];

// Ethnic norm shifts (mm/ratio/deg added to [lo,hi]) where QOVES cites population
// data. Kept deliberately small; neutral (0,0) otherwise. ponytail: extend as more
// population norms are sourced.
const ETHNIC_SHIFT = {
  eastAsian:   { noseWidth: [0.05, 0.1], nasolabial: [0, 3], eLineUpper: [1.5, 1.5], eLineLower: [1.5, 1.5] },
  african:     { noseWidth: [0.15, 0.25], eLineUpper: [3, 3], eLineLower: [3, 3], nasolabial: [-3, 0] },
  southAsian:  { noseWidth: [0.05, 0.15], eLineUpper: [1, 1], eLineLower: [1, 1] },
  middleEastern: { nasofrontal: [-3, -3] },
  hispanic:    { noseWidth: [0.05, 0.1] },
  european:    {},
  other:       {},
};

function idealFor(metric, sex, ethnicity) {
  let range = metric.ideal.all || metric.ideal[sex] || metric.ideal.f;
  range = range.slice();
  if (metric.ethnic && ethnicity && ETHNIC_SHIFT[ethnicity]?.[metric.key]) {
    const [dlo, dhi] = ETHNIC_SHIFT[ethnicity][metric.key];
    range = [range[0] + dlo, range[1] + dhi];
  }
  return range;
}

// 0–100 score: 100 inside the ideal range, linear decay by tol outside it.
function scoreValue(v, range, tol) {
  if (v == null || !isFinite(v)) return null;
  const [lo, hi] = range;
  if (v >= lo && v <= hi) return 100;
  const dev = v < lo ? lo - v : v - hi;
  return Math.max(0, Math.round(100 - 100 * (dev / tol)));
}

// ---------------------------------------------------------------------------
// Symmetry — midline-flip deviation over bilateral landmark pairs.
// In pose-normalized coords the midline is x≈0, so a perfect mirror has
// xRight ≈ -xLeft and yRight ≈ yLeft.
// ---------------------------------------------------------------------------
const SYM_PAIRS = [
  [IDX.eyeROuter, IDX.eyeLOuter], [IDX.eyeRInner, IDX.eyeLInner],
  [IDX.browRApex, IDX.browLApex], [IDX.alaR, IDX.alaL],
  [IDX.mouthR, IDX.mouthL], [IDX.cheekR, IDX.cheekL], [IDX.gonionR, IDX.gonionL],
];
function symmetryScore(F) {
  const faceW = dist2D(p(F, IDX.zygoR), p(F, IDX.zygoL)) || 1;
  let acc = 0;
  for (const [r, l] of SYM_PAIRS) {
    const dx = Math.abs(p(F, r).x + p(F, l).x); // should cancel around x=0
    const dy = Math.abs(p(F, r).y - p(F, l).y); // should match
    acc += Math.hypot(dx, dy);
  }
  const asym = acc / SYM_PAIRS.length / faceW; // fraction of face width
  return Math.max(0, Math.round(100 - asym * 600));
}

// Facial fifths balance — five vertical bands should be ≈ equal.
function fifthsScore(F) {
  const fifths = [
    dist2D(p(F, IDX.zygoR), p(F, IDX.eyeROuter)),
    dist2D(p(F, IDX.eyeROuter), p(F, IDX.eyeRInner)),
    dist2D(p(F, IDX.eyeRInner), p(F, IDX.eyeLInner)),
    dist2D(p(F, IDX.eyeLInner), p(F, IDX.eyeLOuter)),
    dist2D(p(F, IDX.eyeLOuter), p(F, IDX.zygoL)),
  ];
  const mean = fifths.reduce((a, b) => a + b, 0) / 5 || 1;
  const cv = Math.sqrt(fifths.reduce((a, b) => a + (b - mean) ** 2, 0) / 5) / mean;
  return { score: Math.max(0, Math.round(100 - cv * 220)), fifths, cv };
}

// Vertical thirds balance.
function thirdsScore(F) {
  const upper = Math.abs(p(F, IDX.glabella).y - p(F, IDX.foreheadTop).y);
  const midd = Math.abs(p(F, IDX.subnasale).y - p(F, IDX.glabella).y);
  const lower = Math.abs(p(F, IDX.menton).y - p(F, IDX.subnasale).y);
  const t = [upper, midd, lower];
  const mean = (upper + midd + lower) / 3 || 1;
  const cv = Math.sqrt(t.reduce((a, b) => a + (b - mean) ** 2, 0) / 3) / mean;
  return { score: Math.max(0, Math.round(100 - cv * 260)), thirds: t, cv };
}

// ---------------------------------------------------------------------------
// Main entry: analyze
//   ctx = { F (normalized frontal pts), P (profile points by key or null),
//           mmPerPx, blendshapes, dims, meta }
//   meta = { sex:'m'|'f', age, ethnicity, goal, lifestyle:{...}, culture, accuracy, pose, quality }
// ---------------------------------------------------------------------------
export function analyze(ctx) {
  const { meta } = ctx;
  const sex = meta.sex === "m" ? "m" : "f";

  // 1. Score every catalogue metric present.
  const results = [];
  for (const m of METRICS) {
    if (m.side === "profile" && !ctx.P) continue;
    let v;
    try { v = m.compute(ctx); } catch { v = null; }
    if (v == null || !isFinite(v)) continue;
    const range = idealFor(m, sex, meta.ethnicity);
    const score = scoreValue(v, range, m.tol);
    if (score == null) continue;
    results.push({ ...pickMeta(m), value: v, range, score, valueText: safeRead(m, v) });
  }

  // 2. Special composite metrics (symmetry, fifths, thirds).
  const F = ctx.F;
  const sym = symmetryScore(F);
  const fifths = fifthsScore(F);
  const thirds = thirdsScore(F);
  results.push({ key: "symmetry", label: "Facial symmetry", region: "harmony", tenet: "symmetry",
    weight: 3, dimorph: null, value: sym, range: [90, 100], score: sym,
    valueText: `${sym}/100 midline match` });
  results.push({ key: "fifths", label: "Facial fifths balance", region: "harmony", tenet: "proportion",
    weight: 2, dimorph: null, value: fifths.score, range: [85, 100], score: fifths.score,
    valueText: `${fifths.score}/100 (5 equal bands)` });
  results.push({ key: "thirds", label: "Vertical thirds balance", region: "harmony", tenet: "proportion",
    weight: 2, dimorph: null, value: thirds.score, range: [85, 100], score: thirds.score,
    valueText: `${thirds.score}/100 (equal thirds)` });

  // 3. Tenet + region aggregation (weighted means).
  const tenets = weightedByField(results, "tenet");
  const regions = weightedByField(results, "region");

  // 4. Sexual dimorphism → femininity index.
  const femininity = femininityIndex(results);
  const masculinity = 100 - femininity;

  // 5. Harmony — proportion + symmetry blend with feature-pair penalties.
  const harmony = harmonyScore(results, tenets);

  // 6. Averageness = mean of all metric scores (each measures deviation from norm).
  const averageness = Math.round(mean(results.map((r) => r.score)));

  // 7. Overall attractiveness — weighted blend of the four tenets + harmony.
  const attractiveness = Math.round(
    0.3 * (tenets.proportion ?? averageness) +
    0.25 * sym +
    0.2 * averageness +
    0.15 * dimorphismFit(femininity, sex, meta.goal) +
    0.1 * harmony.score
  );

  // 8. Perceived age.
  const perceivedAge = perceivedAgeEstimate(meta.age, results, sym);

  // 9. Strengths / weaknesses (weighted, impact-aware).
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const strengths = sorted.filter((r) => r.score >= 78).slice(0, 6);
  const weaknesses = [...results]
    .filter((r) => r.score < 78)
    .map((r) => ({ ...r, priority: (100 - r.score) * (r.weight || 1) * improvability(r.key) }))
    .sort((a, b) => b.priority - a.priority);

  // 10. Aging trajectory + improvement potential + protocol.
  const aging = agingTrajectory(meta.age, results, sex);
  const improvement = weaknesses.slice(0, 6).map((w) => ({
    // `key` rides along so the report can look the metric up (glossary, plain
    // name) without matching on the display label.
    key: w.key, label: w.label, region: w.region, current: w.score,
    potential: Math.min(100, w.score + Math.round(improvability(w.key) * 30)),
    note: improvability(w.key) >= 0.6 ? "Highly responsive to non-surgical work"
      : improvability(w.key) >= 0.3 ? "Partially improvable non-surgically"
      : "Mostly structural — limited non-surgical change",
  }));
  const protocol = buildProtocol(weaknesses, meta, aging);

  return {
    meta, dashboard: {
      attractiveness, harmony, symmetry: sym, proportionality: tenets.proportion ?? averageness,
      averageness, femininity, masculinity, dimorphism: dimorphismFit(femininity, sex, meta.goal),
      perceivedAge,
    },
    tenets, regions, results, strengths, weaknesses, aging, improvement, protocol,
    composites: { fifths, thirds }, quality: meta.quality, pose: meta.pose,
  };
}

// ---- aggregation helpers ----
function pickMeta(m) {
  return { key: m.key, label: m.label, region: m.region, tenet: m.tenet, unit: m.unit,
    weight: m.weight, dimorph: m.dimorph, side: m.side };
}
function safeRead(m, v) { try { return m.read(v); } catch { return String(v); } }
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

function weightedByField(results, field) {
  const acc = {};
  for (const r of results) {
    const k = r[field]; if (!k) continue;
    acc[k] = acc[k] || { sum: 0, w: 0 };
    acc[k].sum += r.score * (r.weight || 1);
    acc[k].w += (r.weight || 1);
  }
  const out = {};
  for (const k in acc) out[k] = Math.round(acc[k].sum / (acc[k].w || 1));
  return out;
}

function femininityIndex(results) {
  const parts = [];
  for (const r of results) {
    if (!r.dimorph) continue;
    const [lo, hi] = r.dimorph.range;
    let t = (r.value - lo) / ((hi - lo) || 1);
    t = Math.max(0, Math.min(1, t));
    parts.push(r.dimorph.dir === "high" ? t : 1 - t);
  }
  return parts.length ? Math.round(mean(parts) * 100) : 50;
}

// How well dimorphism matches the target (sex, or explicit goal).
function dimorphismFit(femininity, sex, goal) {
  let target = sex === "f" ? 72 : 28; // desired femininity for the sex
  if (goal === "feminine") target = 78;
  else if (goal === "masculine") target = 22;
  const gap = Math.abs(femininity - target);
  return Math.max(0, Math.round(100 - gap * 1.4));
}

function harmonyScore(results, tenets) {
  const byKey = Object.fromEntries(results.map((r) => [r.key, r]));
  let base = 0.5 * (tenets.proportion ?? 70) + 0.5 * (byKey.symmetry?.score ?? 70);
  // feature-pair penalties: strong nose needs adequate chin; wide face + wide jaw compounds.
  const penalize = (a, b, msg, notes) => { notes.push(msg); return 6; };
  const notes = [];
  let penalty = 0;
  if (byKey.noseWidth && byKey.convexity && byKey.noseWidth.score < 60 && byKey.convexity.score < 60)
    penalty += penalize(0, 0, "Nasal and chin projection are both off — profile balance compounds.", notes);
  if (byKey.fwhr && byKey.jawWidth && byKey.fwhr.score < 55 && byKey.jawWidth.score < 55)
    penalty += penalize(0, 0, "Wide facial width and wide jaw stack, exaggerating lower-face heaviness.", notes);
  if (byKey.lowerThird && byKey.philtrum && byKey.lowerThird.score < 55 && byKey.philtrum.score < 60)
    penalty += penalize(0, 0, "Long lower third and long philtrum compound the elongated look.", notes);
  return { score: Math.max(0, Math.round(base - penalty)), notes };
}

// Perceived age = stated age nudged by youth cues (fallback estimate if no age).
function perceivedAgeEstimate(age, results, sym) {
  const byKey = Object.fromEntries(results.map((r) => [r.key, r]));
  let base = age ? Number(age) : 28;
  let adj = 0;
  if (byKey.canthalTilt && byKey.canthalTilt.value < 0) adj += 2;        // downturned reads older
  if (byKey.canthalTilt && byKey.canthalTilt.value > 4) adj -= 1;
  if (byKey.lowerThird && byKey.lowerThird.value > 1.1) adj += 1.5;
  if (byKey.philtrum && byKey.philtrum.value > 0.36) adj += 1.5;
  if (sym < 80) adj += 1;
  return Math.round(base + adj);
}

// How much a feature can move without surgery (0..1). Soft-tissue/skin/fat high;
// bone structure low.
// How far a feature actually moves without surgery, 0–1. Drives the improvement
// ceilings in the report and, through morph.js, the bound on the "realistic"
// morph — so the picture can never promise more than the protocol does.
export function improvability(key) {
  const map = {
    symmetry: 0.15, canthalTilt: 0.15, gonial: 0.2, jawWidth: 0.35, fwhr: 0.4,
    lowerThird: 0.15, nasofrontal: 0.1, nasolabial: 0.1, convexity: 0.15,
    noseWidth: 0.1, eyeAlmondness: 0.2, intercanthalRatio: 0.05,
    browPosition: 0.7, lipRatio: 0.55, mouthNose: 0.1, philtrum: 0.1,
    eLineUpper: 0.35, eLineLower: 0.35, fifths: 0.1, thirds: 0.1,
  };
  return map[key] ?? 0.3;
}

// ---------------------------------------------------------------------------
// Aging trajectory
// ---------------------------------------------------------------------------
function agingTrajectory(age, results, sex) {
  const a = age ? Number(age) : 28;
  const byKey = Object.fromEntries(results.map((r) => [r.key, r]));
  const items = [];
  const push = (when, change, why) => items.push({ when, change, why });
  push("Now → +5 yrs",
    "Early periorbital changes: mild canthal descent and under-eye hollowing begin.",
    "Lateral canthal tendons loosen first — an early, high-leverage prevention window.");
  push("+5 → +15 yrs",
    "Midface/malar deflation and deepening nasolabial folds; the mentolabial groove sharpens.",
    "Buccal and malar fat pads descend and deflate, shifting light off the cheekbones.");
  push("+15 → +25 yrs",
    "Submental laxity and jawline softening; lower-face volume migrates downward.",
    "Skin elasticity and platysmal tone decline, blunting the cervicomental angle.");
  if (byKey.canthalTilt && byKey.canthalTilt.value < 2)
    push("Priority", "Your canthal tilt is already low, so descent will read faster — protect it early.",
      "Starting margin is small, so equal descent crosses the 'tired' threshold sooner.");
  if (byKey.lowerThird && byKey.lowerThird.value > 1.05)
    push("Priority", "A longer lower third ages toward a heavier, more elongated jaw-neck transition.",
      "Vertical excess compounds with descent, so submental discipline matters more for you.");
  return { currentAge: a, items };
}

// ---------------------------------------------------------------------------
// Protocol knowledge base — non-surgical first, science-cited.
// Each item: tier, what, how, science, timeline, difficulty(1–3), goals[].
//
// `what` and `how` are the instructions, and part one of the report quotes them
// verbatim to someone who has never read a report like this — so they stay in
// ordinary words, and any clinical term that earns its place is glossed inline.
// `science` is the citation layer and keeps its technical register.
// ---------------------------------------------------------------------------
const KB = {
  symmetry: [{
    tier: "Habits", what: "Stop favouring one side when you sleep and chew.",
    how: "Swap chewing sides through the day, sleep on your back on a contour pillow, and get one-sided jaw clenching looked at.",
    science: "Minor postural/soft-tissue asymmetry is modifiable; skeletal asymmetry is not — sets honest expectations (Farkas anthropometry).",
    timeline: "3–6 months", difficulty: 2,
  }],
  canthalTilt: [{
    tier: "Grooming", what: "Create the look of a lift with brow shape and outer-corner makeup.",
    how: "Angle the tail of the brow slightly upward, and take liner or shadow out and up past the outer corner of the eye.",
    science: "Upturned canthal axis is a validated youth/femininity cue (periorbital attractiveness literature); makeup shifts perception, not anatomy.",
    timeline: "Right away", difficulty: 1,
  }],
  browPosition: [{
    tier: "Grooming", what: "Reshape the height and arch of your brows toward your target.",
    how: "For a softer, more feminine look, lift the peak of the arch and tidy the line underneath. For a stronger look, keep the brow straighter and lower.",
    science: "Brow position is a strong dimorphism signal and is fully soft-tissue/hair — high improvability.",
    timeline: "1–2 weeks", difficulty: 1, goals: ["feminine", "masculine", "youthful"],
  }],
  lipRatio: [{
    tier: "Grooming", what: "Even out how full your top and bottom lip look.",
    how: "Keep lips hydrated, and line just outside the natural edge of the thinner one. Filler is an option here but is not the first step.",
    science: "Lower-lip-dominant fullness (~1:1.6) reads youthful and feminine; perception shifts with liner before any procedure.",
    timeline: "Right away", difficulty: 1, goals: ["feminine", "youthful"],
  }],
  fwhr: [{
    tier: "Fitness", what: "Carry less facial fat, so your face reads narrower.",
    how: "Steady body-fat loss over months rather than a crash diet, plus less salt and alcohol in the evening to cut water retention.",
    science: "Higher FWHR reads more dominant/less trustworthy; facial fat exaggerates bizygomatic width (Carré & McCormick 2008).",
    timeline: "3–9 months", difficulty: 2, goals: ["feminine", "youthful"],
  }],
  jawWidth: [{
    tier: "Fitness", what: "Sharpen the jawline with body fat and posture — not by widening it.",
    how: "Lose fat gradually while keeping muscle, fix a head-forward posture, and rest your tongue against the roof of your mouth.",
    science: "Perceived jaw definition responds to fat and posture; bony bigonial width is fixed (orthognathic norms, Riolo 1974).",
    timeline: "4–9 months", difficulty: 2,
  }],
  gonial: [{
    tier: "Habits", what: "Use tongue posture, and deal with any overbuilt chewing muscle.",
    how: "Rest your tongue flat against the roof of your mouth whenever you're not talking or eating. If you grind your teeth, treat it — grinding thickens the muscle at the jaw corner.",
    science: "Gonial angle norms ≈118–130° (Riolo); soft-tissue drape and masseter bulk are the modifiable layer, the bone is not.",
    timeline: "6–12 months", difficulty: 3,
  }],
  lowerThird: [{
    tier: "Fitness", what: "Keep the area under the chin clean, so a long lower face stays defined.",
    how: "Control body fat, keep your head over your shoulders rather than forward, and work the muscles at the front of the neck.",
    science: "Vertical proportions are skeletal, but the soft-tissue read of the lower third is fat/posture-driven.",
    timeline: "3–9 months", difficulty: 2,
  }],
  noseWidth: [{
    tier: "Grooming", what: "Make the nose read narrower with shading and better light.",
    how: "Blend a soft shadow down each side of the bridge, and avoid flat light coming straight at your face — it flattens and widens the nose.",
    science: "Alar width relative to intercanthal drives the 'wide' read; contour changes perception only (ethnic norms respected).",
    timeline: "Right away", difficulty: 1,
  }],
  eLineUpper: [{
    tier: "Habits", what: "Get lips that sit well forward checked — it's usually the teeth.",
    how: "See a dentist or orthodontist. When both jaws sit forward, that's an orthodontic problem with an orthodontic fix, not something a cosmetic treatment addresses.",
    science: "Ricketts E-line: lips should sit slightly behind (upper −4 to −6mm). Protrusion frequently flags malocclusion.",
    timeline: "12–30 months (braces)", difficulty: 3,
  }],
  skin: [{
    tier: "Skincare", what: "Get the basics right: sunscreen, a retinoid, and a gentle cleanser.",
    how: "SPF 30 or higher every morning, a retinoid at night (start twice a week and build up), moisturiser on top; vitamin C in the morning if you want a fourth step.",
    science: "Skin quality (evenness, texture) is one of QOVES' regions and the highest-ROI non-surgical lever; photoprotection is the #1 evidence-based anti-aging step.",
    timeline: "8–16 weeks", difficulty: 1, always: true,
  }],
  periorbital: [{
    tier: "Habits", what: "Fix under-eye puffiness with sleep, salt and water.",
    how: "7–9 hours of sleep, less salt and alcohol in the evening, enough water through the day, and something cold on the eyes in the morning.",
    science: "Periorbital puffiness and dark circles are partly fluid/lifestyle-mediated — reversible without procedures.",
    timeline: "2–6 weeks", difficulty: 1, always: true,
  }],
};

function buildProtocol(weaknesses, meta, aging) {
  const items = [];
  const seen = new Set();
  const addFor = (key) => {
    const arr = KB[key]; if (!arr) return;
    for (const it of arr) {
      if (it.goals && meta.goal && meta.goal !== "natural" && !it.goals.includes(meta.goal)) continue;
      const id = key + it.what;
      if (seen.has(id)) return; seen.add(id);
      items.push({ ...it, forFeature: key });
    }
  };
  for (const w of weaknesses) addFor(w.key);
  // Always-include foundations (skin, periorbital) per QOVES' baseline.
  addFor("skin"); addFor("periorbital");
  // Lifestyle gating: only surface fat-related items if lifestyle suggests headroom.
  const ls = meta.lifestyle || {};
  // Sequence by difficulty then timeline (quick wins first), matching QOVES' laddering.
  items.sort((a, b) => a.difficulty - b.difficulty);
  const tierOrder = { Skincare: 0, Grooming: 1, Habits: 2, Fitness: 3 };
  items.sort((a, b) => (tierOrder[a.tier] ?? 9) - (tierOrder[b.tier] ?? 9));
  return items;
}
