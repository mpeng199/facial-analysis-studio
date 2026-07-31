// geometry3d.js — the "stereophotogrammetry mimic" layer.
//
// Three accuracy tiers (see plan):
//   1. Pose-normalize landmarks into a head-local frame (removes roll, reduces
//      yaw/pitch) BEFORE measuring, plus Euler angles from the transform matrix
//      as a photo-quality gate.
//   2. Metric scale from iris diameter (~11.7 mm) or a credit card (85.6 mm).
//   3. Multi-view DLT triangulation of metric 3D landmarks from several photos.
//
// All measurements downstream run on pose-normalized coordinates so a slightly
// turned photo doesn't silently skew width ratios or canthal tilt.

export const IRIS_MM = 11.7;   // horizontal visible iris diameter, near-constant across humans
export const CARD_MM = 85.6;   // ISO/IEC 7810 ID-1 card long edge

// ---------- vector helpers (3D) ----------
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: (a.z || 0) + (b.z || 0) });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: (a.z || 0) * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + (a.z || 0) * (b.z || 0);
export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const norm = (a) => Math.hypot(a.x, a.y, a.z || 0);
export const normalize = (a) => { const n = norm(a) || 1; return scale(a, 1 / n); };
export const mid = (a, b) => scale(add(a, b), 0.5);

// 2D distance in the plane (ignores z) — used for on-image measurements.
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist3D = (a, b) => norm(sub(a, b));

// Angle ABC at vertex B (degrees), in the XY plane unless use3D.
export function angleDeg(a, b, c, use3D = false) {
  const v1 = sub(a, b), v2 = sub(c, b);
  if (!use3D) { v1.z = 0; v2.z = 0; }
  const cosang = dot(v1, v2) / ((norm(v1) || 1) * (norm(v2) || 1));
  return (Math.acos(Math.max(-1, Math.min(1, cosang))) * 180) / Math.PI;
}

// Signed angle of segment A→B relative to the horizontal (degrees).
// Positive = B is higher on the face than A (screen y is down, so we negate).
export function tiltToHorizontalDeg(a, b) {
  return (-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// ---------- convert normalized landmarks to isotropic pixel coords ----------
// MediaPipe x is normalized by width, y by height; multiply back so distances
// and angles are computed in a single consistent (pixel) unit. z scaled by width.
export function toPixels(landmarks, w, h) {
  return landmarks.map((p) => ({ x: p.x * w, y: p.y * h, z: (p.z || 0) * w }));
}

// ---------- Euler angles from the 4x4 facial transformation matrix ----------
// Matrix is column-major (16 floats). Returns degrees. Used only as a quality
// gate / reported "head pose", so exact axis labelling matters less than the
// magnitude of deviation from frontal.
export function headPose(transform) {
  if (!transform || transform.length < 16) return null;
  const m = transform;
  const R00 = m[0], R10 = m[1], R20 = m[2];
  const R21 = m[6], R22 = m[10];
  const sy = Math.hypot(R00, R10);
  const pitch = (Math.atan2(R21, R22) * 180) / Math.PI;
  const yaw = (Math.atan2(-R20, sy) * 180) / Math.PI;
  const roll = (Math.atan2(R10, R00) * 180) / Math.PI;
  return { yaw, pitch, roll };
}

// Photo-quality verdict from head pose. Big yaw ruins frontal width ratios.
export function qualityGate(pose) {
  if (!pose) return { ok: true, level: "unknown", notes: ["Head pose unavailable."] };
  const notes = [];
  const ay = Math.abs(pose.yaw), ap = Math.abs(pose.pitch), ar = Math.abs(pose.roll);
  if (ay > 8) notes.push(`Head is turned ${ay.toFixed(0)}° (yaw) — frontal width ratios corrected but less certain.`);
  if (ap > 10) notes.push(`Head is tilted ${ap.toFixed(0)}° up/down (pitch) — vertical thirds less certain.`);
  if (ar > 6) notes.push(`Head is rolled ${ar.toFixed(0)}° — auto-levelled before measuring.`);
  const level = ay > 15 || ap > 18 ? "retake" : ay > 8 || ap > 10 ? "ok-warn" : "good";
  if (level === "good") notes.push("Frontal alignment is good.");
  return { ok: level !== "retake", level, notes };
}

// ---------- pose normalization (head-local frame) ----------
// Build an orthonormal frame from stable landmarks and express every point in
// it: x = horizontal (face width), y = vertical (down the face), z = depth (out).
// Removes roll, reduces yaw/pitch. Returns { pts, frame }.
export function poseNormalize(pxPts, IDX) {
  const eyeR = pxPts[IDX.eyeROuter], eyeL = pxPts[IDX.eyeLOuter];
  const glab = pxPts[IDX.glabella], menton = pxPts[IDX.menton];
  const origin = mid(eyeR, eyeL);
  const right = normalize(sub(eyeL, eyeR));            // toward subject-left across the eyes
  const down0 = sub(menton, glab);                    // roughly down the face
  const fwd = normalize(cross(right, down0));         // out of the face
  const down = normalize(cross(fwd, right));          // orthogonalized down
  const frame = { origin, right, down, fwd };
  const pts = pxPts.map((p) => {
    const d = sub(p, origin);
    return { x: dot(d, right), y: dot(d, down), z: dot(d, fwd) };
  });
  return { pts, frame };
}

// ---------- metric scale ----------
// mm-per-pixel from iris diameter. Uses both irises; diameter = 2*mean(center→ring).
export function irisScale(pxPts, IDX) {
  const radius = (center, ring) => {
    const c = pxPts[center];
    const rs = ring.map((i) => dist2D(pxPts[i], c));
    return rs.reduce((a, b) => a + b, 0) / rs.length;
  };
  const dR = 2 * radius(IDX.irisRCenter, IDX.irisRRing);
  const dL = 2 * radius(IDX.irisLCenter, IDX.irisLRing);
  const diaPx = (dR + dL) / 2;
  if (!isFinite(diaPx) || diaPx <= 0) return null;
  return { mmPerPx: IRIS_MM / diaPx, source: "iris", diaPx };
}

// mm-per-pixel from two clicked credit-card edge points (in pixel coords).
export function cardScale(p1, p2) {
  const d = dist2D(p1, p2);
  if (!d) return null;
  return { mmPerPx: CARD_MM / d, source: "card", edgePx: d };
}

// =====================================================================
// Multi-view DLT triangulation
// =====================================================================
// Given several views, each with 2D pixel landmarks + a head-pose rotation R
// and translation t (from the facial transform matrix) + a nominal pinhole
// intrinsic K, triangulate the metric 3D position of each shared landmark.
//
// Camera projection P = K [R | t]. For a rigid head, the 3D point in the
// head-fixed frame is constant; each view gives 2 linear equations in the
// homogeneous point X. We stack them and take the null space (smallest
// eigenvector of AᵀA) via a compact 4x4 Jacobi eigensolver.
//
// ponytail: intrinsics are nominal (f ≈ image width). Exact for the synthetic
// test (we control K,R,t); approximate on real photos. Upgrade path: calibrate
// f from the transform matrix's projected scale if higher fidelity is needed.

// Build a 3x4 projection matrix from K(3x3 row-major array of 9), R(3x3 row),
// t(3). Returns 12-length row-major.
export function projectionMatrix(K, R, t) {
  // Rt = [R|t] is 3x4; P = K * Rt
  const Rt = [
    R[0], R[1], R[2], t[0],
    R[3], R[4], R[5], t[1],
    R[6], R[7], R[8], t[2],
  ];
  const P = new Array(12).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += K[i * 3 + k] * Rt[k * 4 + j];
      P[i * 4 + j] = s;
    }
  return P;
}

// Nominal pinhole intrinsics for an image of width w, height h.
export function nominalK(w, h) {
  const f = w; // focal length ≈ image width in pixels
  return [f, 0, w / 2, 0, f, h / 2, 0, 0, 1];
}

// Triangulate one point from N views. observations: [{P (12), x, y}].
export function triangulatePoint(observations) {
  // Build A (2N x 4): for each view, x*P3 - P1 and y*P3 - P2.
  const rows = [];
  for (const o of observations) {
    const P = o.P;
    const P1 = [P[0], P[1], P[2], P[3]];
    const P2 = [P[4], P[5], P[6], P[7]];
    const P3 = [P[8], P[9], P[10], P[11]];
    rows.push([o.x * P3[0] - P1[0], o.x * P3[1] - P1[1], o.x * P3[2] - P1[2], o.x * P3[3] - P1[3]]);
    rows.push([o.y * P3[0] - P2[0], o.y * P3[1] - P2[1], o.y * P3[2] - P2[2], o.y * P3[3] - P2[3]]);
  }
  // AtA (4x4)
  const AtA = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const r of rows)
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) AtA[i][j] += r[i] * r[j];
  const X = smallestEigenvector4(AtA);
  if (!X || !X[3]) return null;
  return { x: X[0] / X[3], y: X[1] / X[3], z: X[2] / X[3] };
}

// Smallest-eigenvalue eigenvector of a symmetric 4x4 via cyclic Jacobi rotations.
export function smallestEigenvector4(A) {
  // copy
  const a = A.map((r) => r.slice());
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    // find largest off-diagonal
    let p = 0, q = 1, max = 0;
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++)
        if (Math.abs(a[i][j]) > max) { max = Math.abs(a[i][j]); p = i; q = j; }
    if (max < 1e-12) break;
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi), s = Math.sin(phi);
    for (let k = 0; k < 4; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 4; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 4; k++) {
      const vkp = V[k][p], vkq = V[k][q];
      V[k][p] = c * vkp - s * vkq;
      V[k][q] = s * vkp + c * vkq;
    }
  }
  // smallest diagonal → its eigenvector is column of V
  let idx = 0, best = Infinity;
  for (let i = 0; i < 4; i++) if (a[i][i] < best) { best = a[i][i]; idx = i; }
  return [V[0][idx], V[1][idx], V[2][idx], V[3][idx]];
}
