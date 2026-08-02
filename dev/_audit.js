// _audit.js — dev-only geometry auditor. NOT referenced by index.html; load it
// by hand in the console:
//   fetch('/dev/_audit.js').then(r=>r.text()).then(t=>(0,eval)(t))
//
// This is the regression harness for the "statues phasing through the curtains"
// bug. After any change to the drapery, the niches or the figure placement:
//   __audit.figureClashes(11, 0.02).filter(r => r.member.startsWith('Plane'))
// must come back empty. `memberClashes(depth)` does OBB/SAT between hall
// members for the same job on masonry.
//
// Two classes of false positive are expected and unavoidable here: the sky dome
// (SphereGeometry) contains the whole scene, and the arch walls
// (ExtrudeGeometry) are solids with a hole punched in them, so their bounding
// box spans the opening every column and figure stands in.
(function () {
  const H = window.__hall;
  const anyGeo = (() => { let g = null; H.scene.traverse(o => { if (!g && o.isMesh) g = o.geometry; }); return g; })();
  anyGeo.computeBoundingBox();
  const Box3 = anyGeo.boundingBox.constructor;
  const V3 = H.camera.position.constructor;
  const M4 = H.camera.matrixWorld.constructor;

  // ---- collect every drawn instance as an OBB (local bbox + world matrix) ----
  function collect() {
    const items = [];
    H.scene.updateMatrixWorld(true);
    H.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) return;
      const g = o.geometry;
      if (!g || !g.attributes.position) return;
      if (g.attributes.position.count > 40000) return;      // statue scans handled separately
      if (!g.boundingBox) g.computeBoundingBox();
      const lb = g.boundingBox;
      const tag = (o.name || g.type) + (o.material?.name ? ":" + o.material.name : "");
      if (o.isInstancedMesh) {
        const m = new M4();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          items.push({ tag, i, mat: m.clone().premultiply(o.matrixWorld), lb });
        }
      } else {
        items.push({ tag, i: -1, mat: o.matrixWorld.clone(), lb });
      }
    });
    // world AABB + inverse for each
    const inv = new M4();
    for (const it of items) {
      it.world = new Box3().copy(it.lb).applyMatrix4(it.mat);
      it.inv = inv.copy(it.mat).invert().clone();
    }
    // A NaN vertex gives a NaN bounding box, and every NaN comparison below is
    // false — which reads as "inside everything" and buries the real hits.
    // Fail loudly instead.
    const nan = items.filter((it) => !Number.isFinite(it.world.min.x + it.world.max.x));
    if (nan.length) throw new Error(`NaN geometry: ${[...new Set(nan.map((n) => n.tag))].join(", ")}`);
    return items;
  }

  function figures() {
    const meshes = [];
    H.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      if (o.geometry.attributes.position.count <= 40000) return;
      let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      if (vis) meshes.push(o);
    });
    const roots = new Map();
    for (const m of meshes) {
      let n = m; while (n.parent && n.parent.name !== "world" && n.parent.parent) n = n.parent;
      if (!roots.has(n)) roots.set(n, []);
      roots.get(n).push(m);
    }
    return [...roots].map(([root, ms]) => ({ root, ms, box: new Box3().setFromObject(root) }));
  }

  // ---- statue vs hall member ----
  function figureClashes(step = 17, minDepth = 0.02) {
    const items = collect(), figs = figures(), out = [];
    const p = new V3(), lp = new V3();
    for (const f of figs) {
      if (f.box.min.y < -1) continue;                       // the beyond's reflection twin
      const near = items.filter(it => it.world.intersectsBox(f.box));
      const hits = new Map();
      for (const mesh of f.ms) {
        const pos = mesh.geometry.attributes.position;
        mesh.updateWorldMatrix(true, false);
        for (let v = 0; v < pos.count; v += step) {
          p.fromBufferAttribute(pos, v).applyMatrix4(mesh.matrixWorld);
          for (const it of near) {
            if (!it.world.containsPoint(p)) continue;
            lp.copy(p).applyMatrix4(it.inv);
            const d = Math.min(
              lp.x - it.lb.min.x, it.lb.max.x - lp.x,
              lp.y - it.lb.min.y, it.lb.max.y - lp.y,
              lp.z - it.lb.min.z, it.lb.max.z - lp.z,
            );
            if (d <= minDepth) continue;
            const k = it.tag + "#" + it.i;
            const rec = hits.get(k) || { tag: it.tag, i: it.i, n: 0, depth: 0, at: null };
            rec.n++; if (d > rec.depth) { rec.depth = d; rec.at = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; }
            hits.set(k, rec);
          }
        }
      }
      for (const rec of hits.values()) {
        out.push({ figure: f.root.name, member: rec.tag, inst: rec.i, pts: rec.n, depth: +rec.depth.toFixed(3), at: rec.at });
      }
    }
    return out.sort((a, b) => b.depth - a.depth);
  }

  // ---- OBB vs OBB (SAT) between hall members ----
  function obbAxes(it) {
    const e = it.mat.elements;
    const ax = [new V3(e[0], e[1], e[2]), new V3(e[4], e[5], e[6]), new V3(e[8], e[9], e[10])];
    const s = ax.map(a => a.length());
    ax.forEach((a, i) => a.divideScalar(s[i] || 1));
    const c = new V3().copy(it.lb.min).add(it.lb.max).multiplyScalar(0.5).applyMatrix4(it.mat);
    const h = new V3().copy(it.lb.max).sub(it.lb.min).multiplyScalar(0.5);
    return { c, ax, h: [h.x * s[0], h.y * s[1], h.z * s[2]] };
  }
  function penetration(A, B) {           // min overlap over the 15 SAT axes, or 0 if separated
    const d = new V3().copy(B.c).sub(A.c);
    let best = Infinity;
    const test = (ax) => {
      const L = ax.length(); if (L < 1e-6) return true;
      ax.divideScalar(L);
      const ra = Math.abs(A.ax[0].dot(ax)) * A.h[0] + Math.abs(A.ax[1].dot(ax)) * A.h[1] + Math.abs(A.ax[2].dot(ax)) * A.h[2];
      const rb = Math.abs(B.ax[0].dot(ax)) * B.h[0] + Math.abs(B.ax[1].dot(ax)) * B.h[1] + Math.abs(B.ax[2].dot(ax)) * B.h[2];
      const ov = ra + rb - Math.abs(d.dot(ax));
      if (ov <= 0) return false;
      if (ov < best) best = ov;
      return true;
    };
    for (const a of A.ax) if (!test(a.clone())) return 0;
    for (const b of B.ax) if (!test(b.clone())) return 0;
    for (const a of A.ax) for (const b of B.ax) if (!test(new V3().crossVectors(a, b))) return 0;
    return best;
  }
  // A wall-with-a-hole (ExtrudeGeometry) has a bbox that spans its opening, so
  // every column and curtain standing in the archway reads as "inside it".
  // Those geometries can only be tested analytically; exclude them here.
  // BufferGeometry = the chamfered unit box (a hand-built BufferGeometry, so it
  // does NOT report as BoxGeometry). Leaving it out silently dropped ~4300
  // members — most of the hall — from this audit.
  const SOLIDISH = /^(Box|Cylinder|Torus|Buffer)Geometry/;
  const contains = (A, B) => {                 // B's OBB entirely inside A's — a band round a shaft, a keystone in an arch
    const c = new V3(), inv = new M4().copy(A.mat).invert();
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? B.lb.max.x : B.lb.min.x, i & 2 ? B.lb.max.y : B.lb.min.y, i & 4 ? B.lb.max.z : B.lb.min.z);
      c.applyMatrix4(B.mat).applyMatrix4(inv);
      if (!A.lb.containsPoint(c)) return false;
    }
    return true;
  };
  function memberClashes(minDepth = 0.06, maxReport = 60) {
    const items = collect().filter(it => it.world.max.y > 0.02 && it.world.min.y > -1.2 && SOLIDISH.test(it.tag));
    for (const it of items) it.obb = obbAxes(it);
    // uniform grid prefilter
    const CELL = 3, grid = new Map();
    const key = (x, y, z) => x + "," + y + "," + z;
    items.forEach((it, idx) => {
      const a = it.world;
      for (let x = Math.floor(a.min.x / CELL); x <= Math.floor(a.max.x / CELL); x++)
        for (let y = Math.floor(a.min.y / CELL); y <= Math.floor(a.max.y / CELL); y++)
          for (let z = Math.floor(a.min.z / CELL); z <= Math.floor(a.max.z / CELL); z++) {
            const k = key(x, y, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(idx);
          }
    });
    const seen = new Set(), out = [];
    for (const bucket of grid.values()) {
      for (let a = 0; a < bucket.length; a++) for (let b = a + 1; b < bucket.length; b++) {
        const i = bucket[a], j = bucket[b], pk = i < j ? i + ":" + j : j + ":" + i;
        if (seen.has(pk)) continue; seen.add(pk);
        const A = items[i], B = items[j];
        if (!A.world.intersectsBox(B.world)) continue;
        if (contains(A, B) || contains(B, A)) continue;   // enclosure is deliberate, not a clash
        const dpt = penetration(A.obb, B.obb);
        if (dpt > minDepth) out.push({ a: A.tag + "#" + A.i, b: B.tag + "#" + B.i, depth: +dpt.toFixed(3), at: [+A.obb.c.x.toFixed(1), +A.obb.c.y.toFixed(1), +A.obb.c.z.toFixed(1)] });
      }
    }
    return out.sort((x, y) => y.depth - x.depth).slice(0, maxReport);
  }

  // ---- seating: is every cast actually STANDING ON its pedestal? ----
  //
  // The regression harness for the bug in the screenshot that prompted the
  // rebuild: a figure wider than the stone under it, hanging over its own
  // plinth. Purely a bounding-box question, but it cannot be asked until the
  // GLBs have loaded, which is why it lives here and not in test-geometry.mjs.
  //
  //   __audit.seating()            → one row per cast; `ok` false is a failure
  //   __audit.seating().filter(r => !r.ok)   → must be empty
  //
  // margin  the smallest gap between the cast's footprint and the edge of the
  //         cap, per axis. NEGATIVE means overhanging. The back margin in z is
  //         reported separately and deliberately NOT failed on: placement is
  //         biased forward so any shortfall hides behind the niche backing.
  // gapY    cast's lowest point minus the cap's top. Must be ~0: positive is a
  //         figure floating above its pedestal, negative is one sunk into it.
  // headroom crown of the niche arch minus the top of the cast. Negative means
  //         the figure is bursting through its own arch, which is the other
  //         half of what made these read wrong.
  const NICHE_CROWN_Y = 1.05 + 2.68;   // sill + NICHE_SPRING + NICHE_OPEN, from landing.js
  function seating(tol = 0.002) {
    const peds = new Map(), figs = new Map();
    H.scene.updateMatrixWorld(true);
    H.scene.traverse((o) => {
      if (o.name && o.name.startsWith("pedestal:")) peds.set(o.name.slice(9), o);
      if (o.name && o.name.startsWith("figure:")) figs.set(o.name.slice(7), o);
    });
    const v = new V3(), out = [];
    for (const [name, f] of figs) {
      const p = peds.get(name);
      if (!p) { out.push({ figure: name, ok: false, why: "no pedestal" }); continue; }
      const fb = new Box3().setFromObject(f), pb = new Box3().setFromObject(p);
      // the footprint: the lowest tenth, the same slice landing.js cuts the
      // pedestal from, so the two are answering the same question
      const cut = fb.min.y + (fb.max.y - fb.min.y) * 0.1;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      f.traverse((o) => {
        if (!o.isMesh) return;
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i++) {
          v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
          if (v.y > cut) continue;
          if (v.x < x0) x0 = v.x; if (v.x > x1) x1 = v.x;
          if (v.z < z0) z0 = v.z; if (v.z > z1) z1 = v.z;
        }
      });
      const marginX = Math.min(x0 - pb.min.x, pb.max.x - x1);
      const frontZ = pb.max.z - z1, backZ = z0 - pb.min.z;
      const gapY = fb.min.y - pb.max.y;
      const headroom = NICHE_CROWN_Y - fb.max.y;
      out.push({
        figure: name,
        ok: marginX > tol && frontZ > tol && Math.abs(gapY) < 0.01 && headroom > 0,
        marginX: +marginX.toFixed(4), frontZ: +frontZ.toFixed(4), backZ: +backZ.toFixed(4),
        gapY: +gapY.toFixed(4), headroom: +headroom.toFixed(3),
      });
    }
    return out;
  }

  window.__audit = { collect, figures, figureClashes, memberClashes, seating, Box3, V3, M4, obbAxes, penetration };
  return "audit ready";
})();
