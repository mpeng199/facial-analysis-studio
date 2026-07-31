// Self-check for the chamfered unit box in landing.js.
//   node test-geometry.mjs
// landing.js is a browser module that boots on import, so the function under
// test is lifted out by source text and run against a three-shaped stub.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync(new URL("../landing.js", import.meta.url), "utf8");
const start = src.indexOf("function makeChamferBoxGeo");
assert.ok(start > 0, "makeChamferBoxGeo not found in landing.js");
// to the blank line before the next top-level declaration
const end = src.indexOf("\n}\n", start) + 3;
const THREE = {
  BufferGeometry: class {
    constructor() { this.attributes = {}; this.userData = {}; }
    setAttribute(n, a) { this.attributes[n] = a; }
    setIndex(i) { this.index = { array: i, count: i.length }; }
  },
  Float32BufferAttribute: class {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
  },
};
const makeChamferBoxGeo = new Function("THREE", `${src.slice(start, end)}; return makeChamferBoxGeo(THREE);`)
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
