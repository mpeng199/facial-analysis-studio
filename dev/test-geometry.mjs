// Self-checks for the hand-built geometry in landing.js: the chamfered unit box
// and the swept pedestal moulding.
//   node dev/test-geometry.mjs
// landing.js is a browser module that boots on import, so the functions under
// test are lifted out by source text and run against a three-shaped stub.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../landing.js", import.meta.url), "utf8");
// Lift a top-level `function name(...) { ... }` by source text, to the first
// closing brace in column 1.
const lift = (name) => {
  const start = src.indexOf(`function ${name}`);
  assert.ok(start > 0, `${name} not found in landing.js`);
  return src.slice(start, src.indexOf("\n}\n", start) + 3);
};
const THREE = {
  BufferGeometry: class {
    constructor() { this.attributes = {}; this.userData = {}; }
    setAttribute(n, a) { this.attributes[n] = a; }
    setIndex(i) { this.index = { array: i, count: i.length }; }
    computeVertexNormals() { /* stub: normals are not under test here */ }
  },
  Float32BufferAttribute: class {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
  },
};
const makeChamferBoxGeo = new Function("THREE", `${lift("makeChamferBoxGeo")}; return makeChamferBoxGeo(THREE);`)
  .bind(null);
const geo = makeChamferBoxGeo(THREE);

const pos = geo.attributes.position, ins = geo.attributes.aInset, nor = geo.attributes.normal;
const idx = geo.index.array;
const V = (i) => [pos.array[i * 3], pos.array[i * 3 + 1], pos.array[i * 3 + 2]];

// 1. shape of the buffers: 6 face quads + 12 bevel quads + 8 corner tris
assert.equal(pos.count, 6 * 4 + 12 * 4 + 8 * 3, "vertex count");
assert.equal(idx.length / 3, 6 * 2 + 12 * 2 + 8, "triangle count");

// 2. every vertex sits on a cube corner and slides along exactly TWO axes
for (let v = 0; v < pos.count; v++) {
  for (const c of V(v)) assert.equal(Math.abs(c), 0.5, `vertex ${v} off the unit cube`);
  const inset = [ins.array[v * 3], ins.array[v * 3 + 1], ins.array[v * 3 + 2]];
  assert.equal(inset.reduce((a, b) => a + b, 0), 2, `vertex ${v} must inset on exactly two axes`);
}

// 3. closed manifold: with the chamfer applied, every undirected edge is shared
//    by exactly two triangles (welding coincident positions first)
const CUT = 0.06;
const key = (v) => {
  const p = V(v), i = [ins.array[v * 3], ins.array[v * 3 + 1], ins.array[v * 3 + 2]];
  return p.map((c, k) => (c - Math.sign(c) * CUT * i[k]).toFixed(4)).join(",");
};
const edges = new Map();
for (let t = 0; t < idx.length; t += 3) {
  const k = [key(idx[t]), key(idx[t + 1]), key(idx[t + 2])];
  assert.ok(new Set(k).size === 3, `degenerate triangle at ${t / 3}`);
  for (let e = 0; e < 3; e++) {
    const a = k[e], b = k[(e + 1) % 3], id = a < b ? a + "|" + b : b + "|" + a;
    edges.set(id, (edges.get(id) || 0) + 1);
  }
}
const bad = [...edges].filter(([, n]) => n !== 2);
assert.equal(bad.length, 0, `${bad.length} non-manifold edges (open or overlapping surface)`);

// 4. every face winds outward, and its authored normal agrees with its geometry
let flipped = 0, mismatched = 0;
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
  const P = [a, b, c].map((v) => {
    const p = V(v), i = [ins.array[v * 3], ins.array[v * 3 + 1], ins.array[v * 3 + 2]];
    return p.map((x, k) => x - Math.sign(x) * CUT * i[k]);
  });
  const e1 = P[1].map((x, k) => x - P[0][k]), e2 = P[2].map((x, k) => x - P[0][k]);
  const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const centroid = [0, 1, 2].map((k) => (P[0][k] + P[1][k] + P[2][k]) / 3);
  if (g[0] * centroid[0] + g[1] * centroid[1] + g[2] * centroid[2] <= 0) flipped++;
  const n = [nor.array[a * 3], nor.array[a * 3 + 1], nor.array[a * 3 + 2]];
  if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] <= 0) mismatched++;
}
assert.equal(flipped, 0, `${flipped} triangles wound inward`);
assert.equal(mismatched, 0, `${mismatched} triangles disagree with their vertex normal`);

console.log(`chamfer box OK — ${pos.count} verts, ${idx.length / 3} tris, closed, all outward`);

// =====================================================================
// The pedestal order: PEDESTAL_PROFILE and the rounded-rect sweep that
// turns it into the stone under every cast in the hall.
// =====================================================================
const profSrc = src.slice(src.indexOf("const PEDESTAL_PROFILE = ["),
                          src.indexOf("\n];\n", src.indexOf("const PEDESTAL_PROFILE = [")) + 4);
const PROFILE = new Function(`${profSrc}; return PEDESTAL_PROFILE;`)();

// 5. profile invariants. These are what the pedestal generator is entitled to
//    assume, and what the seating maths downstream depends on:
//    r normalised so the plinth is exactly 1, y running 0 → 1 without ever
//    going backwards (a lathe fed a non-monotonic profile turns itself inside
//    out, and the sweep would fold the same way).
assert.equal(PROFILE[0][1], 0, "profile must start on the ground");
assert.equal(PROFILE[PROFILE.length - 1][1], 1, "profile must end at full height");
assert.equal(Math.max(...PROFILE.map(([r]) => r)), 1, "widest course must be exactly 1 (the plinth)");
for (const [r, y] of PROFILE) {
  assert.ok(r >= 0 && r <= 1, `profile offset ${r} outside [0,1]`);
  assert.ok(y >= 0 && y <= 1, `profile height ${y} outside [0,1]`);
}
for (let i = 1; i < PROFILE.length; i++) {
  assert.ok(PROFILE[i][1] >= PROFILE[i - 1][1], `profile turns back on itself at point ${i}`);
}
// the dado has to actually exist as a run of straight vertical face, or the
// "moulded pedestal" is just a continuous blob with no quiet field in it
const dado = PROFILE.filter(([r]) => r === 0);
assert.ok(dado.length >= 2 && dado[dado.length - 1][1] - dado[0][1] > 0.35,
  "profile needs a dado: a straight run at r=0 covering >35% of the height");

const crease = (g) => g; // the real one only recomputes normals; shape is unchanged
const makeSweptMouldingGeo = new Function("THREE", "crease",
  `${lift("makeSweptMouldingGeo")}; return makeSweptMouldingGeo;`)(THREE, crease);

// A deliberately rectangular, deliberately asymmetric pedestal — a square one
// would hide an x/z axis swap, which is exactly the bug this generator is most
// likely to have.
const ARC = 5, HX = 0.30, HZ = 0.18, H = 0.58, PROJ = 0.075, R = 0.05;
const ped = makeSweptMouldingGeo(THREE, PROFILE, {
  halfX: HX, halfZ: HZ, height: H, proj: PROJ, cornerR: R, arcSegs: ARC,
});
const pp = ped.attributes.position.array, pidx = ped.index.array;
const N = 4 * (ARC + 1), M = PROFILE.length;

// 6. buffer shape: the ring grid, plus one centre vertex for each cap
assert.equal(ped.attributes.position.count, N * M + 2, "pedestal vertex count");
assert.equal(pidx.length / 3, N * (M - 1) * 2 + N * 2, "pedestal triangle count");

// 7. closed AND consistently oriented, in one assertion: on a correctly wound
//    closed surface every DIRECTED edge occurs exactly once, so its reverse is
//    supplied by the one neighbouring triangle. This catches a hole (an edge
//    with no partner) and a locally flipped triangle (an edge with the same
//    direction twice) — a cap fan wound the wrong way round, or a ring that
//    fails to wrap, both of which otherwise render as an intact-looking
//    pedestal with a gap you find from exactly one camera angle.
const pv = (i) => [pp[i * 3], pp[i * 3 + 1], pp[i * 3 + 2]];
const pkey = (i) => pv(i).map((c) => c.toFixed(5)).join(",");
const directed = new Map();
for (let t = 0; t < pidx.length; t += 3) {
  const k = [pkey(pidx[t]), pkey(pidx[t + 1]), pkey(pidx[t + 2])];
  assert.equal(new Set(k).size, 3, `degenerate pedestal triangle at ${t / 3}`);
  for (let e = 0; e < 3; e++) {
    const id = k[e] + ">" + k[(e + 1) % 3];
    directed.set(id, (directed.get(id) || 0) + 1);
  }
}
const dupe = [...directed].filter(([, n]) => n !== 1);
assert.equal(dupe.length, 0, `${dupe.length} directed edges repeated — inconsistent winding`);
const unpaired = [...directed.keys()].filter((id) => {
  const [a, b] = id.split(">");
  return !directed.has(b + ">" + a);
});
assert.equal(unpaired.length, 0, `${unpaired.length} edges with no opposite — the surface is open`);

// 8. the consistent orientation points OUT, not in. Signed volume is the honest
//    test here: a per-triangle "faces away from the axis" check gives false
//    failures on a steep cavetto over a non-square plan, because on the
//    shallower pair of faces a raking moulding's normal legitimately dots
//    negative against a radial reference. Volume has no such blind spot.
//    (An inward-wound pedestal is the nastiest failure available: invisible
//    from outside, while still casting a perfectly correct shadow.)
let vol = 0;
for (let t = 0; t < pidx.length; t += 3) {
  const [A, B, C] = [pidx[t], pidx[t + 1], pidx[t + 2]].map(pv);
  vol += (A[0] * (B[1] * C[2] - B[2] * C[1])
        - A[1] * (B[0] * C[2] - B[2] * C[0])
        + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
}
assert.ok(vol > 0, `pedestal is inside-out (signed volume ${vol.toFixed(5)})`);
// and it is the volume of an actual pedestal, not a degenerate sliver: the dado
// prism alone is a safe lower bound, the plinth's bounding box an upper one.
assert.ok(vol > 4 * HX * HZ * H * 0.5 && vol < 4 * (HX + PROJ) * (HZ + PROJ) * H,
  `pedestal volume ${vol.toFixed(5)} implausible`);

// 9. the finished stone is the size the seating maths thinks it is. The whole
//    point of the rebuild is that a figure's footprint fits ON the cap, so if
//    this drifts the casts start overhanging again — silently.
let minY = Infinity, maxY = -Infinity, maxX = -Infinity, maxZ = -Infinity;
for (let i = 0; i < ped.attributes.position.count; i++) {
  const [x, y, z] = pv(i);
  minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
}
assert.equal(minY.toFixed(6), (0).toFixed(6), "pedestal must stand on local y=0");
assert.equal(maxY.toFixed(6), H.toFixed(6), "pedestal height");
assert.ok(Math.abs(maxX - (HX + PROJ)) < 1e-6, `plinth half-width ${maxX} != ${HX + PROJ}`);
assert.ok(Math.abs(maxZ - (HZ + PROJ)) < 1e-6, `plinth half-depth ${maxZ} != ${HZ + PROJ}`);

// 10. the cap's top bed is what a figure actually stands on, and the seating
//     code derives its size as max(r) * proj out from the dado. Verify the
//     geometry agrees with that derivation, since the two are computed in
//     different places and a mismatch is exactly an overhanging statue.
const topOut = PROFILE[PROFILE.length - 1][0] * PROJ;
let capMaxX = -Infinity;
for (let i = 0; i < N * M; i++) {
  const [x, y] = pv(i);
  if (Math.abs(y - H) < 1e-6) capMaxX = Math.max(capMaxX, x);
}
assert.ok(Math.abs(capMaxX - (HX + topOut)) < 1e-6,
  `cap bed half-width ${capMaxX} != dado ${HX} + ${topOut}`);

console.log(`pedestal OK — ${ped.attributes.position.count} verts, ${pidx.length / 3} tris, `
  + `closed, all outward, plinth ${(HX + PROJ).toFixed(3)}×${(HZ + PROJ).toFixed(3)}, cap bed ${capMaxX.toFixed(3)}`);
