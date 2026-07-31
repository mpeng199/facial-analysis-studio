// landing.js — the marble Hall of Mirrors.
//
// Progressive enhancement: this module only upgrades the static page. If WebGL
// (or the CDN) fails, the page stays a readable, styled document. On success we
// add .cinema to <body>: the canvas corridor appears, chapters become fixed
// panels, and native scroll drives the camera down the hall.
//
// The hall is a Greek temple interior — one connected classical order, not
// floating props. It is dressed in a small stone library (see buildHall): one
// pale violet-white quarry cut five ways — statuary white for the order,
// lilac-pearl ashlar walls, violet-greyed recessed fields, pale limestone base
// courses — separated by VALUE, not temperature, with a per-block quarry tint
// from the batcher. Iris limewash bands the columns and fills the frieze; the
// gilt is desaturated to silver-gilt; violet drapery hangs in the bays. The
// whole palette answers the site's own --pearl / --iris.
// Shared datum lines tie every element together:
//   y 0     floor          y 1.10       podium top (columns + mirror bays stand on it)
//   y 4.90  column capitals = architrave bottom; entablature runs y 4.90–6.24
//   y 6.24+ balustraded attic; pediments crown the transverse arches.
// The entablature (architrave · triglyph-and-wreath frieze · dentil cornice)
// runs the length of BOTH walls and wraps across every transverse arch, so
// each arch reads as a ring of the same order; the mirrors are arched
// aediculae cut INTO the wall between columns — archivolt, keystone, pediment.
//
// Final act: keep scrolling and you pass THROUGH the grand end mirror — a veil
// flash, and you're in the Void: a dark dimension where the finale ("Meet your
// reflection." + Begin analysis) exists as real 3D objects, not a DOM overlay.
// Scrolling back up crosses you back into the pearl hall.
//
// Sections: boot guard · scene · environment · hall · void · rig · post · loop.

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FORCE_STATIC = new URLSearchParams(location.search).has("no3d");

// Chapter zones from the DOM (single source of truth for text AND camera sync).
const chapters = [...document.querySelectorAll(".chapter")].map((el) => {
  const [a, b] = el.dataset.zone.split(",").map(Number);
  return { el, a, b };
});
const gaugeDot = document.querySelector(".gauge-dot");

// Static-mode chapter reveal isn't needed (normal document flow), so bail early.
if (!FORCE_STATIC) boot();

async function boot() {
  let THREE;
  try {
    THREE = await import("three"); // resolved by the import map → jsDelivr
  } catch { return; } // offline / CDN blocked → static page stands
  try {
    await init(THREE);
  } catch (e) {
    document.body.classList.remove("cinema", "void");
    console.warn(`3D disabled (${e.message}) — using static page.`);
  }
}

async function init(THREE) {
  const canvas = document.getElementById("scene");
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true,
    powerPreference: "high-performance",
  });
  if (!renderer.getContext()) throw new Error("no WebGL context");
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  // Khronos PBR Neutral, NOT ACES. ACES is a film-stock emulation: it rolls
  // bright values toward its own warm shoulder, so a white marble hall lit to
  // near-clipping comes out cream whatever colour you paint the stone — it was
  // a real part of the yellow cast, not just the palette. Neutral holds hue all
  // the way up and only desaturates in the last stop, which is exactly the
  // "idealised, pristine" white the reference has.
  renderer.toneMapping = THREE.NeutralToneMapping;
  // 1.34, not the old 1.06. Measured off the frame: at 1.16 the brightest
  // pixel in the hall was 236/255 and under 7% of the image sat above 220 —
  // a picture with no white in it, which is why the marble read as grey stone
  // rather than as polished white. "Pristine and idealised" is a HIGH-KEY
  // image: the lit faces have to reach the top of the range and let the
  // lavender live in the shadows, not smear across the whole scale.
  // The beyond gets its own stop. Crossing the mirror already swaps the key
  // light, the sky and the fog; exposure belongs in that same list, because the
  // beyond is a white cast in front of an open sky with no architecture to
  // absorb the light, and the hall's exposure bleaches it flat (measured: mean
  // 223/255, the Discobolus ghosting into its own background). Real scenes get
  // metered individually; this one is metered twice. The change lands inside
  // the veil flash, so it is never seen happening.
  const EXP_HALL = 1.34, EXP_BEYOND = 1.02;
  renderer.toneMappingExposure = EXP_HALL;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The hall does not move. Neither does the sun: its position, its target and
  // every shadow-casting object in the building are set once at build time and
  // never touched again — the only things that animate are the camera, the
  // (shadowless) lantern and niche spots, the dust and the clouds.
  //
  // three re-renders every shadow map on EVERY frame by default, so the page
  // was re-drawing a 4096² depth pass over the whole colonnade, its mirrored
  // floor twins and 1.6M triangles of statuary, sixty times a second, to
  // produce an identical image each time. Measured here at 1920×1200: 26.0ms a
  // frame with the re-pass against 17.9ms without it — 8ms of pure waste, and
  // it predates the render work; it was in the page before any of this.
  //
  // So: render it on demand instead. `restageShadows()` marks the map dirty,
  // and every event that can change what casts a shadow calls it — the six
  // niche casts arriving async, the beyond's centrepiece arriving, and each
  // crossing of the mirror (which swaps entire worlds in and out).
  renderer.shadowMap.autoUpdate = false;
  const restageShadows = () => { renderer.shadowMap.needsUpdate = true; };

  // Bright classical daylight in the site's own pearl: a lavender-white hall,
  // a neutral sun, and cool violet in every shadow. Nothing in the building is
  // allowed a warm hue any more except the sconce flames — warm/cool contrast
  // now runs white against lavender rather than gold against blue.
  const DAWN = new THREE.Color("#eceaf6"); // --pearl, straight off the stylesheet
  const scene = new THREE.Scene();
  scene.background = DAWN;
  // The corridor is 63 units end to end, so fog starting at 16 and saturating
  // at 72 erased everything past the third arch into flat white — no aerial
  // perspective, just a whiteout. Interiors this size barely haze at all;
  // enough to separate the far bays and float the portico, no more.
  // near pushed 34 → 42: at the higher exposure the haze was starting inside
  // the second bay and turning the whole far half of the colonnade to milk.
  // Aerial perspective should separate the far bays, not erase them.
  const pearlFog = new THREE.Fog(new THREE.Color("#e9e7f4"), 42, 150);
  const beyondFog = new THREE.Fog(0xdcd6ee, 30, 96); // far-shore haze beyond the mirror
  scene.fog = pearlFog;

  // near 0.3, not 0.1: the depth buffer's precision is spent almost entirely in
  // the first stop of the range, and both the shadow map and the AO pass read
  // that buffer. Nothing in the hall ever comes within 30cm of the lens.
  const camera = new THREE.PerspectiveCamera(innerWidth < 720 ? 66 : 54, innerWidth / innerHeight, 0.3, 160);
  camera.position.set(0, 1.7, 6);

  // ---------- environment: pastel "aurora studio" for iridescent reflections ----------
  // Assigned per-material (.envMap) rather than scene.environment: three only
  // honours material.envMapIntensity when the map is on the material itself,
  // and both the marble's low sheen and the mirror glint depend on it.
  const envTex = buildEnvironment(THREE, renderer);
  scene.environment = envTex;

  // ---------- lights ----------
  // slightly starved, cool-lavender ambient + a strong golden sun: warm
  // light / cool shadow is the whole trick of a sunset picture
  // KEY-TO-FILL. The rig used to be ambient 0.62 + hemisphere 0.5 against a
  // 1.95 sun: over half the light in the hall arrived from no direction at all.
  // Ambient is also the one term nothing occludes — no AO pass here — so it
  // lands equally on a capital's top, its undercut and the floor, and marble,
  // musculature and flutes all flatten into the same white. That, not the
  // palette, is why the casts read as paper cut-outs.
  // Now: one dominant directional key, and fill only where a real hall would
  // get it — sky down the open clerestory, warm bounce back up off the floor.
  scene.add(new THREE.AmbientLight(0xe8e6f4, 0.15)); // floor of the value range, nothing more
  // sky-above / floor-bounce fill — roof-independent, so the coffered ceiling
  // can enclose the nave without the interior going flat. Unlike ambient this
  // at least varies with the surface normal, so it MODELS.
  // The ground half was 0xd8c8ac — a tan. It is the term that lights every
  // upward-facing surface in the hall from below, so a tan there put a warm
  // wash on every soffit, undercut and jaw in the building at once. Now the
  // bounce carries the floor's own lilac up instead.
  scene.add(new THREE.HemisphereLight(0xeef0fb, 0xdcd6ea, 0.50));
  // The hall is a big daylit interior and wants a dominant key. The beyond is a
  // separate rig — one raking museum spot on the cast plus a cool rim, tuned
  // against the old 1.95 — so the same sun there just blows the marble out.
  // Crossing the mirror swaps the key along with the sky and the fog.
  // SUN_BEYOND was 1.9, tuned against the old ACES curve at exposure 1.06. The
  // hall gained a third of a stop and a flatter tone curve; the beyond has far
  // less geometry to absorb it, so the same rig there just bleached the cast.
  const SUN_HALL = 3.05, SUN_BEYOND = 1.55;
  // Near-white daylight (was 0xfff2e0, a 5500K-ish golden hour). This is the
  // dominant term in the hall — 3.05 against a 0.15 ambient — so its hue IS the
  // hall's hue, and no amount of repainting the stone survives a gold key.
  const sun = new THREE.DirectionalLight(0xfff8f4, SUN_HALL);
  // steep sun so direct light pours into the open-roofed corridor (a low sun
  // leaves the whole interior in the side wall's shadow); one static shadow
  // camera covers the whole (static) hall
  sun.position.set(24, 66, -16);
  sun.target.position.set(0, 0, -28);
  sun.castShadow = true;
  // The ortho box spans ±60 to reach the cast beyond the mirror, so a 2048 map
  // is 5.9cm per texel — coarser than the mouldings it is meant to shade, which
  // is why nothing in the hall had a contact shadow. 4096 halves that; small
  // screens keep 2048 rather than pay 64MB for a shadow they barely see.
  const shadowRes = innerWidth < 900 ? 2048 : 4096;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -60;  // wide enough to reach the statue beyond the mirror
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.normalBias = 0.06;
  sun.shadow.bias = -0.0002;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  // Cool fill down the corridor axis — skylight spilling back off the far
  // portico, so transverse faces turned toward the camera are lit by the SKY
  // rather than by a second sun. It was 0xffd6ba, a hard orange: an amber fill
  // aimed at every camera-facing surface is a warm cast applied to precisely
  // the faces the visitor spends the whole scroll looking at.
  const fill = new THREE.DirectionalLight(0xd6d4f0, 0.3);
  fill.position.set(-3, 4, -9);
  scene.add(fill);
  // Floor bounce. A white marble floor under a 3.0 sun throws a lot of light
  // back up; without it every soffit, cornice undercut and jaw goes to the
  // ambient floor value and the modelling dies from below. Cheap and it is the
  // one direction the hemisphere's ground colour cannot aim. Bounced light
  // takes the colour of what it bounced off, and that floor is now lilac.
  const bounce = new THREE.DirectionalLight(0xeeebfa, 0.5);
  bounce.position.set(-6, -8, 10);
  scene.add(bounce);
  // travelling lantern: was 26, which blew out every surface within a few
  // metres of the camera all by itself
  const lantern = new THREE.PointLight(0xf7f5ff, 11, 18, 2);
  scene.add(lantern);

  // ---------- shared materials ----------
  // Crystal + mirror serve the Void's floating relic; the hall itself is marble.
  const crystal = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0.12, roughness: 0.14,
    iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [140, 460],
    envMap: envTex, envMapIntensity: 1.6,
  });
  const mirrorBase = new THREE.MeshPhysicalMaterial({
    color: 0xe4e0ff, metalness: 1, roughness: 0.055,
    envMap: envTex, envMapIntensity: 1.7,
    side: THREE.DoubleSide, // panes face inward from both walls
  });

  // ---------- corridor path ----------
  // Camera travels z: Z0 → Z1 (linear in scroll progress). The grand mirror sits
  // at MIRROR_Z; crossing its plane swaps dimensions. The last leg (≈ p 0.8 → 1)
  // is the flight through the Void toward the diorama at VOID_Z.
  const Z0 = 6, Z1 = -74;
  const MIRROR_Z = -58;
  const VOID_Z = -84;
  const zAt = (p) => Z0 + (Z1 - Z0) * p;

  const corridor = new THREE.Group();
  scene.add(corridor);

  // Resolve the auto-smooth helper BEFORE any geometry is built — see `crease`.
  await import("three/addons/utils/BufferGeometryUtils.js")
    .then(({ toCreasedNormals }) => { crease = toCreasedNormals; })
    .catch(() => {}); // identity stands in; shading is flatter, nothing breaks

  const archGeo = makeArchGeometry(THREE); // fallback centrepiece for the beyond
  const paneGeo = makePaneGeometry(THREE);
  // Every figure in the building — the six in the arch niches and the
  // beyond's centrepiece — is an SMK Royal Cast Collection scan (CC0); see
  // assets/statues-source.txt. All but the Discobolus are Draco-compressed
  // (~400KB for a 275k-triangle scan), so the decoder is wired in once here.
  // None of the scans ship usable normals: compute them or they render black.
  const loadStatue = (() => {
    const loader = Promise.all([
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/loaders/DRACOLoader.js"),
    ]).then(([{ GLTFLoader }, { DRACOLoader }]) => new GLTFLoader().setDRACOLoader(
      new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/"),
    ));
    return (name) => loader.then((l) => l.loadAsync(`assets/${name}.glb`)).then((g) => {
      g.scene.traverse((o) => { if (o.isMesh) o.geometry.computeVertexNormals(); });
      return g.scene;
    });
  })();
  // The Discobolus loads in the background — the beyond stays hidden until
  // you cross, so it has seconds to arrive; if it can't, the old floating
  // mirror stands in.
  const statuePromise = loadStatue("discobolus");

  // ---------- the hall: a connected Greek order in pearl marble ----------
  // Mirror bays sit at each tenet chapter's zone centre, snapped to the
  // colonnade grid inside buildHall so flanking columns frame them exactly.
  const bayZones = chapters.slice(1, 5).map((c) => (c.a + c.b) / 2);
  const { panes, endPane, nicheKeys, nicheZs, flame, haloMat } = buildHall(THREE, renderer, corridor, { zAt, bayZones, MIRROR_Z, mirrorBase, envTex, statuePromise, loadStatue, restageShadows });

  // The open sky above the colonnade: sunset dome, low sun, drifting clouds.
  const sky = makeSky(THREE);
  corridor.add(sky.group);

  // Faint drifting dust, warmed to catch the hour.
  const dust = makeDust(THREE);
  corridor.add(dust.points);

  // ---------- the Void: the finale preview, made real ----------
  // Draw the type with the real webfonts (canvas textures), so wait for them.
  await Promise.all([
    document.fonts.load("400 100px Italiana"),
    document.fonts.load('600 62px "Albert Sans"'),
    document.fonts.load('400 46px "Albert Sans"'),
  ]).catch(() => {}); // fallback fonts still draw

  const voidWorld = buildVoid(THREE, renderer, { archGeo, paneGeo, crystal, mirrorBase, VOID_Z, envTex, statuePromise, restageShadows });
  scene.add(voidWorld.group);

  // ---------- scroll rig ----------
  let progress = 0, camZ = Z0, swayX = 0;
  let nx = 0, ny = 0; // pointer −1..1, drives the void parallax
  const readScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  };
  addEventListener("scroll", readScroll, { passive: true });

  const syncDOM = () => {
    for (const c of chapters) {
      c.el.classList.toggle("visible", progress >= c.a - 0.02 && progress <= c.b + 0.03);
    }
    if (gaugeDot) gaugeDot.style.top = `${progress * 100}%`;
  };

  // declared before the resize listener that closes over it: a resize can fire
  // while the post stack is still being awaited
  let post = null;
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.fov = innerWidth < 720 ? 66 : 54;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post?.setSize(innerWidth, innerHeight);
  });

  // ---------- dimension crossing ----------
  const flash = document.querySelector(".veil-flash");
  let voidOn = false, crossSeq = 0;
  const setVoid = (on) => {
    voidOn = on;
    const seq = ++crossSeq;
    flash?.classList.add("on");
    setTimeout(() => {
      if (seq !== crossSeq) return; // re-crossed mid-flash; let the newer swap win
      corridor.visible = !on;
      voidWorld.group.visible = on;
      // the beyond IS the world the mirrors reflect: same sky, no darkness —
      // crossing the pane walks you into the very image it was showing
      scene.background = on ? envTex : DAWN;
      scene.fog = on ? beyondFog : pearlFog;
      sun.intensity = on ? SUN_BEYOND : SUN_HALL;
      renderer.toneMappingExposure = on ? EXP_BEYOND : EXP_HALL;
      restageShadows(); // a whole world just appeared or vanished
      flash?.classList.remove("on");
      if (!on) { hover = false; canvas.style.cursor = ""; }
    }, REDUCED ? 420 : 140);
  };

  // ---------- pointer: parallax + picking the 3D CTA ----------
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  // Ripples land on the water surface, which is the flat plane y=0. Intersect
  // it analytically instead of raycasting the 131k-triangle water mesh on every
  // pointermove — that mesh raycast was the input lag; a plane hit is O(1).
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ripPoint = new THREE.Vector3();
  const pick = (x, y) => {
    ptr.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    return ray.intersectObjects(voidWorld.hitTargets, false).length > 0;
  };
  let hover = false, lastRipple = 0;
  addEventListener("pointermove", (e) => {
    nx = (e.clientX / innerWidth) * 2 - 1;
    ny = (e.clientY / innerHeight) * 2 - 1;
    if (voidOn) {
      hover = pick(e.clientX, e.clientY);
      canvas.style.cursor = hover ? "pointer" : "";
      // stir the still water under the cursor — hit the flat water plane (y=0)
      // directly, ~28ms apart, so the trail keeps pace with the cursor
      if (performance.now() - lastRipple > 28) {
        ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        ray.setFromCamera(ptr, camera);
        if (ray.ray.intersectPlane(waterPlane, ripPoint)) {
          voidWorld.addRipple(ripPoint.x, ripPoint.z);
          lastRipple = performance.now();
        }
      }
    }
  });
  canvas.addEventListener("click", (e) => {
    if (voidOn && pick(e.clientX, e.clientY)) location.href = "analyze.html";
  });
  addEventListener("keydown", (e) => {
    if (voidOn && e.key === "Enter" && e.target === document.body) location.href = "analyze.html";
  });

  // ---------- post ----------
  post = await buildPost(THREE, renderer, scene, camera);
  const draw = post ? post.render : () => renderer.render(scene, camera);

  // ---------- loop ----------
  // Shaders compile up-front (void included) so neither world hitches on entry.
  voidWorld.group.visible = true;
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
  else renderer.compile(scene, camera);
  voidWorld.group.visible = false;
  restageShadows(); // first staging: nothing has drawn a shadow map yet

  const clock = new THREE.Clock();
  const LERP = REDUCED ? 1 : 0.07;
  // Only genuine failure falls back — a lost GL context. We deliberately do NOT
  // auto-bail on frame rate: a lower-fps corridor beats hiding it, and the
  // heuristic false-positived on capable machines. `?no3d` is the manual escape.
  const bailToStatic = () => {
    renderer.setAnimationLoop(null);
    post?.dispose();
    renderer.dispose();
    document.body.classList.remove("cinema", "void");
    scrollTo(0, 0);
    console.warn("3D disabled: WebGL context lost — using static page.");
  };
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); bailToStatic(); });

  const lookHall = new THREE.Vector3(), lookVoid = new THREE.Vector3(), look = new THREE.Vector3();
  let voidMix = 0; // eases camera height + gaze between dimensions

  const tick = () => {
    const t = clock.getElapsedTime();
    const targetZ = zAt(progress);
    camZ += (targetZ - camZ) * LERP;

    // cross the pane ↔ swap dimensions (hysteresis so it can't flutter)
    if (!voidOn && camZ < MIRROR_Z + 0.4) setVoid(true);
    else if (voidOn && camZ > MIRROR_Z + 0.9) setVoid(false);

    const par = REDUCED ? 0 : 1;
    const swayTarget = voidOn
      ? nx * 0.9 * par
      : (REDUCED ? 0 : Math.sin(progress * Math.PI * 3) * 0.4 * Math.max(0, 1 - progress / 0.8));
    swayX += (swayTarget - swayX) * LERP;
    voidMix += ((voidOn ? 1 : 0) - voidMix) * (REDUCED ? 1 : 0.05);

    const camY = 1.7 + (2.25 - ny * 0.35 * par - 1.7) * voidMix;
    camera.position.set(swayX, camY, camZ);
    lookHall.set(swayX * 0.3, 1.55, camZ - 8);
    lookVoid.set(nx * 0.25 * par, 2.6, VOID_Z); // low enough to keep the water in frame
    look.lerpVectors(lookHall, lookVoid, voidMix);
    camera.lookAt(look);
    lantern.position.set(swayX, 2.6, camZ - 3);

    if (corridor.visible) {
      // the two niche keys ride to the nearest arch, raking down and inboard
      // across whichever pair of figures the visitor is walking up to
      const nz = nicheZs.reduce((a, b) => (Math.abs(b - camZ) < Math.abs(a - camZ) ? b : a));
      for (const key of nicheKeys) {
        const side = Math.sign(key.target.position.x);
        key.position.set(side * 2.9, 5.2, nz + 3.1);
        key.target.position.z = nz + 0.35;
        key.target.updateMatrixWorld();
      }
      // mirror glint: panes brighten as you pass them
      for (const p of panes) {
        const d = Math.abs(p.userData.z - camZ);
        p.material.envMapIntensity = 1.7 + Math.max(0, 1.6 - d * 0.22);
      }
      // the end mirror flares as you close in — the veil about to break
      const d = Math.max(0, camZ - MIRROR_Z);
      if (d < 9) {
        const k = 1 - d / 9;
        // Trimmed from 3.4/×3: the flare was set against the old exposure with
        // nothing downstream of it. It now runs a third of a stop hotter AND
        // feeds a bloom pass keyed above 1.0, so the last two bays of the
        // approach were a flat white-out instead of a mirror filling with
        // light. The veil should brighten to the crossing, not before it.
        endPane.material.emissiveIntensity = k * k * 2.3;
        endPane.material.envMapIntensity = 1.7 + k * 2.2;
      }
      // Torch flicker. Two incommensurable sines so it never audibly loops,
      // and it costs two float writes for all sixteen torches — they share one
      // material and one halo sprite, so this is the whole animation.
      if (!REDUCED) {
        const f = 1 + Math.sin(t * 2.6) * 0.07 + Math.sin(t * 6.1) * 0.035;
        flame.emissiveIntensity = 1.55 * f;
        haloMat.opacity = 0.42 * f;
      }
      dust.update(t);
      if (!REDUCED) sky.update(t);
    }
    if (voidWorld.group.visible) voidWorld.update(t, hover);

    syncDOM();
    draw(t);
  };
  renderer.setAnimationLoop(tick);

  // Engage cinema mode only once everything above succeeded.
  document.body.classList.add("cinema");
  readScroll();
  syncDOM();
  // debug hooks: p/void report state; tick/snap let rAF-less environments step
  // the loop; go() drives progress without scrolling (panes that can't scroll)
  window.__hall = {
    get p() { return progress; }, get void() { return voidOn; },
    tick, snap: () => { camZ = zAt(progress); },
    go: (p) => { progress = p; camZ = zAt(p); },
    addRipple: (x, z) => voidWorld.addRipple(x, z),
    scene, camera, renderer, post, voidGroup: voidWorld.group,
  };
  console.info("3D corridor active.");
}

// =========================================================================
// The cinematic pass.
//
// Everything above renders a scene; this is what turns it into a picture, and
// it is the step the hall never had. The order below is the standard
// render → comp order, and each stage has to sit where it sits:
//
//   RenderPass   linear HDR beauty at 4× MSAA. MSAA and not a post-AA filter
//                (SMAA/FXAA): this hall is built out of subpixel members —
//                dentils, flutes, several hundred balusters — and no filter
//                can recover an edge the rasteriser never sampled.
//   GTAOPass     ground-truth ambient occlusion. The hall had NO occlusion
//                term at all, which the lighting comments already named as
//                the reason "the casts read as paper cut-outs": skylight and
//                bounce landed identically on a capital's top face, its
//                undercut and the floor beneath it. AO is the only term that
//                separates them, and it is what makes a coffer look sunk, a
//                niche look deep and a column look like it is standing ON
//                the floor rather than intersecting it.
//   Bloom        highlight spill, on the HDR buffer BEFORE the tone curve, so
//                it keys off real over-1.0 radiance (sun disc, sconces, the
//                end mirror's flare) instead of off whatever survived the
//                curve. Post-curve bloom is the classic mistake that smears
//                every mid-grey highlight.
//   OutputPass   tone curve (PBR Neutral) + sRGB, once, for the whole frame —
//                sky, stone and text finally share one response.
//   grade        the colourist's pass, in display space where grading is
//                actually defined: white balance, lavender lift, contrast,
//                saturation, lens aberration, vignette, grain.
//
// Returns null if any of it fails to load — the hall then renders exactly as
// it did before, which is a worse picture and a working one.
// =========================================================================
async function buildPost(THREE, renderer, scene, camera) {
  let mod;
  try {
    mod = await Promise.all([
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/ShaderPass.js"),
      import("three/addons/postprocessing/OutputPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/GTAOPass.js"),
    ]);
  } catch { return null; }
  const [{ EffectComposer }, { RenderPass }, { ShaderPass }, { OutputPass }, { UnrealBloomPass }, { GTAOPass }] = mod;

  const dpr = renderer.getPixelRatio();
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  // AO doubles the geometry cost of a frame (it needs its own depth+normal
  // pass over 1.6M triangles of statuary), so phones never even allocate its
  // buffers. They still get the MSAA, the grade, the bloom and the tone curve —
  // the colour is the point, the occlusion is the luxury. On everything else
  // the width test only decides whether to TRY; see the frame-budget check on
  // render() below for the decision that actually matters.
  const heavy = innerWidth >= 900 && !REDUCED;

  // MSAA is NOT optional and is not tied to `heavy`: the moment a composer is
  // in play, `antialias: true` on the canvas stops doing anything (the scene is
  // rasterised into an offscreen target, not the default framebuffer), so
  // without samples here every screen loses antialiasing outright. A hall built
  // out of subpixel members crawls badly without it, and post-AA filters
  // (SMAA/FXAA) cannot reconstruct an edge that was never sampled.
  // Sample count scales with the backing store instead: 4× is cheap at laptop
  // resolutions, but on a 4K/retina buffer two 4×-multisampled HalfFloat
  // targets are half a gigabyte, so those step down to 2×.
  const target = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.HalfFloatType,        // bloom needs headroom above 1.0
    samples: W * H > 4.2e6 ? 2 : 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setSize(innerWidth, innerHeight);

  composer.addPass(new RenderPass(scene, camera));

  // AO is a LOW-FREQUENCY term — it is the slow darkening in a corner, and it
  // gets a poisson denoise blur of its own before it is blended — so resolving
  // it per-pixel is work you cannot see. The AO buffers are linearly filtered,
  // so the upsample is free and smooth. (Only the pass's normal buffer is
  // nearest-filtered, and that one is read at its own resolution.)
  //
  // Half was still far too generous. The pass turns out to be almost entirely
  // fragment-bound — its geometry prepass is cheap, its shader is not — so its
  // cost tracks the AO buffer's pixel count almost linearly. Measured at
  // 1920×1200: half-res costs 24.0ms a frame, quarter-res 6.4ms. Four times
  // cheaper for a term that is blurred either way.
  const AO_SCALE = 0.25;
  let gtao = null;
  if (heavy) {
    gtao = new GTAOPass(scene, camera, W * AO_SCALE, H * AO_SCALE);
    // radius in WORLD units, and this scene is metric: 0.55m is about the
    // depth of the deepest recess in the hall (a niche is 0.34, a coffer
    // field 0.10), so mouldings darken in their corners without the whole
    // colonnade smearing into a grey haze.
    // 16 samples, not 8: at quarter resolution the pass is dominated by its
    // fixed overhead (the normal prepass, the denoise and the full-res blend),
    // not by the AO shader, so 8 and 16 measured identically — 20.7ms against
    // 20.4ms, inside the noise. Free quality is worth taking.
    gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1, thickness: 1, scale: 1, samples: 16, screenSpaceRadius: false });
    gtao.blendIntensity = 0.85; // present, not a charcoal drawing
    composer.addPass(gtao);
  }

  // threshold 1.15: in a linear buffer, sunlit white marble already sits near
  // 1.0, so a lower threshold blooms the entire building and the hall goes
  // milky. Only what is genuinely emitting spills.
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.26, 0.7, 1.15);
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const grade = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uAberr: { value: 0.0022 },
      uVignette: { value: 0.26 },
      uGrain: { value: REDUCED ? 0 : 0.016 },
      uLift: { value: new THREE.Vector3(0.010, 0.008, 0.020) },
      uGain: { value: new THREE.Vector3(0.986, 0.992, 1.008) },
      uContrast: { value: 1.10 },
      uSat: { value: 0.93 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float uTime, uAberr, uVignette, uGrain, uContrast, uSat;
      uniform vec3 uLift, uGain;
      varying vec2 vUv;

      void main() {
        vec2 c = vUv - 0.5;
        float r2 = dot( c, c );

        // Transverse chromatic aberration. A real lens focuses red and blue at
        // slightly different image heights, so the split grows with the SQUARE
        // of the distance off-axis and is exactly zero at the centre — a
        // uniform rgb offset is the giveaway of a fake one. Sub-pixel at the
        // frame edge; you read it as glass, not as an effect.
        vec2 off = c * r2 * uAberr;
        vec3 col = vec3(
          texture2D( tDiffuse, vUv + off ).r,
          texture2D( tDiffuse, vUv ).g,
          texture2D( tDiffuse, vUv - off ).b
        );

        // Lift/gain white balance. Gain pulls the highlights off yellow (less
        // red, a touch more blue); lift floats the shadows toward lavender so
        // the darks are violet rather than neutral grey — warm light against
        // cool shadow, the trick of every classical daylight painting, done in
        // the site's own hues instead of gold-against-blue.
        col = col * uGain + uLift * ( 1.0 - col );

        col = ( col - 0.5 ) * uContrast + 0.5;

        // Desaturate slightly: "pristine and idealised, not realistic" is a
        // low-chroma, high-value picture. Rec.709 luma so the pull is
        // perceptual and whites do not drift.
        float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
        col = mix( vec3( l ), col, uSat );

        // Vignette on the fourth power of radius: flat across the middle
        // third, falling off only in the corners, the way a fast lens does.
        col *= 1.0 - uVignette * r2 * r2 * 4.0;

        // Grain last, in display space, so its amplitude is constant instead
        // of exploding in the highlights. This is what stops a flat expanse of
        // white marble banding into visible steps on an 8-bit display.
        float n = fract( sin( dot( gl_FragCoord.xy + uTime, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
        col += ( n - 0.5 ) * uGrain;

        gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
      }`,
  });
  composer.addPass(grade);

  // composer.setSize already forwards to every pass, so all that is left is to
  // claw the AO buffers back down to AO_SCALE afterwards.
  const resize = (w, h, ratio) => {
    if (ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(w, h);
      composer.setPixelRatio(ratio);
    }
    composer.setSize(w, h);
    const p = renderer.getPixelRatio();
    gtao?.setSize(w * p * AO_SCALE, h * p * AO_SCALE);
  };
  // This call is load-bearing, not boilerplate. EffectComposer.addPass ends with
  //     pass.setSize( this._width * this._pixelRatio, … )
  // so every pass is silently resized to the FULL frame the moment it is added
  // — which threw away the dimensions GTAOPass was constructed with. The AO was
  // running at full resolution the whole time and AO_SCALE did nothing; that is
  // what made "half-res" AO cost 24ms a frame. Size it once more, last, after
  // every addPass has had its say.
  resize(innerWidth, innerHeight);

  // Quality ladder. Viewport width is a poor proxy for a GPU — a 4K laptop on
  // integrated graphics counts as "desktop", a fast machine in a split pane
  // does not — so the width test above only decides what to ALLOCATE, and the
  // real decision is made by measuring actual delivered frames.
  //
  // On a page whose whole product is a smooth scroll, a dropped frame is worse
  // than a missing shadow, so when the budget is blown the PICTURE degrades and
  // the corridor never does — the same policy as the WebGL fallback, one level
  // down. Rungs in order of least-missed first: the AO pass goes, then the
  // render resolution. Each rung gets a fresh measuring window, so a machine
  // that is still dropping frames after losing AO keeps stepping down instead
  // of stalling on the first rung; a machine that recovers stops being watched.
  const shed = [
    () => {
      if (!gtao || !gtao.enabled) return null;
      gtao.enabled = false;
      return "ambient occlusion";
    },
    () => {
      if (renderer.getPixelRatio() <= 1.05) return null;
      resize(innerWidth, innerHeight, 1); // 1.5 → 1.0 is 2.25× fewer fragments
      return "resolution";
    },
  ];
  let rung = 0, frame = 0, prev = 0, missed = 0;
  // 60+90 frames meant the first step-down landed five seconds in on exactly
  // the machine that needed it — so the hero, the one shot every visitor sees,
  // was the laggiest thing on the page and then quietly got better once they
  // had stopped looking. 40+50 decides in about two seconds and still counts
  // fifty real frames against a 35% threshold, which is plenty to tell a slow
  // GPU from a hiccup. The warm-up skips boot and the async statue loads.
  const WARMUP = 40, WINDOW = 50, LATE = 24; // >24ms: the frame missed a vsync at 60Hz
  const watch = () => {
    if (rung >= shed.length) return;
    const now = performance.now();
    if (frame > WARMUP && prev && now - prev > LATE) missed++;
    prev = now;
    if (++frame < WARMUP + WINDOW) return;
    if (missed > WINDOW * 0.35) {
      const lost = shed[rung]();
      if (lost) console.info(`3D corridor: dropped ${lost} to hold the frame rate.`);
      rung++;
    } else {
      rung = shed.length; // holding budget — stop measuring, keep what we have
    }
    frame = WARMUP; // next rung measures a fresh window, no second warm-up
    missed = 0;
  };

  return {
    render(t) {
      grade.uniforms.uTime.value = t % 100;
      composer.render();
      watch();
    },
    setSize: (w, h) => resize(w, h),
    dispose() { composer.dispose(); },
    composer, gtao, bloom, grade,
  };
}

// ---------- shade auto smooth ----------
// Blender's single most-repeated modelling note — "your shading is wrong
// because your normals are wrong" — and its fix, Shade Auto Smooth: average a
// vertex's normals across the faces that meet gently, and leave the ones that
// meet sharply alone. three's equivalent is toCreasedNormals.
//
// It matters here because ExtrudeGeometry finishes with computeVertexNormals()
// on NON-INDEXED geometry, which is flat shading: every triangle gets its own
// normal and nothing is ever averaged. So every round-arched opening in this
// hall — the transverse arches you walk under, the mirror aediculae, the grand
// portico — was a 36-sided polygon wearing 36 separate flat facets, each one
// catching the sun at its own angle. That faceted arc, banding round the
// intrados of every arch, is the clearest "this is a game asset" tell in the
// building. Creasing at 32° averages along the curve and keeps every
// structural arris — face to bevel, bevel to reveal — dead sharp.
//
// Assigned from init once the addon resolves; identity until then, so a failed
// CDN fetch costs shading quality and nothing else.
let crease = (geo) => geo;

// Arch frame: rectangle with a round-arched opening, extruded. Base sits at y=0.
function makeArchGeometry(THREE) {
  const outer = new THREE.Shape();
  outer.moveTo(-1.7, 0); outer.lineTo(-1.7, 5); outer.lineTo(1.7, 5);
  outer.lineTo(1.7, 0); outer.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-1.3, 0); hole.lineTo(-1.3, 3.4);
  hole.absarc(0, 3.4, 1.3, Math.PI, 0, true);
  hole.lineTo(1.3, 0); hole.closePath();
  outer.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(outer, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, curveSegments: 40 });
  geo.translate(0, 0, -0.14);
  return crease(geo, 0.56); // ≈32°
}

// Mirror pane: the arch opening itself, slightly inset.
function makePaneGeometry(THREE) {
  const s = new THREE.Shape();
  s.moveTo(-1.26, 0.02); s.lineTo(-1.26, 3.4);
  s.absarc(0, 3.4, 1.26, Math.PI, 0, true);
  s.lineTo(1.26, 0.02); s.closePath();
  return new THREE.ShapeGeometry(s, 40);
}

// ---------- the world beyond the mirror ----------
// Crossing the grand pane lands you INSIDE the image it was reflecting: the
// same pastel sky (the env texture becomes the background), a soft sun halo,
// and a sheet of glassy still water that ripples under the cursor. The finale
// text floats over the water as real geometry. Returns
// { group, hitTargets, water, addRipple, update }.
function buildVoid(THREE, renderer, { archGeo, paneGeo, crystal, mirrorBase, VOID_Z, envTex, statuePromise, restageShadows }) {
  const group = new THREE.Group();
  group.visible = false;

  // ---- centrepiece: the Discobolus on a round pedestal ----
  // SMK Royal Cast Collection scan of Myron's Discus Thrower (CC0,
  // thingiverse:1894078), re-dressed in this hall's marble. The geometry
  // carries every sculpted muscle line; light and clearcoat do the rest.
  const centrepiece = new THREE.Group();
  centrepiece.position.set(0, 0, VOID_Z + 1); // close enough to command the frame
  group.add(centrepiece);
  // Repainted with the hall: crossing the mirror must not cross a white
  // balance. The beyond IS the image the panes were reflecting, so a cream
  // centrepiece behind a lavender-white hall breaks the one illusion the whole
  // scroll is built on.
  const statueMarble = new THREE.MeshPhysicalMaterial({
    color: 0xf4f2fa, metalness: 0.03, roughness: 0.4,
    clearcoat: 0.3, clearcoatRoughness: 0.5,
    sheen: 0.4, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xf4f0ff),
    iridescence: 0.15, iridescenceIOR: 1.3, iridescenceThicknessRange: [120, 360],
    envMap: envTex, envMapIntensity: 0.55,
  });
  // museum lighting: a raking key with its own tight shadow map — this is
  // what carves the musculature — and a cool rim to lift the silhouette
  const key = new THREE.SpotLight(0xfffaf6, 90, 34, 0.44, 0.6, 2);
  key.position.set(-7, 9.5, VOID_Z + 8);
  key.target.position.set(0, 2.6, VOID_Z + 1);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 26;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.03;
  group.add(key, key.target);
  const rim = new THREE.SpotLight(0xc6bfff, 50, 34, 0.5, 0.7, 2);
  rim.position.set(6.5, 6, VOID_Z - 8);
  rim.target.position.set(0, 3, VOID_Z + 1);
  group.add(rim, rim.target);
  const pedCyl = (r, h, y) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 64), statueMarble);
    m.position.y = y + h / 2;
    m.castShadow = m.receiveShadow = true;
    centrepiece.add(m);
  };
  pedCyl(1.62, 0.16, 0);    // base disc
  pedCyl(1.34, 0.34, 0.16); // drum
  pedCyl(1.5, 0.14, 0.5);   // cap
  const PED_TOP = 0.64;
  // thin gilt band around the drum
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(1.36, 0.016, 8, 72),
    new THREE.MeshPhysicalMaterial({ color: 0xded3bd, metalness: 1, roughness: 0.30, envMap: envTex, envMapIntensity: 1.0 })
  );
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.42;
  centrepiece.add(band);
  let reflection = null;
  statuePromise.then((statueScene) => {
    statueScene.traverse((o) => {
      if (o.isMesh) {
        o.material = statueMarble;
        o.castShadow = o.receiveShadow = true;
      }
    });
    statueScene.scale.setScalar(4.9 / 1682); // the scan is life-size, in mm
    statueScene.position.y = PED_TOP;
    statueScene.rotation.y = 0; // facing the visitor, as in the photograph
    centrepiece.add(statueScene);
    // mirror image under the translucent water sheet
    reflection = centrepiece.clone(true);
    reflection.scale.y = -1;
    reflection.position.y = -0.05;
    reflection.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = false; });
    group.add(reflection);
    restageShadows(); // the museum spot's map is on demand too
  }).catch(() => {
    // model unreachable → the crystal mirror endures on the pedestal
    const frame = new THREE.Mesh(archGeo, crystal);
    frame.scale.setScalar(1.5);
    frame.position.y = PED_TOP;
    centrepiece.add(frame);
    const pane = new THREE.Mesh(paneGeo, mirrorBase.clone());
    pane.scale.setScalar(1.47);
    pane.position.set(0, PED_TOP + 0.04, 0.06);
    centrepiece.add(pane);
  });

  // the soft sun halo — the white orb the mirror preview promised
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(THREE), transparent: true, depthWrite: false,
    opacity: 0.9, toneMapped: false,
  }));
  glow.position.set(0, 3.9, VOID_Z - 1.5);
  glow.scale.set(24, 17, 1);
  group.add(glow);

  // ---- still water: a glassy env-mirror sheet; ripples are rings painted
  // into a bump map so the reflection shimmers without moving a vertex ----
  const waterProps = {
    color: 0xaac6e6, metalness: 1, roughness: 0.05,
    envMap: envTex, envMapIntensity: 1.4,
    transparent: true, opacity: 0.88, // the statue's mirror image shows through
  };
  const farWater = new THREE.Mesh(new THREE.PlaneGeometry(320, 240), new THREE.MeshPhysicalMaterial(waterProps));
  farWater.rotation.x = -Math.PI / 2;
  farWater.position.set(0, -0.03, -110);
  group.add(farWater);

  // The rippled patch drives three channels at once for a real disturbance:
  //   displacement — crests physically rise and catch the light,
  //   bump         — fine wave shading across each packet,
  //   roughness    — disturbed water frosts, blurring the mirror reflection.
  const RSIZE = 64, RCX = 0, RCZ = -80, S = 512; // patch, world → canvas px
  // 512² (was 1024²): the packets are soft and the whole sheet is re-uploaded
  // to the GPU every frame a ripple is alive, so the smaller map is ~4× cheaper
  // to stream and reads identically at this blur.
  const rc = document.createElement("canvas");
  rc.width = rc.height = S;
  const rg = rc.getContext("2d");
  rg.fillStyle = "#808080";
  rg.fillRect(0, 0, S, S);
  const rippleTex = new THREE.CanvasTexture(rc);
  const SR = 256;
  const fc = document.createElement("canvas");
  fc.width = fc.height = SR;
  const fg = fc.getContext("2d");
  fg.fillStyle = "#101018"; // near-black roughness = mirror-still
  fg.fillRect(0, 0, SR, SR);
  const roughTex = new THREE.CanvasTexture(fc);
  for (const tx of [rippleTex, roughTex]) { // streamed every frame — skip mip rebuilds
    tx.generateMipmaps = false;
    tx.minFilter = THREE.LinearFilter;
  }
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(RSIZE, RSIZE, 256, 256),
    new THREE.MeshPhysicalMaterial({
      ...waterProps,
      roughness: 1, roughnessMap: roughTex,
      bumpMap: rippleTex, bumpScale: 3.2,
      displacementMap: rippleTex, displacementScale: 0.32, displacementBias: -0.16,
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(RCX, 0, RCZ);
  group.add(water);

  const ripples = [];
  let canvasDirty = false;
  const SPEED = 2.0, LIFE = 4.5, LAM = 0.85; // slow, long-lived, dreamlike
  const addRipple = (x, z) => {
    // keep packets clear of the patch edge so displaced crests never lift it
    if (Math.abs(x - RCX) > RSIZE / 2 - 10 || Math.abs(z - RCZ) > RSIZE / 2 - 10) return;
    if (ripples.length < 40) ripples.push({ x, z, t0: null });
  };
  // One radial gradient per ripple: three crests/troughs trailing the leading
  // edge with a decaying envelope — a spreading wave packet, not a drawn circle.
  const paintPacket = (ctx, size, r, R, amp, isBump) => {
    const ppu = size / RSIZE;
    const px = (r.x - RCX + RSIZE / 2) * ppu;
    const py = (r.z - RCZ + RSIZE / 2) * ppu;
    const r0 = Math.max(0, R - 2.6 * LAM), r1 = R + 0.5;
    if (r1 * ppu < 2) return;
    const g = ctx.createRadialGradient(px, py, r0 * ppu, px, py, r1 * ppu);
    const stop = (radius, style) => {
      const s = (radius - r0) / (r1 - r0);
      if (s > 0 && s < 1) g.addColorStop(s, style);
    };
    g.addColorStop(0, "rgba(128,128,128,0)");
    for (let k = 2; k >= 0; k--) {
      const env = Math.min(1, amp * [1, 0.55, 0.28][k]);
      const cr = R - k * LAM, tr = R - (k + 0.5) * LAM;
      if (isBump) {
        stop(tr, `rgba(0,0,0,${(env * 0.95).toFixed(3)})`);
        stop(cr, `rgba(255,255,255,${(env * 0.95).toFixed(3)})`);
      } else { // roughness: both faces of the wave frost and scatter light
        stop(tr, `rgba(170,180,210,${(env * 0.6).toFixed(3)})`);
        stop(cr, `rgba(235,240,255,${(env * 0.85).toFixed(3)})`);
      }
    }
    g.addColorStop(1, "rgba(128,128,128,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r1 * ppu, 0, Math.PI * 2);
    ctx.fill();
    // fresh-touch splash: a frost bloom at the origin that quickly clears
    if (!isBump && R < 1.6) {
      const a = (1 - R / 1.6) * 0.6;
      const gb = ctx.createRadialGradient(px, py, 0, px, py, 0.9 * ppu);
      gb.addColorStop(0, `rgba(235,240,255,${a.toFixed(3)})`);
      gb.addColorStop(1, "rgba(235,240,255,0)");
      ctx.fillStyle = gb;
      ctx.beginPath();
      ctx.arc(px, py, 0.9 * ppu, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const drawRipples = (t) => {
    if (!ripples.length && !canvasDirty) return;
    rg.fillStyle = "#808080";
    rg.fillRect(0, 0, S, S);
    fg.fillStyle = "#101018";
    fg.fillRect(0, 0, SR, SR);
    canvasDirty = false;
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      if (r.t0 === null) r.t0 = t;
      const age = t - r.t0;
      const R = age * SPEED;
      const amp = Math.pow(Math.max(0, 1 - age / LIFE), 1.5) / (1 + R * 0.18); // fades + spreads
      // retire once it has faded to invisibility, not just at LIFE — this frees
      // the packet budget sooner so a moving cursor keeps spawning fresh rings
      if (age > LIFE || amp < 0.015) { ripples.splice(i, 1); continue; }
      canvasDirty = true;
      paintPacket(rg, S, r, R, amp, true);
      paintPacket(fg, SR, r, R, amp, false);
    }
    rippleTex.needsUpdate = true;
    roughTex.needsUpdate = true;
  };

  // The finale, set in type. Sizes here are SCREEN-legibility numbers, not
  // composition ones: at the old widths the title minified ~4:1 into its own
  // white halo (grey mush) and the smallprint resolved to ~2.5px per character.
  const title = makeTextPlane(THREE, renderer, {
    text: "Meet your reflection.",
    font: '170px Italiana, "Didot", serif',
    // no plate: at 9.4 units the title resolves near 1:1 and ink-on-sky is
    // already ~13:1 — a plate here only showed up as a rectangle of haze
    fill: "#1b1a24", glow: "rgba(255,255,255,0.85)", blur: 16, width: 9.4,
  });
  title.position.set(0, 6.35, VOID_Z + 2.1); // crowning the statue, not covering it
  group.add(title);

  // the CTA block sits low, across the legs and pedestal: at the old heights it
  // covered the discus arm and torso — the whole reason the statue is there
  const button = makeButtonPlane(THREE, renderer, "Begin analysis", 3.0);
  button.position.set(0, 2.95, VOID_Z + 2.3);
  group.add(button);

  const trust = makeTextPlane(THREE, renderer, {
    text: "100% private. Your photo never leaves this device.",
    font: '600 78px "Albert Sans", sans-serif',
    fill: "#1b1a24", glow: "rgba(255,255,255,0.7)", blur: 8, width: 6.1,
    plate: "rgba(240,238,250,0.82)",
  });
  trust.position.set(0, 1.98, VOID_Z + 2.3);
  group.add(trust);

  const smallprint = makeTextPlane(THREE, renderer, {
    // two lines: one 78-character line can only be legible at a width that
    // overruns the statue entirely
    text: ["Educational estimates rooted in facial-aesthetics", "research, not medical advice."],
    font: '400 56px "Albert Sans", sans-serif',
    fill: "#3f3c52", glow: "rgba(255,255,255,0.7)", blur: 8, width: 5.2,
    plate: "rgba(240,238,250,0.8)",
  });
  smallprint.position.set(0, 1.05, VOID_Z + 2.3);
  group.add(smallprint);

  // a gentle lamp so the crystal frame keeps a little sheen of its own
  const lamp = new THREE.PointLight(0xbfb4ff, 12, 40, 2);
  lamp.position.set(0, 4, VOID_Z + 5);
  group.add(lamp);

  const bob = [
    { m: title, y: title.position.y, s: 0.8, a: 0.07, ph: 0 },
    { m: button, y: button.position.y, s: 0.65, a: 0.055, ph: 1.3 },
    { m: trust, y: trust.position.y, s: 0.65, a: 0.055, ph: 1.3 },
    { m: smallprint, y: smallprint.position.y, s: 0.65, a: 0.055, ph: 1.3 },
  ];
  let btnScale = 1;
  const update = (t, hover) => {
    if (!REDUCED) {
      for (const b of bob) b.m.position.y = b.y + Math.sin(t * b.s + b.ph) * b.a;
      // the statue turns almost imperceptibly, letting light rake the musculature
      centrepiece.rotation.y = Math.sin(t * 0.11) * 0.16;
      if (reflection) reflection.rotation.y = centrepiece.rotation.y;
    }
    btnScale += ((hover ? 1.07 : 1) - btnScale) * 0.12;
    button.scale.setScalar(btnScale);
    drawRipples(t);
  };

  return { group, hitTargets: [button], water, addRipple, update };
}

// Text on a transparent canvas → plane sized in world units (by width).
// `text` may be a string or an array of lines.
// A blurred halo alone was NOT enough ground here: these planes float over a
// white marble statue, and white-on-white erased the small lines completely.
// `plate` paints a soft pearl lozenge behind the text so it reads over sky,
// water and marble alike — the 3D counterpart of the DOM chapters' scrim.
function makeTextPlane(THREE, renderer, { text, font, fill, glow, blur, width, plate, lineGap = 0.34 }) {
  const lines = Array.isArray(text) ? text : [text];
  const px = parseInt(font.match(/(\d+)px/)[1], 10);
  const lh = Math.ceil(px * (1 + lineGap));
  const scratch = document.createElement("canvas").getContext("2d");
  scratch.font = font;
  const textW = Math.max(...lines.map((l) => Math.ceil(scratch.measureText(l).width) || px * l.length * 0.5));
  // the plate is drawn blurred, so the canvas needs room for its feather too
  const plateBlur = plate ? Math.round(px * 0.22) : 0;
  const pad = blur * 2 + plateBlur * 2 + 24;
  const cv = document.createElement("canvas");
  cv.width = textW + pad * 2;
  cv.height = lh * lines.length + Math.ceil(px * 0.4) + pad * 2;
  const ctx = cv.getContext("2d");
  if (plate) {
    // size the plate to the TEXT box, not to the canvas: the canvas carries a
    // wide feather margin, and insetting from it produced a lozenge far taller
    // than the words, which read as an opaque pill rather than a veil
    const boxW = textW + px * 1.0;
    const boxH = lh * lines.length + px * 0.5;
    ctx.save();
    ctx.filter = `blur(${plateBlur}px)`;
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.roundRect((cv.width - boxW) / 2, (cv.height - boxH) / 2, boxW, boxH, boxH * 0.5);
    ctx.fill();
    ctx.restore();
  }
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (glow && blur > 0) { ctx.shadowColor = glow; ctx.shadowBlur = blur; }
  ctx.fillStyle = fill;
  const y0 = cv.height / 2 - ((lines.length - 1) * lh) / 2;
  for (const [i, l] of lines.entries()) {
    ctx.fillText(l, cv.width / 2, y0 + i * lh);
    if (glow && blur > 0) ctx.fillText(l, cv.width / 2, y0 + i * lh); // double-strike richer halo
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * (cv.height / cv.width)),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false })
  );
  mesh.renderOrder = 3;
  return mesh;
}

// The Begin-analysis pill as a glowing textured plane (clickable via raycast).
function makeButtonPlane(THREE, renderer, label, width) {
  const font = '600 66px "Albert Sans", sans-serif';
  const scratch = document.createElement("canvas").getContext("2d");
  scratch.font = font;
  const textW = Math.ceil(scratch.measureText(label).width) || 460;
  const pillW = textW + 150, pillH = 172, pad = 90;
  const cv = document.createElement("canvas");
  cv.width = pillW + pad * 2;
  cv.height = pillH + pad * 2;
  const ctx = cv.getContext("2d");
  ctx.shadowColor = "rgba(109, 90, 230, 0.85)";
  ctx.shadowBlur = 70;
  ctx.fillStyle = "#6d5ae6";
  ctx.beginPath();
  ctx.roundRect(pad, pad, pillW, pillH, pillH / 2);
  ctx.fill();
  ctx.fill(); // second pass deepens the glow
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffffff";
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cv.width / 2, cv.height / 2 + 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * (cv.height / cv.width)),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false })
  );
  mesh.renderOrder = 4;
  return mesh;
}

// Radial halo texture for the bloom sprite.
function makeGlowTexture(THREE) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.25, "rgba(197,214,255,0.5)");
  g.addColorStop(0.55, "rgba(150,160,255,0.16)");
  g.addColorStop(1, "rgba(150,160,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Pastel environment scene → PMREM texture for reflections/iridescence.
function buildEnvironment(THREE, renderer) {
  const env = new THREE.Scene();
  // This IBL is what every polished surface in the building reflects — the
  // floor sheen, the mirror panes, the gilt, the clearcoat on the casts. It was
  // a sunset studio (coral, rose, gold), so even after the stone and the lights
  // were repainted, every specular highlight in the hall would still have
  // arrived pre-tinted amber. Repainted to a lavender daylight studio.
  // NOT pure white at the zenith. This texture is also the Void's literal
  // background (scene.background = envTex once you cross the mirror), and a
  // white sky behind a white marble Discobolus is a white-out — measured at a
  // mean of 223/255 with the figure ghosting into it. It has to stay pale and
  // luminous while still leaving the cast somewhere to stand.
  const sky = new THREE.Mesh(
    gradientSphere(THREE, 30, "#f6f4fc", "#e6e1f4", "#c2c7e4"),
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })
  );
  env.add(sky);
  const glow = (color, x, y, z, w = 14, h = 10) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  glow("#c9bfe6", -16, 6, -4);   // pale iris
  glow("#d8cfe8", 16, 5, -2);    // wisteria
  glow("#fbfaff", 2, 14, 6);     // clean skylight overhead
  glow("#9aa6cc", 0, 4, 18);     // cool grey-blue behind
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  return tex;
}

// segs matters for the visible sky: at radius 148 a 24×16 sphere has facets
// tens of units across, and interpolating vertex colours over them banded the
// horizon into hard angular slabs (the "broken yellow" polygon over the roof).
function gradientSphere(THREE, r, topHex, midHex, botHex, segs = 24) {
  const geo = new THREE.SphereGeometry(r, segs, Math.round(segs * 0.7));
  const top = new THREE.Color(topHex), mid = new THREE.Color(midHex), bot = new THREE.Color(botHex);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) / r + 1) / 2; // 0 bottom → 1 top
    if (t > 0.5) c.lerpColors(mid, top, (t - 0.5) * 2); else c.lerpColors(bot, mid, t * 2);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

// Sparse drifting motes to give the haze some life.
function makeDust(THREE) {
  const N = 160;
  const base = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    base[i * 3] = (Math.random() - 0.5) * 8;
    base[i * 3 + 1] = 0.3 + Math.random() * 6.5;
    base[i * 3 + 2] = 8 - Math.random() * 72;
    phase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(base.slice(), 3));
  const mat = new THREE.PointsMaterial({
    color: 0xf6f4ff, size: 0.055, transparent: true, opacity: 0.55,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  const update = (t) => {
    const p = geo.getAttribute("position");
    for (let i = 0; i < N; i++) {
      p.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.35 + phase[i]) * 0.18;
      p.array[i * 3] = base[i * 3] + Math.cos(t * 0.22 + phase[i]) * 0.12;
    }
    p.needsUpdate = true;
  };
  return { points, update };
}

// =========================================================================
// The hall — one connected Greek order in pearl marble.
// Heavy on instances, light on draw calls: every part type is batched into a
// single InstancedMesh, and every instance gets an automatic y-flipped twin
// below the floor so the translucent floor reflects the entire order.
// =========================================================================
function buildHall(THREE, renderer, corridor, { zAt, bayZones, MIRROR_Z, mirrorBase, envTex, statuePromise, loadStatue, restageShadows }) {
  // ---- proportions (shared datums; see file header) ----
  const BAY = 2.75;           // intercolumniation
  const Z_START = 3.3;        // first column axis
  const N_BAYS = 21;          // colonnade runs to z = Z_START − 21·BAY ≈ −54.5
  const COL_X = 4.75;         // column centreline
  const WALL_X = 5.30;        // inner wall face (wall slab is 0.6 thick)
  const PODIUM_TOP = 1.10;    // rusticated pedestal course under the order
  const ENT_TOP = 6.24;       // top of cornice = attic/balustrade level
  const colZ = (m) => Z_START - m * BAY;
  let hallSeed = 23; // seeded rng for slab cutting — stable across visits
  const hrnd = () => (hallSeed = (hallSeed * 1664525 + 1013904223) >>> 0) / 4294967296;

  // ---- the stone library ----
  // A real quarry never ships one stone. Five cuts, one family, so elements
  // separate by material instead of silhouette alone:
  //   marble      pearl statuary white — the structural order itself
  //   marbleVeined lilac-pearl ashlar — the wall planes the order stands against
  //   marbleDeep  violet-greyed stone — recessed coffer soffits, keystones
  //   travertine  pale lilac limestone — podium, steps, pier footings
  // The family used to run cream → honey → tan. Five warm stones is five warm
  // stones however the lights are balanced, and the base courses (podium,
  // crepidoma, every pier footing — the whole bottom third of the frame) were
  // the most saturated of them. One pale violet-white quarry now, separated by
  // VALUE rather than by temperature, which is what a real quarry gives you and
  // what keeps the hall reading as one building.
  // DoubleSide because the floor-reflection twins are mirrored (y-flipped).
  // envMapIntensity stays low: the pastel IBL would otherwise flood the sun's
  // direct term and completely wash out the cast shadows.
  // userData.stone opts a material into the batcher's per-block quarry tint.
  // No iridescence, no metalness: stone is a rough dielectric. The old
  // iridescence 0.4 + clearcoat 0.5 was reading as wet plastic, which is what
  // made the whole hall look synthetic however the colours were tuned.
  const marble = new THREE.MeshPhysicalMaterial({
    color: 0xf0eff7, metalness: 0, roughness: 0.44,
    clearcoat: 0.16, clearcoatRoughness: 0.6,
    envMap: envTex, envMapIntensity: 0.32, side: THREE.DoubleSide,
  });
  marble.userData.stone = true;
  const marbleVeined = marble.clone();
  marbleVeined.map = makeMarbleTexture(THREE, renderer);
  marbleVeined.color.set(0xe7e4f0); // pearl, a shade deeper than the order in front of it
  // Pale champagne, not bullion. Gilt runs the length of the hall — the taenia
  // fillet under every frieze, an annulet on every column, the curtain rods,
  // every rosette boss — so at 0xc9a54f it was a saturated gold line down both
  // walls in every frame, and metal takes its whole colour from its albedo.
  // Desaturated ~75% it still reads as precious metal against white stone
  // (silver-gilt, the way a real gilded moulding looks in daylight rather than
  // under a lamp) without laying an amber stripe across the picture.
  const gold = new THREE.MeshPhysicalMaterial({
    color: 0xded3bd, metalness: 1, roughness: 0.30,
    envMap: envTex, envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });
  // polished stone, not chrome: the mirror quality comes from the clearcoat
  // and the reflection twins under it, not from metalness
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: makeFloorTexture(THREE, renderer),
    color: 0xffffff, metalness: 0.06, roughness: 0.3,
    clearcoat: 0.5, clearcoatRoughness: 0.22,
    envMap: envTex, envMapIntensity: 0.3,
    transparent: true, opacity: 0.88,
  });
  // (The old fake-AO `shade` strips are gone: 2cm slivers hugging the exact
  // front face of each moulding, so they z-fought everything they were meant
  // to shade. Proper roughness and the shadow map do that job now.)
  // deep tone: the frieze band, coffers and panel fields sit well below the
  // white order in value, so the order reads against it without shouting
  // weathered grey limestone, only the faintest blue cast — a saturated
  // periwinkle here was the single biggest "toy" tell in the frieze and niches
  const marbleDeep = new THREE.MeshPhysicalMaterial({
    color: 0xb6b3c6, metalness: 0, roughness: 0.56,
    clearcoat: 0.08, clearcoatRoughness: 0.7,
    envMap: envTex, envMapIntensity: 0.26, side: THREE.DoubleSide,
  });
  marbleDeep.userData.stone = true;
  // Pale lilac limestone grounds the hall: everything load-bearing at floor
  // level sits on the same cool banded stone, one value below the order it
  // carries, so the building still reads bottom-heavy without going warm.
  const travertine = new THREE.MeshPhysicalMaterial({
    map: makeTravertineTexture(THREE),
    color: 0xdedaea, metalness: 0, roughness: 0.72,
    clearcoat: 0, envMap: envTex, envMapIntensity: 0.2, side: THREE.DoubleSide,
  });
  travertine.userData.stone = true;
  // long members (steps, footings) stretch any texel into wood grain — the
  // unit-cube UV spans the whole face — so they take the stone plain and let
  // the per-block tint carry the variation
  const travPlain = travertine.clone();
  travPlain.map = null;
  travPlain.color.set(0xd5d1e3);
  // the back of a 34cm-deep recess is in shadow, and a white cast needs a
  // ground to read against: against the pale marbleDeep it used to sit on,
  // the figures had no silhouette at all
  const nicheBack = new THREE.MeshStandardMaterial({
    color: 0x86829a, metalness: 0, roughness: 0.88,
    envMap: envTex, envMapIntensity: 0.16, side: THREE.DoubleSide,
  });
  // niche figures: the six Greek casts. Cloned per figure so each gets its
  // own marble tone (FrontSide: never mirrored).
  // Sheen is the subsurface bloom just inside a polished marble surface — it is
  // what stops a cast reading as painted plaster — but its COLOUR is the tint
  // that lands on every lit curve of every figure. It was 0xfff2e0, so the six
  // casts, the most looked-at objects in the hall, each wore a warm glaze.
  const figureMarble = new THREE.MeshPhysicalMaterial({
    color: 0xf3f1f9, metalness: 0, roughness: 0.5,
    clearcoat: 0.1, clearcoatRoughness: 0.6,
    sheen: 0.3, sheenRoughness: 0.65, sheenColor: new THREE.Color(0xf2eeff),
    envMap: envTex, envMapIntensity: 0.28, // FrontSide: clones are never mirrored
  });
  // Painted trim, now in the site's own accent rather than the reference's
  // cerulean: the drum bands ringing each column, the podium stringcourse, the
  // panel fields. The material is literally named `iris`, and --iris is
  // #6d5ae6 in the stylesheet — this is the hall finally speaking the page's
  // palette. Held pale and chalky (a limewash pigment, not a poster colour) so
  // it stays subordinate to the white order it decorates.
  const iris = new THREE.MeshStandardMaterial({
    color: 0xb4abdc, metalness: 0, roughness: 0.6,
    envMap: envTex, envMapIntensity: 0.3, side: THREE.DoubleSide,
  });
  // Deeper iris for the continuous frieze band and the recessed wall panels —
  // the register the gilt paterae sit in, one value down from the column rings
  // so the band reads as ground and the rings as ornament. Measured against
  // the frame at 0x7d72bc: the panel fields are large, they sit right beside
  // the brightest marble in the picture, and they became the most saturated
  // thing in every shot — a colour block, not a painted wall. Chalked up two
  // steps it reads as limewash again and the order stays the subject.
  const friezeBlue = new THREE.MeshStandardMaterial({
    color: 0x9d96cc, metalness: 0, roughness: 0.62,
    envMap: envTex, envMapIntensity: 0.26, side: THREE.DoubleSide,
  });
  // Navy velvet drapery hung in the bays — the heavy hangings of the
  // reference. Sheen + a little clearcoat give the nap its soft highlight
  // without turning it to plastic; deep indigo so it holds shadow.
  // Base colour was 0x1c2c55 — a red channel of 28, under the ~30–50 sRGB floor
  // a plausible dielectric albedo sits at, so the cloth had nowhere to go but
  // black and every fold collapsed into one flat shape. Lifted just above the
  // floor and given a much stronger nap highlight: on velvet the sheen lobe IS
  // the read, and with the deeper folds it now has normals to catch.
  const navy = new THREE.MeshPhysicalMaterial({
    color: 0x322c5c, metalness: 0, roughness: 0.82,
    sheen: 1, sheenRoughness: 0.42, sheenColor: new THREE.Color(0xb2a4e4),
    clearcoat: 0.08, clearcoatRoughness: 0.7,
    envMap: envTex, envMapIntensity: 0.35, side: THREE.DoubleSide,
  });
  // Torch fire. Emissive only — sixteen real point lights would cost more than
  // everything else in the hall put together, and the sconces never lit
  // anything anyway; they are points of life, not a lighting rig.
  //
  // Lavender, and the last warm thing in the building is now gone with the
  // orbs. A flame reads by being the brightest thing in frame rather than by
  // being orange, so the hue is free to be the site's own: a near-white violet
  // core that the bloom pass spreads into a lilac halo.
  //
  // 1.7, not 2.2: at 2.2 every channel clipped and the fire came out white with
  // a violet rim — the one thing that was asked for was the last thing visible.
  // Just above the bloom's 1.15 threshold the body of the flame keeps its hue
  // and only the very core goes to white, which is what fire actually does.
  //
  // Additive and edge-faded, because an opaque mesh has a SILHOUETTE and fire
  // does not. However good the profile curve was, a solid lathe against white
  // marble cut a hard outline and read as a carved cone — a party hat. Fire is
  // glowing gas: you see least of it where the surface turns edge-on, so fading
  // alpha by how square-on it faces the eye dissolves that outline into a
  // tongue of light. Four lines of shader and one blend mode, which is far
  // cheaper than the usual answers (a particle system, or a scrolling noise
  // texture) and holds up better at this size.
  // color black: with additive blending the lit diffuse term would be ADDED
  // too, so the flame must emit and nothing else.
  const flame = new THREE.MeshStandardMaterial({
    // Saturated violet, not a pale lilac. Additive light lands on white marble,
    // and white + pale lilac is just whiter — the hue only survives if the
    // flame is markedly stronger in blue than in red and green.
    color: 0x000000, emissive: 0xa77dff, emissiveIntensity: 1.55,
    side: THREE.DoubleSide, // the batcher's floor twins are mirrored
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  flame.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
       float rim = abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
       gl_FragColor.a *= smoothstep( 0.0, 0.6, rim );`,
    );
  };

  // ---- instancing batcher + placement helpers ----
  const batch = makeBatcher(THREE, corridor);
  const V = new THREE.Vector3(), S = new THREE.Vector3();
  const Q = new THREE.Quaternion(), EULER = new THREE.Euler();
  const cubeGeo = makeChamferBoxGeo(THREE);
  // Every rectangular member is the same unit cube sized by its matrix —
  // one draw call for all of them together. It carries a 12mm chamfer that the
  // shader keeps world-constant however the matrix stretches the member.
  const cube = (mat, cx, cy, cz, w, h, d, rotY = 0, rotZ = 0, rotX = 0) => {
    Q.setFromEuler(EULER.set(rotX, rotY, rotZ));
    batch.place(cubeGeo, mat, new THREE.Matrix4().compose(V.set(cx, cy, cz), Q, S.set(w, h, d)));
  };
  const put = (geo, mat, x, y, z, scale = 1, rotY = 0, rotX = 0) => {
    Q.setFromEuler(EULER.set(rotX, rotY, 0));
    batch.place(geo, mat, new THREE.Matrix4().compose(V.set(x, y, z), Q, S.set(scale, scale, scale)));
  };

  // ---- part geometries ----
  // Segment counts. Everything here is instanced — ONE copy of each geometry
  // serves every column, arch and rosette in the hall — so a segment count is
  // paid once and a facet is paid in every frame. The old numbers were tuned as
  // if each were a separate mesh: an 8-segment tube on the gilt annulet meant a
  // 45° facet on the most specular object in the building, and a metal
  // highlight is exactly where faceting shows first.
  const shaftGeo = makeFlutedShaftGeo(THREE);              // 20-flute Doric shaft
  const echinusGeo = new THREE.CylinderGeometry(0.35, 0.25, 0.16, 56);
  const torusBaseGeo = new THREE.TorusGeometry(0.30, 0.055, 14, 56);
  const balusterGeo = makeBalusterGeo(THREE);              // unit height, scaled to fit
  const archivoltGeo = new THREE.TorusGeometry(1, 0.05, 14, 80, Math.PI); // unit half-ring
  const panelGeo = makePanelFrameGeo(THREE);               // wall relief-panel frame
  const blockGeo = makeRusticBlockGeo(THREE);              // drafted-margin masonry block
  const keyAedGeo = makeKeystoneGeo(THREE, 0.10, 0.15, 0.64, 0.34);  // mirror aediculae
  const keyArchGeo = makeKeystoneGeo(THREE, 0.17, 0.25, 0.60, 0.40); // transverse arches
  const keyGrandGeo = makeKeystoneGeo(THREE, 0.18, 0.27, 0.62, 0.40); // end portico
  const rosPlateGeo = new THREE.CylinderGeometry(0.155, 0.17, 0.05, 32);
  const rosRingGeo = new THREE.TorusGeometry(0.095, 0.03, 10, 32);
  const rosBossGeo = new THREE.SphereGeometry(0.045, 18, 14); // gilt rosette boss
  const annuletGeo = new THREE.TorusGeometry(0.262, 0.018, 10, 48);
  const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 48); // unit drum, scaled per band
  const drapeGeo = makeDrapeGeo(THREE);                    // one navy hanging, baked to bay size

  // Carved rosette (plate · ring · gilt boss) — flush relief ornament for the
  // metopes and wall panels; replaces the old free-floating rings.
  // The ring rides clear of the backplate's front face (0.025 put its widest
  // circle exactly on that plane — a tangency that z-fights all the way round).
  const rosette = (x, y, z, s, axis) => {
    if (axis === "x") {
      const n = Math.sign(-x); // face the corridor centre
      Q.setFromEuler(EULER.set(0, 0, Math.PI / 2));
      batch.place(rosPlateGeo, marble, new THREE.Matrix4().compose(V.set(x, y, z), Q, S.set(s, s, s)));
      Q.setFromEuler(EULER.set(0, Math.PI / 2, 0));
      batch.place(rosRingGeo, marbleDeep, new THREE.Matrix4().compose(V.set(x + n * 0.045 * s, y, z), Q, S.set(s, s, s)));
      put(rosBossGeo, gold, x + n * 0.052 * s, y, z, s * 0.9);
    } else {
      Q.setFromEuler(EULER.set(Math.PI / 2, 0, 0));
      batch.place(rosPlateGeo, marble, new THREE.Matrix4().compose(V.set(x, y, z), Q, S.set(s, s, s)));
      Q.setFromEuler(EULER.set(0, 0, 0));
      batch.place(rosRingGeo, marbleDeep, new THREE.Matrix4().compose(V.set(x, y, z + 0.045 * s), Q, S.set(s, s, s)));
      put(rosBossGeo, gold, x, y, z + 0.052 * s, s * 0.9);
    }
  };

  // ---- wall torch ----
  // Replaces the sconces' emissive globes, which read as light bulbs on sticks:
  // a hard white sphere on a straight gilt arm is a fitting, not a fire.
  //
  // A marble console carrying a turned bronze torch that leans out into the
  // corridor, with the flame standing in its calyx. Everything here goes
  // through the batcher, so all sixteen torches cost two draw calls between
  // them (one for the bronze, one for the fire) and each gets its mirrored twin
  // in the floor for free — a torch reflected in polished marble is most of
  // what sells them.
  const torchGeo = makeTorchGeo(THREE);
  const flameGeo = makeFlameGeo(THREE);
  const TORCH_TILT = 0.22;  // ~13° out of the wall; more and the calyx reaches
                            // into the plane the drapery hangs in
  const haloAt = [];        // flame centres, for the one shared glow sprite pass
  const torch = (side, zs) => {
    // Console: a block keyed into the wall and the shelf it carries. In the
    // hall's own stone, not the deep grey the old corbel used — these sit at
    // eye level on a white wall and a dark bracket reads as a hole in it.
    cube(marble, side * 5.255, 2.83, zs, 0.15, 0.13, 0.15); // stepped foot — the console's scroll
    cube(marble, side * 5.26, 3.02, zs, 0.14, 0.30, 0.22);  // body, keyed into the wall
    cube(marble, side * 5.20, 3.20, zs, 0.26, 0.07, 0.28);  // shelf
    const bx = side * 5.18, by = 3.21;
    // Tilt is about z, so it leans in the wall's own plane — toward the
    // corridor centre on both sides, hence `side *`.
    Q.setFromEuler(EULER.set(0, 0, side * TORCH_TILT));
    const M = new THREE.Matrix4().compose(V.set(bx, by, zs), Q, S.set(1, 1, 1));
    batch.place(torchGeo, gold, M);   // place() clones, so one matrix serves both
    batch.place(flameGeo, flame, M);
    // Carry the flame's centre through the same tilt so the halo can never
    // drift off the fire it belongs to.
    const h = 0.57;
    haloAt.push(bx - side * Math.sin(TORCH_TILT) * h, by + Math.cos(TORCH_TILT) * h, zs);
  };

  // One Doric column: plinth → torus base → fluted shaft → echinus → abacus.
  // The assembly spans baseY → baseY + 3.80·s, meeting the architrave datum.
  // plinth and abacus are each 4cm oversize so they lap into the podium below
  // and the architrave above instead of meeting them on a shared plane
  const column = (x, z, baseY = PODIUM_TOP, s = 1) => {
    const band = (y, r, h) => batch.place(bandGeo, iris,
      new THREE.Matrix4().compose(V.set(x, y, z), Q.identity(), S.set(r, h, r)));
    cube(marble, x, baseY + 0.06 * s, z, 0.78 * s, 0.16 * s, 0.78 * s);   // plinth
    put(torusBaseGeo, marble, x, baseY + 0.20 * s, z, s, 0, Math.PI / 2); // base moulding
    put(shaftGeo, marble, x, baseY, z, s);
    // the two cerulean bands — the signature of the reference hall: one low on
    // the shaft above the base, one at the necking under the capital. Slightly
    // proud of the flute crests (shaft r 0.30→0.245) so each reads as a ring.
    band(baseY + 0.72 * s, 0.318 * s, 0.20 * s);
    band(baseY + 3.34 * s, 0.268 * s, 0.16 * s);
    put(annuletGeo, gold, x, baseY + 3.50 * s, z, s, 0, Math.PI / 2);     // gilt annulet
    put(echinusGeo, marble, x, baseY + 3.60 * s, z, s);
    cube(marble, x, baseY + 3.76 * s, z, 0.76 * s, 0.16 * s, 0.76 * s);   // abacus
  };

  // ---- rhythm: mirror bays snap to column axes; arches fill the gaps ----
  const mirrorAxes = bayZones.map((zone) => Math.round((Z_START - zAt(zone)) / BAY));
  const isMirrorAxis = (m) => mirrorAxes.includes(m);
  const nearMirror = (z, pad) => mirrorAxes.some((m) => Math.abs(colZ(m) - z) < pad);
  // Transverse arches: greedily every other axis, 2+ bays clear of any mirror.
  const frameAxes = [];
  let lastFrame = -2;
  for (let m = 0; m < N_BAYS; m++) {
    if (colZ(m) < -54) break;
    if (m - lastFrame < 2) continue;
    if (mirrorAxes.some((mm) => Math.abs(mm - m) < 2)) continue;
    frameAxes.push(m);
    lastFrame = m;
  }
  // Every OTHER arch carries a pair of figure niches on its camera-facing pier
  // face (section 3.5). Hoisted up here because the drapery has to know where
  // the figures stand before it decides which bays it may hang in.
  const nicheAxes = frameAxes.filter((_, i) => i % 2 === 1);

  // =====================================================================
  // 1. Shell: floor, veined side walls, rusticated podium, step.
  // =====================================================================
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 90), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -28);
  floor.receiveShadow = true;
  corridor.add(floor);

  // Everything that "sits on the floor" is dropped 6cm below it instead of
  // landing on y=0 — a face on the floor plane z-fights the floor itself.
  const wallGeo = new THREE.BoxGeometry(0.6, ENT_TOP + 0.06, 63);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(wallGeo, marbleVeined);
    wall.position.set(side * (WALL_X + 0.3), ENT_TOP / 2 - 0.03, -27); // z 4.5 → −58.5
    wall.castShadow = wall.receiveShadow = true;
    corridor.add(wall);
    const refl = wall.clone(); // mirror twin under the translucent floor
    refl.scale.y = -1;
    // keep its top 9cm UNDER the floor (matching the batcher twins' drop):
    // mirroring the dropped wall about y=0 would push the twin above the
    // floor as a ridge, and a bare 3cm read as shimmer at grazing angles
    refl.position.y = -(ENT_TOP + 0.06) / 2 - 0.09;
    corridor.add(refl);
  }

  // The podium dies into each transverse arch pier rather than passing through
  // it — the pier is what carries the arch down to the floor, so the bench
  // has to stop against it. podRuns is the same break list the entablature
  // uses, sized to the pier footing (z ±0.33).
  const PIER_HALF = 0.31;
  // Masonry stops here; the cap then returns CAP_LIP further, so the bench
  // ends under its own cap instead of the courses each running out to a
  // different z. They used to: the cap stopped at −55 while the block loops
  // ran `z > -55` and then drew a full 1.32/1.44 block from there, so the
  // three courses overshot it by 1.34, 0.95 and 0.24 — the ragged, stepped end.
  // −55.45 keeps the whole assembly clear of the bottom tread's face (−55.60).
  const POD_END = -55.45, CAP_LIP = 0.10;
  const podRuns = [];
  {
    let start = 4.4;
    for (const zc of frameAxes.map(colZ)) {
      if (zc + PIER_HALF < start) podRuns.push([start, zc + PIER_HALF]);
      start = zc - PIER_HALF;
    }
    podRuns.push([start, POD_END]);
  }
  for (const side of [-1, 1]) {
    // Courses are laid INSIDE each run and clamped to it, rather than laid
    // continuously and then point-tested against the piers. The old test
    // sampled a block at only 3 points, so one straddling a pier (spanning
    // colZ−1.005 … colZ+0.315) passed all three and drove straight through
    // the pedestal — the overlapping blocks at the statue ledges. Clamping
    // to the interval makes that impossible, and the last block of each run
    // is simply cut short instead of overrunning.
    for (const [zA, zB] of podRuns) {
      // kerbstone step at the foot — separate blocks so each takes its own
      // quarry tint, the joints reading as tone breaks
      for (let z = zA; z > zB + 0.12; z -= 1.48) {
        const far = Math.max(z - 1.44, zB);
        cube(travPlain, side * 4.22, 0.10, (z + far) / 2, 0.36, 0.24, z - far); // skirt below the floor plane
      }
      // pedestal: two staggered courses of drafted-margin travertine blocks
      for (let course = 0; course < 2; course++) {
        const y = 0.255 + course * 0.52;
        for (let z = zA - (course % 2 ? 0.71 : 0); z > zB + 0.12; z -= 1.42) {
          const far = Math.max(z - 1.32, zB);
          Q.setFromEuler(EULER.set(0, side * Math.PI / 2, 0));
          // local x is the 1.32 length and maps to world z after the ±90° turn,
          // so a short last block is just an x-scale
          batch.place(blockGeo, travertine, new THREE.Matrix4().compose(
            V.set(side * 4.38, y, (z + far) / 2), Q, S.set((z - far) / 1.32, 1, 1)));
        }
      }
    }
    podRuns.forEach(([zA, zB], i) => {
      const capB = i === podRuns.length - 1 ? zB - CAP_LIP : zB; // cap returns over the end
      const capCz = (zA + capB) / 2, capLen = zA - capB;
      const cz = (zA + zB) / 2, len = zA - zB;
      if (len < 0.06) return;
      cube(marble, side * 4.95, 1.05, capCz, 1.30, 0.10, capLen); // podium cap 1.00–1.10
      cube(iris, side * 4.31, 1.115, capCz, 0.03, 0.05, capLen);  // stringcourse — the floor runner carried up
      // Border course at the podium foot. It used to end at x 4.04 — exactly
      // the kerbstone's inner face — and float 3mm over the floor, so three
      // surfaces fought inside 13mm and strobed grey/tan along the colonnade.
      // Now it laps 6cm under the kerb and 3cm below the floor.
      cube(marbleDeep, side * 3.86, -0.008, cz, 0.48, 0.045, len);
    });
  }

  // =====================================================================
  // 2. Colonnade + the continuous entablature down both walls.
  // =====================================================================
  for (let m = 0; m <= N_BAYS; m++) {
    if (isMirrorAxis(m)) continue; // an aedicula replaces this column
    column(COL_X, colZ(m));
    column(-COL_X, colZ(m));
    // pilaster answering each column on the wall behind — a third layer of
    // depth (wall → pilaster → column) so the bays read as real recesses
    if (frameAxes.includes(m)) continue; // the arch ring owns those junctions
    for (const side of [-1, 1]) {
      // pilasters lap 4cm INTO the wall (to x 5.34) rather than stopping on its
      // face at 5.30 — see WALL_LAP below
      cube(marble, side * (WALL_X - 0.05), 3.0, colZ(m), 0.18, 3.80, 0.62);   // shaft
      cube(marble, side * (WALL_X - 0.07), 4.83, colZ(m), 0.22, 0.18, 0.72);  // cap  4.74–4.92
      cube(marble, side * (WALL_X - 0.07), 1.17, colZ(m), 0.22, 0.18, 0.72);  // base 1.08–1.26
    }
  }

  // ---- abutment rule ----
  // Two solids that stop on the SAME plane z-fight: the depth buffer can't
  // order coplanar faces, so the pair flickers (this is what striped the top
  // of the walls, where the architrave's back face landed exactly on the wall
  // face at x = WALL_X). Every member now laps a few cm into whatever it dies
  // into. WALL_LAP is the far edge for anything meeting the side walls.
  const WALL_LAP = WALL_X + 0.04; // 5.34
  // The entablature is CUT at each transverse arch instead of tunnelling
  // through it: runs stop 2cm inside the arch pier and the arch ring's own
  // dressed face carries the mouldings across. Running it straight through
  // also put the wall corona and the arch top on the same ENT_TOP plane.
  const BREAK = 0.26;
  const entRuns = [];
  {
    let start = 5.3;
    for (const zc of frameAxes.map(colZ)) {
      if (zc + BREAK < start) entRuns.push([start, zc + BREAK]);
      start = zc - BREAK;
    }
    entRuns.push([start, -56.7]);
  }
  const atArch = (z, pad = BREAK + 0.06) => frameAxes.some((m) => Math.abs(colZ(m) - z) < pad);

  for (const side of [-1, 1]) {
    const sx = (v) => side * v;
    // Entablature front faces (architrave 4.36, corona 4.27) sit over the
    // column capitals (abacus front 4.37); backs all lap into the wall.
    for (const [zA, zB] of entRuns) {
      const cz = (zA + zB) / 2, len = zA - zB;
      if (len < 0.06) continue;
      const band = (mat, front, yc, h) => cube(mat, sx((front + WALL_LAP) / 2), yc, cz, WALL_LAP - front, h, len);
      band(marble,     4.36, 5.11,  0.42); // architrave   4.900–5.320
      band(gold,       4.34, 5.36,  0.07); // gilt taenia fillet under the frieze
      band(friezeBlue, 4.48, 5.64,  0.51); // blue frieze band  5.385–5.895
      band(marble,     4.42, 5.955, 0.13); // dentil bed   5.890–6.020
      band(marble,     4.27, 6.12,  0.22); // corona       6.010–6.230
      band(marble,     4.60, 6.275, 0.11); // attic bottom rail 6.22–6.33
      band(marble,     4.58, 6.815, 0.11); // handrail
    }
    for (let z = 5.2; z > -54; z -= 0.36) {
      if (atArch(z, 0.34)) continue;
      put(balusterGeo, marble, sx(4.85), 6.33, z, 0.43);
    }
    // posts close the balustrade where the run breaks (0.56 deep laps the rails)
    for (const m of frameAxes) cube(marble, sx(4.85), 6.58, colZ(m), 0.30, 0.72, 0.56);

    // frieze dress: triglyphs over columns AND bay midpoints, carved rosette metopes
    for (let k = 0; k <= 41; k++) {
      const z = Z_START - k * (BAY / 2);
      if (!nearMirror(z, 2.1) && !atArch(z, 0.45)) {
        // 0.50 tall: inset in the 0.51 frieze band, not flush with its edges
        for (const dz of [-0.11, 0, 0.11]) cube(marble, sx(4.455), 5.64, z + dz, 0.13, 0.50, 0.085); // keyed 4cm into the frieze
      }
      const zm = z - BAY / 4; // metope centre
      if (zm > -54 && !nearMirror(zm, 2.1) && !atArch(zm, 0.4)) rosette(sx(4.47), 5.64, zm, 1, "x");
    }
    // dentil course, inset in its bed and stopping at each arch
    for (let z = 5.2; z > -56; z -= 0.17) {
      if (atArch(z)) continue;
      cube(marble, sx(4.40), 5.96, z, 0.14, 0.13, 0.09); // laps up into the corona soffit
    }

    // Wall between bays: a single shallow blue-fielded panel in a marble frame
    // — the calm coffered wall of the reference, not the old busy stack of
    // breccia slab + reglets + medallion (that competing ornament, plus the
    // amphorae, was the "cluttered" read). In the draped bays the navy hanging
    // covers it entirely; it only shows where a bay carries no curtain.
    for (let m = 0; m < N_BAYS; m++) {
      const z = colZ(m) - BAY / 2;
      if (nearMirror(z, 2.5) || atArch(z, 0.8) || z < -52) continue;
      Q.setFromEuler(EULER.set(0, -side * Math.PI / 2, 0));
      batch.place(panelGeo, marble, new THREE.Matrix4().compose(V.set(sx(WALL_LAP - 0.02), 3.0, z), Q, S.set(1, 1, 1))); // moulded frame
      cube(friezeBlue, sx(WALL_X - 0.02), 3.0, z, 0.03, 1.72, 1.16); // recessed blue field
    }
  }

  // =====================================================================
  // 2.5 Drapery — the heavy navy hangings of the reference, one per bay.
  //     Hung in the wall recess just behind the columns (x ±5.18, columns at
  //     4.75) so nothing clips, pooling on the podium bench. A pelmet box +
  //     gilt rod finish the top; the folded sheet does the rest.
  // =====================================================================
  // Hung on the column line (x ±4.72, columns at 4.75) so the curtains fill the
  // intercolumniations the way the reference's do — prominent in the gaps, not
  // buried in the wall recess — pooling on the podium bench, pelmet tucked
  // under the architrave soffit (4.90).
  const DRAPE_X = 4.72, DRAPE_TOP = 4.80;
  const DRAPE_HALF = 1.025;   // half the hanging's own z-length (makeDrapeGeo W 2.05)
  // A niche figure is NOT flush with the pier — it stands on a plinth that
  // projects, and the poses reach up to 0.94 further forward, out to x 4.94.
  // The hanging plane is x 4.55–4.89, so the bay in FRONT of a niche arch is
  // exactly the volume Zeus' arm, the Discobolus' shoulder and Apollo's elbow
  // occupy: they were passing clean through the velvet. atArch(z, 0.9) never
  // caught it because it measures the bay's MIDPOINT, and the midpoint is 1.375
  // clear of the arch while the hanging's near edge is only 0.35 clear.
  // Reach past the pier face that the figure needs, plus clearance:
  const FIGURE_REACH = 1.45;
  const beforeNiche = (z) => nicheAxes.some((m) => z > colZ(m) && z - DRAPE_HALF < colZ(m) + FIGURE_REACH);
  for (let m = 0; m < N_BAYS; m++) {
    const z = colZ(m) - BAY / 2;                 // bay midpoint, between two columns
    if (z < POD_END + 0.8 || z > 4.2) continue;  // stay within the running podium
    if (nearMirror(z, 1.7) || atArch(z, 0.9)) continue; // clear of mirror niches + arch piers
    if (beforeNiche(z)) continue;                // never hang a curtain through (or across) a cast
    for (const side of [-1, 1]) {
      Q.setFromEuler(EULER.set(0, -side * Math.PI / 2, 0)); // local width→z, fold→toward centre
      batch.place(drapeGeo, navy, new THREE.Matrix4().compose(V.set(side * DRAPE_X, 1.12, z), Q, S.set(1, 1, 1)));
      cube(navy, side * DRAPE_X, DRAPE_TOP + 0.06, z, 0.34, 0.20, 2.15); // pelmet, wide enough to cover the deeper gather
      cube(gold, side * (DRAPE_X + 0.07), DRAPE_TOP - 0.03, z, 0.06, 0.06, 2.22); // gilt curtain rod
    }
  }

  // =====================================================================
  // 3. Transverse arches — full rings of the order spanning the corridor,
  //    each crowned by a pediment: the pass-through rhythm of the hall.
  // =====================================================================
  const frameGeo = makeArchWallGeo(THREE, 5.9, ENT_TOP, 2.6, 3.3, 0.5);
  const frameTympanum = makeTympanumGeo(THREE, 5.9, 1.62, 0.38);
  for (const m of frameAxes) {
    const z = colZ(m);
    put(frameGeo, marble, 0, -0.03, z - 0.25);
    // dress the face 2cm PROUD of the pier (its front lands at z+0.28): at
    // z+0.25 the frieze veneer sat inside the solid and never showed
    dressFace(z + 0.30, 5.5, 2.6, 3.3, true); // camera-facing side
    coffers(z, 2.6, 3.3, 0.44);               // coffered soffit inside the arch
    pediment(z, 5.9, 1.62, frameTympanum, 0.38);
    // keystone in the SAME stone as the arch: a contrasting block floating in a
    // white field just reads as a stray box, not as masonry
    put(keyArchGeo, marble, 0, 5.85, z + 0.10);
    for (const side of [-1, 1]) {
      cube(travPlain, side * 4.25, 0.24, z, 3.3, 0.56, 0.66); // pier footing, y −0.04–0.52
      // ONE projecting pedestal per pier — wide enough to cover the whole
      // niche (x 3.00–5.30) and deep enough to underpin it (the niche's face
      // reaches colZ+0.67). The old block stopped at x 3.59 and colZ+0.32, so
      // the niche and the ledge its statue stands on both cantilevered past
      // it; that stack of mismatched projections is what read as overlapping
      // blocks. Every bench course now dies into this single mass instead.
      cube(travPlain, side * 4.11, 0.485, z + 0.19, 2.98, 1.07, 1.06); // x 2.62–5.60, y −0.05–1.02
      cube(marble, side * 4.11, 1.055, z + 0.19, 3.10, 0.13, 1.18);    // its cap, x 2.56–5.66, y 0.99–1.12
      cube(marble, side * 4.25, 3.38, z, 3.3, 0.18, 0.62);  // impost moulding
    }
  }

  // =====================================================================
  // 3.5 Figure niches — every other transverse arch's pier faces carry a
  //     shallow arched niche holding a Greek cast. Six different figures, one
  //     per niche (FIGURES below); they arrive async, each from its own GLB.
  // =====================================================================
  // The transverse pier's front face (extrude 0.5 from colZ−0.25, + 0.03 bevel)
  // lands at colZ + 0.28. NOTHING in the niche may share that plane: coplanar
  // faces z-fight, which is what made the backing flicker between blue and
  // stone as the camera moved. Every part is seated off PIER_FACE with
  // clearance, and the backing's rear is buried inside the pier so no gap shows.
  const PIER_FACE = 0.28;
  const BACK_CLEAR = 0.05;    // backing front, proud of the pier
  const REVEAL = 0.34;        // how deep the recess reads
  const nicheGeo = makeArchWallGeo(THREE, 1.15, 2.50, 0.78, 1.55, REVEAL);
  const statueSpots = [];
  const niche = (x, sillY, pierZ) => {
    const baseY = sillY - 0.05;           // lap down into the podium cap, never share its top plane
    const back = pierZ + BACK_CLEAR;      // plane of the backing's front face
    cube(nicheBack, x, baseY + 1.26, back - 0.03, 1.5, 2.44, 0.06); // backing (rear buried in the pier)
    put(nicheGeo, marble, x, baseY, back);                           // surround: a REVEAL-deep recess
    cube(travPlain, x, baseY + 0.17, back + 0.17, 0.86, 0.44, 0.34); // plinth 1.00–1.44, foot keyed into the pier cap
    statueSpots.push({ x, y: baseY + 0.39, z: back + 0.02 });
  };
  // Every OTHER arch carries a pair of figure niches, matched across the hall
  // (a colonnade is bilaterally symmetric). The amphorae are gone — a pot on a
  // plinth beside a marble cast was half the "cluttered" read — so a niche now
  // only ever holds a statue, and the intervening piers stay clean blank faces.
  // Skipping the first arch keeps the pair of 275k-triangle casts out of the
  // frustum you enter on; the arches you walk toward get the figures.
  // nicheAxes (every other arch) is computed up with frameAxes so the drapery
  // can avoid exactly these piers — the two must never disagree.
  for (const m of nicheAxes) {
    for (const side of [-1, 1]) niche(side * 4.15, PODIUM_TOP, colZ(m) + PIER_FACE);
  }
  // (No facade niches: at x ±4.0 they intersected the portico columns, and the
  // temple front already carries its pediment, medallion and acroteria.)
  // Six different casts, one per niche — the hall repeats nothing. (The
  // Discobolus is the one figure seen twice, and deliberately: the last one
  // you pass before the mirror is the one waiting, monumental, beyond it.)
  // statueSpots fills left-then-right per arch, so the list pairs up down
  // the hall: the two canonical contrapposto figures face each other, then
  // the two draped ones, then the two in mid-action. Each turns
  // a few degrees toward the corridor centre (+yaw faces +x), and carries
  // its own marble tone — a rank of identically-white casts is the tell
  // that they came out of one file.
  const FIGURES = [
    { file: "doryphoros",       yaw:  0.14, tone: 0xf0eef7 }, // Polykleitos' canon
    { file: "venus-de-milo",    yaw: -0.14, tone: 0xf5f3fb },
    { file: "apollo-belvedere", yaw:  0.10, tone: 0xeeecf6 },
    { file: "kore",             yaw: -0.10, tone: 0xf2eff4 }, // archaic: the one with a hair of warmth left
    { file: "discobolus",       yaw:  0.22, tone: 0xedecf5 },
    { file: "zeus-artemision",  yaw: -0.05, tone: 0xe9e8f3 }, // widest span: keep him frontal
  ];
  const box = new THREE.Box3(), size = new THREE.Vector3(), vtx = new THREE.Vector3();
  // A flung-out pose drags its bounding-box centre with it — centring the
  // Discobolus that way hangs his base slab off the side of the plinth.
  // Centre on the footprint (the lowest tenth of the figure) instead.
  const footCentreX = (obj, bounds) => {
    const cut = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.1;
    let lo = Infinity, hi = -Infinity;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        vtx.fromBufferAttribute(pos, v).applyMatrix4(o.matrixWorld);
        if (vtx.y > cut) continue;
        if (vtx.x < lo) lo = vtx.x;
        if (vtx.x > hi) hi = vtx.x;
      }
    });
    return lo > hi ? (bounds.min.x + bounds.max.x) / 2 : (lo + hi) / 2;
  };
  statueSpots.forEach((spot, i) => {
    const fig = FIGURES[i % FIGURES.length];
    // The Discobolus is already in flight for the beyond; reuse that load.
    (fig.file === "discobolus" ? statuePromise : loadStatue(fig.file)).then((src) => {
      const st = src.clone(true);
      const mat = figureMarble.clone();
      mat.color.setHex(fig.tone);
      st.traverse((o) => {
        if (o.isMesh) { o.material = mat; o.castShadow = o.receiveShadow = true; }
      });
      // Fit AFTER rotating, from the figure's own bounds: these poses range
      // from a 0.52-wide kore to Zeus' 2.15 arm span, and the scale has to
      // respect the width the pose actually presents. Reset the scale first
      // — the beyond mutates the shared Discobolus scene to its own size.
      st.scale.setScalar(1);
      st.rotation.y = fig.yaw;
      st.position.set(0, 0, 0);
      st.updateMatrixWorld(true);
      box.setFromObject(st).getSize(size);
      st.scale.setScalar(Math.min(1.45 / size.x, 1.9 / size.y));
      st.updateMatrixWorld(true);
      // Seat by the rotated box: feet on the plinth, back edge clear of the
      // backing. Placing by a guessed offset is what buried the trailing leg
      // and discus arm inside the pier.
      box.setFromObject(st);
      st.position.set(
        spot.x - footCentreX(st, box),
        spot.y - box.min.y,
        spot.z - box.min.z,
      );
      corridor.add(st);
      restageShadows(); // the shadow map is on demand now; this cast is new to it
    }).catch(() => {}); // figure unreachable → that niche stands as an empty alcove
  });
  // ponytail: 6 distinct scans ≈ 1.6M tris, no geometry shared between them;
  // swap in decimated GLBs if low-end machines stutter

  // Museum key lights. A 275k-triangle scan is wasted under the flat frontal
  // wash the travelling lantern gives it — musculature only appears when
  // something rakes across it. One spot per side, riding to whichever pair of
  // niches is nearest the visitor: six static spots would cost six times as
  // much for the two that are ever in view. No shadow maps — the hall's
  // instanced meshes span the whole corridor, so nothing would cull out of a
  // second shadow pass.
  const nicheKeys = [-1, 1].map((side) => {
    const key = new THREE.SpotLight(0xfdfaff, 30, 9, 0.62, 0.75, 2);
    key.target.position.set(side * 4.15, 1.9, 0);
    corridor.add(key, key.target);
    return key;
  });
  const nicheZs = [...new Set(statueSpots.map((s) => s.z))];

  // =====================================================================
  // 4. Mirror aediculae — arched niches IN the wall between two columns:
  //    archivolt + keystone over the arch, a little pediment breaking in
  //    front of the frieze. The mirror pane sits recessed inside.
  // =====================================================================
  // 3.88 tall from 4cm below the podium top: laps the cap below and the
  // architrave above (4.94 > 4.90) instead of landing flat on either datum
  const aedGeo = makeArchWallGeo(THREE, 1.62, 3.88, 1.35, 1.54, 0.35);
  const aedTympanum = makeTympanumGeo(THREE, 1.9, 1.05, 0.22);
  const paneGeoSmall = makePaneGeo(THREE, 1.29, 1.44, 0.06);
  const panes = [];
  for (const m of mirrorAxes) {
    const z = colZ(m);
    for (const side of [-1, 1]) {
      // niche face extrudes from the wall toward the corridor (x → ±4.95)
      Q.setFromEuler(EULER.set(0, -side * Math.PI / 2, 0));
      batch.place(aedGeo, marble, new THREE.Matrix4().compose(V.set(side * (WALL_X + 0.02), PODIUM_TOP - 0.04, z), Q, S.set(1, 1, 1)));
      // archivolt hugging the arch + keystone
      Q.setFromEuler(EULER.set(0, -side * Math.PI / 2, 0));
      batch.place(archivoltGeo, marble, new THREE.Matrix4().compose(V.set(side * 4.94, PODIUM_TOP + 1.5, z), Q, S.set(1.42, 1.42, 1)));
      // keystone springs AT the crown (3.95) and rises past the archivolt's
      // outer edge (4.09), so it wedges the arch instead of hanging into it
      put(keyAedGeo, marble, side * 5.06, 3.90, z, 1, -side * Math.PI / 2);
      pedimentSide(side, z, 1.9, 1.05, aedTympanum);
      for (const s2 of [-1, 1]) torch(side, z + s2 * 2.1);
      // the mirror itself
      const pane = new THREE.Mesh(paneGeoSmall, mirrorBase.clone());
      pane.position.set(side * (WALL_X - 0.18), PODIUM_TOP, z);
      pane.rotation.y = -side * Math.PI / 2;
      pane.userData.z = z;
      panes.push(pane);
      corridor.add(pane);
    }
  }

  // =====================================================================
  // 5. End portico — the temple front around the grand mirror you cross.
  // =====================================================================
  const PORTICO_Z = -57.0;
  // crepidoma: three travertine steps up to the platform — the same warm
  // stone the podium stands on, so the whole hall shares one foundation;
  // blocked out per course so the quarry tint articulates the joints
  // Crepidoma: ONE slab per tread, each lapping 4cm into the one below (and
  // the bottom one below the floor) rather than resting on its top face.
  // It used to be a row of blocks on a 1.475 pitch that were only 1.435 long,
  // so a 4cm slot opened between every pair and the flight read as scattered
  // slabs. Butting them exactly is no good either: neighbours then share a
  // vertical face, and two coincident double-sided faces z-fight — that showed
  // as a flickering seam straight down the centre line.
  // Half-width 5.22 stops 8cm clear of the side walls (inner face 5.30)
  // instead of burying the ends in them, and still carries the portico
  // columns at x ±4.7 (plinth reaches 5.14). Backs run to −58.9 so they
  // don't land on the closing wall's own rear plane.
  // Widths step back too, not just depths: a real crepidoma sets back on every
  // exposed side. Sharing one side plane at x ±5.22 left all three treads
  // coincident there. Top tread stays ≥5.16 to carry the x ±4.7 column plinths.
  for (const [y, cz, d, w] of [[0.09, -57.25, 3.3, 10.44], [0.31, -57.45, 2.9, 10.38], [0.53, -57.65, 2.5, 10.32]]) {
    cube(travPlain, 0, y, cz, w, 0.26, d);
  }
  // facade wall holding the grand arch (front face z −57.85)
  const grandGeo = makeArchWallGeo(THREE, 5.9, ENT_TOP, 2.2, 3.8, 0.5);
  put(grandGeo, marble, 0, -0.03, -58.35);
  put(archivoltGeo, marble, 0, 3.8, -57.83, 2.32);
  coffers(-58.1, 2.2, 3.8, 0.44); // coffered soffit inside the grand arch
  put(keyGrandGeo, marble, 0, 5.95, -57.95); // keystone, same stone as the arch
  // paired columns carrying the portico entablature + pediment
  for (const x of [-4.7, -3.3, 3.3, 4.7]) column(x, PORTICO_Z, 0.66, 1.116);
  cube(marble, 0, 5.11, PORTICO_Z, 11.8, 0.42, 0.78);
  cube(gold, 0, 5.355, PORTICO_Z, 11.8, 0.07, 0.82); // gilt taenia fillet
  cube(friezeBlue, 0, 5.64, PORTICO_Z, 11.8, 0.51, 0.66);
  cube(marble, 0, 6.13, PORTICO_Z, 11.8, 0.22, 1.0);
  dressFace(PORTICO_Z + 0.36, 5.6, 0, 0, false);
  const grandTympanum = makeTympanumGeo(THREE, 5.9, 1.65, 0.4);
  pediment(PORTICO_Z, 5.9, 1.65, grandTympanum, 0.4);
  rosette(0, 6.82, PORTICO_Z + 0.24, 3.0, "z"); // grand tympanum medallion
  cube(marble, 0, 8.04, PORTICO_Z, 0.34, 0.30, 0.34);     // apex acroterion
  cube(marble, -5.75, 6.42, PORTICO_Z, 0.32, 0.26, 0.32); // corner acroteria
  cube(marble, 5.75, 6.42, PORTICO_Z, 0.32, 0.26, 0.32);
  // the grand mirror at the crossing plane, and a closing wall behind it
  const endPane = new THREE.Mesh(makePaneGeo(THREE, 2.16, 3.74, 0.06), mirrorBase.clone());
  endPane.position.set(0, 0, MIRROR_Z);
  endPane.userData.z = MIRROR_Z;
  endPane.material.emissive = new THREE.Color(0xffffff);
  endPane.material.emissiveIntensity = 0;
  panes.push(endPane);
  corridor.add(endPane);
  cube(marble, 0, 3.49, -58.6, 11.8, 7.04, 0.4);

  // =====================================================================
  // 6. Coffered ceiling over the nave — the reference's roof. It spans only
  //    the central span (x ±4.5); an open clerestory slot is left on each side
  //    (4.5 → wall balustrade) so the steep sun still pours in and the floor
  //    stays lit, the way a real top-lit basilica works. Broken at each
  //    transverse arch, whose pediment rides above it. Coffers = a recessed
  //    slab with a protruding beam grid.
  // =====================================================================
  const CEIL_HALF = 4.5, CEIL_Y = 6.46;
  for (const [zA, zB] of entRuns) {
    const cz = (zA + zB) / 2, len = zA - zB;
    if (len < 0.5) continue;
    cube(marble, 0, CEIL_Y, cz, CEIL_HALF * 2, 0.12, len);              // ceiling slab (coffer backs)
    for (const x of [-3.6, -1.8, 0, 1.8, 3.6])                          // longitudinal coffer ribs
      cube(marble, x, CEIL_Y - 0.11, cz, 0.16, 0.15, len);
    for (let z = zA - 0.9; z > zB + 0.2; z -= 1.5)                      // transverse coffer ribs
      cube(marble, 0, CEIL_Y - 0.11, z, CEIL_HALF * 2, 0.15, 0.16);
  }

  // The torches' halo. Every flame in the hall is ONE Points object — sixteen
  // billboards in a single draw call — rather than sixteen Sprites, which
  // cannot batch and would each cost their own. It reuses the soft radial
  // texture the beyond's sun halo already builds, additively blended and tinted
  // lilac: this is the light spilling off the fire, and the flame mesh alone
  // stops at its own silhouette.
  const haloMat = new THREE.PointsMaterial({
    map: makeGlowTexture(THREE), color: 0xb8a4ff, size: 0.46,
    transparent: true, opacity: 0.42, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute("position", new THREE.Float32BufferAttribute(haloAt, 3));
  corridor.add(new THREE.Points(haloGeo, haloMat));

  batch.commit();
  return { panes, endPane, nicheKeys, nicheZs, flame, haloMat };

  // ---- local builders (they share the batcher, materials and datums) ----

  // Coffering along an arch's soffit — the curved underside you pass beneath.
  //
  // This used to be nine 0.40-wide grey plates on an 0.85 arc pitch, sitting
  // 5mm PROUD of the soffit: gaps wider than the plates, in a contrasting stone
  // on a white ground, so they read as a row of tabs floating around every arch
  // rather than as masonry. Two things were wrong. Spacing — the tutorial's
  // "even spread": a coffered soffit is a continuous run of panels, so the
  // panel has to own its pitch and the rib is what's left between. And relief
  // direction — a coffer is a RECESS, but the arch here is a solid with a hole
  // punched in it, so there is nothing to sink a panel into. The only honest
  // way to build it is the way a plasterer would: lay a rib frame proud of the
  // soffit and let the field sit down inside it.
  //
  // So: a continuous chain of panels over the arc, each framed by a transverse
  // rib at its joint and two longitudinal fillets along the soffit edges, all
  // in the arch's own stone; the field is a deeper tone set 6.5cm below the rib
  // faces. The frame casts the shadow that makes the recess read.
  function coffers(z, radius, springY, depth) {
    const A0 = 7 * Math.PI / 180, A1 = Math.PI - A0; // stop clear of the springing
    const N = 11;                                   // odd, so a rib lands on the crown axis
    const step = (A1 - A0) / N;
    const RIB = 0.10, FIELD = 0.035, LAP = 0.03;    // proud of the soffit; lap back into it
    // seat a member by the face it presents, and bury its back in the masonry
    // rather than landing it flat on the soffit plane (the hall's lap rule)
    const at = (mat, th, prd, tanW, dep, dz = 0) => {
      const t = prd + LAP, rc = radius - prd + t / 2;
      cube(mat, Math.cos(th) * rc, springY + Math.sin(th) * rc, z + dz,
        tanW, t, dep, 0, th + Math.PI / 2);
    };
    const chord = 2 * radius * Math.sin(step / 2);  // the panel's true arc pitch
    for (let k = 0; k < N; k++) {
      const mid = A0 + (k + 0.5) * step;
      at(marbleDeep, mid, FIELD, chord - 0.09, depth - 0.14);          // the field, set down
      for (const s of [-1, 1])                                          // longitudinal fillets
        at(marble, mid, RIB, chord, 0.06, s * (depth - 0.06) / 2);
    }
    for (let k = 0; k <= N; k++) at(marble, A0 + k * step, RIB, 0.07, depth); // transverse ribs
  }

  // Entablature dress across a transverse face: triglyphs, wreath metopes,
  // dentils — identical to the walls', so every ring reads as one order.
  function dressFace(faceZ, halfW, openHalf, springY, imposts) {
    // blue frieze band in two segments, clear of the arch opening below it
    const seg = (halfW - 0.1) - 1.35;
    if (seg > 0.1) for (const s of [-1, 1]) cube(friezeBlue, s * (1.35 + seg / 2), 5.64, faceZ - 0.02, seg, 0.5, 0.03);
    for (let k = -4; k <= 4; k++) {
      const x = k * 1.375;
      if (Math.abs(x) < 0.55) continue; // keystone / opening zone
      if (Math.abs(x) <= halfW - 0.4) {
        for (const dx of [-0.11, 0, 0.11]) cube(marble, x + dx, 5.64, faceZ, 0.10, 0.52, 0.07);
      }
      const xm = x + 0.6875;
      if (Math.abs(xm) <= halfW - 0.4 && Math.abs(xm) > 1.3) {
        rosette(xm, 5.64, faceZ, 1, "z");
      }
    }
    for (let x = -halfW + 0.15; x <= halfW - 0.15; x += 0.17) {
      cube(marble, x, 5.955, faceZ, 0.09, 0.13, 0.10);
    }
    if (imposts) {
      const w = halfW - openHalf + 0.15;
      for (const side of [-1, 1]) {
        cube(marble, side * (openHalf - 0.05 + w / 2), springY + 0.02, faceZ, w, 0.16, 0.10);
      }
    }
  }

  // Full-width triangular pediment straddling a transverse element:
  // tympanum slab + horizontal cornice + raking cornices.
  function pediment(z, halfSpan, rise, tympGeo, depth) {
    put(tympGeo, marble, 0, ENT_TOP - 0.04, z); // laps below ENT_TOP: the arch top sits on that plane
    cube(marble, 0, ENT_TOP + 0.02, z, halfSpan * 2 + 0.3, 0.16, depth + 0.34);
    const len = Math.hypot(halfSpan, rise) + 0.15;
    const ang = Math.atan2(rise, halfSpan);
    for (const side of [-1, 1]) {
      cube(marble, side * halfSpan / 2, ENT_TOP + rise / 2 + 0.06, z, len, 0.15, depth + 0.3, 0, -side * ang);
    }
  }

  // The aediculae's little pediment, mounted on a side wall (span runs in z,
  // projecting just proud of the architrave so it breaks the frieze plane).
  // These numbers were set against an older entablature and never re-datumed
  // when the wall runs moved, so the pediment had drifted BEHIND the very
  // frieze it is supposed to break: the tympanum's face landed at x 4.55 with
  // the frieze band's face at 4.48, burying it completely, and the raking
  // cornices landed at exactly 4.48 — coplanar with that same face, which is
  // why the pediment rendered as a dithering triangle stencilled into the blue
  // band instead of as masonry standing in front of it.
  // The entablature fronts it has to clear, outermost first:
  //   corona 4.27 · architrave 4.36 · frieze band 4.48
  // so the whole assembly comes forward of 4.27 and every piece laps back into
  // the frieze rather than landing on it.
  function pedimentSide(side, z, halfSpan, rise, tympGeo) {
    const baseY = 4.86; // tucks up under the architrave rather than butting its 4.90 soffit
    put(tympGeo, marble, side * 4.40, baseY, z, 1, -side * Math.PI / 2); // face 4.29, laps to 4.51
    cube(marble, side * 4.35, baseY + 0.02, z, 0.42, 0.14, halfSpan * 2 + 0.26); // face 4.14, laps to 4.56
    const len = Math.hypot(halfSpan, rise) + 0.12;
    const ang = Math.atan2(rise, halfSpan);
    for (const s2 of [-1, 1]) {
      cube(marble, side * 4.35, baseY + rise / 2 + 0.05, z + s2 * halfSpan / 2,
        0.42, 0.13, len, 0, 0, s2 * ang);
    }
  }
}

// Batches placements per geometry+material pair into InstancedMeshes, adding
// a y-flipped twin of every instance for the translucent floor's reflection.
// (Keying by geometry alone collapsed every unit-cube member into the first
// material placed — the whole two-tone order rendered flat pearl.)
// The twin is nudged 6cm down so extrude-bevel skirts (which dip just below
// a part's base) can't poke back up through the floor plane as a ridge.
// Stone materials (userData.stone) get a per-block quarry tint — a slight
// warm/cool shade jitter, because no two blocks come off the same bed.
function makeBatcher(THREE, parent) {
  const groups = new Map(); // geo → Map(mat → matrices)
  // 12cm drop: parts now skirt up to 5cm below the floor, so a 6cm drop left
  // twin tops ~1cm under the translucent floor plane — they shimmered through
  // it at grazing angles. The bigger reflection offset hides behind the podium.
  const FLIP = new THREE.Matrix4().makeTranslation(0, -0.12, 0)
    .multiply(new THREE.Matrix4().makeScale(1, -1, 1));
  return {
    place(geo, mat, matrix) {
      let byMat = groups.get(geo);
      if (!byMat) groups.set(geo, (byMat = new Map()));
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(matrix.clone(), FLIP.clone().multiply(matrix));
    },
    commit() {
      let seed = 11; // seeded: the quarry looks the same every visit
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const tint = new THREE.Color();
      for (const [geo, byMat] of groups) {
        for (const [mat0, list] of byMat) {
          // the chamfer box needs the shader that scales its arris per instance
          const mat = geo.userData.chamfer ? chamferVariant(mat0) : mat0;
          const mesh = new THREE.InstancedMesh(geo, mat, list.length);
          list.forEach((m, i) => mesh.setMatrixAt(i, m));
          if (mat.userData.stone) {
            for (let i = 0; i < list.length; i += 2) { // reflection twin keeps its block's tint
              // Quarry jitter. Hue 0.09 is orange: half of every stone surface in
            // the hall — podium, steps, coffers, the order itself — was being
            // nudged warm by the batcher, underneath whatever colour the
            // material asked for. Both hues now sit either side of violet, so
            // the jitter reads as bed-to-bed variation in ONE pale lilac quarry.
            tint.setHSL(rnd() < 0.5 ? 0.72 : 0.62, 0.02 + rnd() * 0.05, 0.945 + rnd() * 0.055);
              mesh.setColorAt(i, tint);
              mesh.setColorAt(i + 1, tint);
            }
            mesh.instanceColor.needsUpdate = true;
          }
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = mesh.receiveShadow = true;
          parent.add(mesh);
        }
      }
    },
  };
}

// ---------- chamfered unit box ----------
// Nothing in the physical world has a mathematically sharp edge: a dressed
// stone arris is a millimetre or two of chamfer, and that chamfer is what
// catches a highlight and tells the eye "this is a solid block". Every
// rectangular member of this hall was a raw BoxGeometry — 90° arrises, no
// highlight, which is most of why the marble read as flat white paper.
//
// The catch: all ~4300 members share ONE unit cube and get their size from a
// non-uniform instance matrix (the wall is scaled 63 long, a reglet 0.03
// thick). A chamfer baked at unit scale would come out 63× too big on one and
// invisible on the other. So the chamfer is applied in the vertex shader,
// divided by the instance's own per-axis scale — constant in WORLD units
// whatever the member. `aInset` marks, per vertex, which single axis that
// vertex slides in along.
//
// Topology is the inner box pushed out: 6 square faces inset by the chamfer on
// their two in-plane axes, 12 rectangular edge bevels, 8 corner triangles — 44
// triangles instead of 12, ~190k for the whole hall, noise next to the 1.6M in
// the casts. (Cutting the faces into octagons instead is the classic mistake:
// the bevels then overrun the corners and the surface stops being closed.)
// Every vertex therefore sits at a cube corner and slides in along exactly TWO
// axes — the two it is NOT a face of.
const CHAMFER = 0.012; // 12mm arris, in world units
function makeChamferBoxGeo(THREE) {
  const pos = [], nor = [], ins = [], idx = [];
  const push = (p, n, i) => { pos.push(...p); nor.push(...n); ins.push(...i); return pos.length / 3 - 1; };
  const unit = (v) => { const L = Math.hypot(...v); return v.map((x) => x / L); };
  // corner at signs s, sliding in on every axis EXCEPT those in `keep`
  const vert = (s, keep, n) => {
    const inset = [0, 1, 2].map((k) => (keep.includes(k) ? 0 : 1));
    return push([s[0] * 0.5, s[1] * 0.5, s[2] * 0.5], n, inset);
  };
  // Wind a polygon so its geometric normal agrees with the intended one.
  // This has to measure the CHAMFERED positions: stored positions all sit on
  // cube corners, so a bevel quad's four are collinear and a corner triangle's
  // three are coincident — the cross product of the raw positions is zero and
  // tells you nothing.
  const face = (verts, n) => {
    const P = verts.map((v) => [0, 1, 2].map((k) =>
      pos[v * 3 + k] - Math.sign(pos[v * 3 + k]) * 0.06 * ins[v * 3 + k]));
    const e1 = P[1].map((x, k) => x - P[0][k]), e2 = P[2].map((x, k) => x - P[0][k]);
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const v = g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0 ? [...verts].reverse() : verts;
    for (let k = 1; k < v.length - 1; k++) idx.push(v[0], v[k], v[k + 1]);
  };
  // 6 faces: full on their own axis, inset on the other two
  for (let a = 0; a < 3; a++) for (const sa of [-1, 1]) {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    const n = [0, 0, 0]; n[a] = sa;
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
      const s = []; s[a] = sa; s[u] = su; s[v] = sv;
      return vert(s, [a], n);
    });
    face(ring, n);
  }
  // 12 edge bevels: full on their two axes, inset on the third (the run) plus
  // the one they lean away from
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;   // the bevel runs along c
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const n = [0, 0, 0]; n[a] = sa; n[b] = sb;
      const nn = unit(n);
      const quad = [];
      for (const sc of [-1, 1]) for (const keep of [a, b]) {
        const s = []; s[a] = sa; s[b] = sb; s[c] = sc;
        quad.push(vert(s, [keep], nn)); // full on the face it springs from, inset on the other two
      }
      face([quad[0], quad[1], quad[3], quad[2]], nn);
    }
  }
  // 8 corner triangles: each vertex keeps one axis full
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const nn = unit([sx, sy, sz]);
    const tri = [0, 1, 2].map((keep) => vert([sx, sy, sz], [keep], nn));
    face(tri, nn);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("aInset", new THREE.Float32BufferAttribute(ins, 3));
  geo.setIndex(idx);
  geo.userData.chamfer = true;
  return geo;
}

// Material variant that knows how to slide `aInset` vertices inward by a
// world-constant amount. Cached per source material: the batcher makes one
// InstancedMesh per (geometry, material) pair, so only the pairs that actually
// use the chamfer box ever compile this.
const chamferVariant = (() => {
  const cache = new WeakMap();
  return (mat) => {
    let v = cache.get(mat);
    if (v) return v;
    v = mat.clone();
    v.onBeforeCompile = (shader) => {
      shader.uniforms.uChamfer = { value: CHAMFER };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
          attribute vec3 aInset;
          uniform float uChamfer;`)
        .replace("#include <begin_vertex>", `
          vec3 transformed = vec3( position );
          #ifdef USE_INSTANCING
            vec3 iScale = vec3( length( instanceMatrix[0].xyz ), length( instanceMatrix[1].xyz ), length( instanceMatrix[2].xyz ) );
          #else
            vec3 iScale = vec3( 1.0 );
          #endif
          // never eat more than 45% of a thin member's own thickness
          vec3 cut = min( uChamfer / max( iScale, vec3( 1e-4 ) ), vec3( 0.45 ) );
          transformed -= sign( position ) * cut * aInset;`);
    };
    // three keys programs by this: without it every clone shares one program
    v.customProgramCacheKey = () => "chamfer";
    cache.set(mat, v);
    return v;
  };
})();

// ---------- classical part geometries ----------

// Doric shaft: 20 flutes, gentle taper (r 0.30 → 0.245), height 3.30,
// spanning local y 0.22 → 3.52 (between the base moulding and echinus).
function makeFlutedShaftGeo(THREE) {
  const geo = new THREE.CylinderGeometry(0.245, 0.30, 3.30, 120, 1, true);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const ang = Math.atan2(z, x);
    const scallop = Math.pow(0.5 - 0.5 * Math.cos(ang * 20), 0.85);
    const k = (r - 0.028 * scallop) / r;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  geo.translate(0, 1.87, 0);
  return geo;
}

// The open sky over the hall: a painted sunset dome (fog off — it IS the
// distance), a low sun down the corridor axis so the walk heads into the
// light, and slow pastel clouds. Lives inside the corridor group, so the
// Void keeps its own heavens.
function makeSky(THREE) {
  const group = new THREE.Group();
  // Periwinkle, not cerulean. The reference's sky is the brightest thing in
  // frame and sets the whole picture's chroma; dropping its saturation and
  // rolling it toward the site's violet is most of what makes the hall read as
  // "lavender and white" rather than "blue and gold".
  // These are also brighter than they look: with the post stack in place the
  // sky is tone-mapped along with everything else (the old `toneMapped: false`
  // only ever applied when drawing straight to the canvas), which is the point
  // — sky and stone finally sit on one response curve instead of two.
  const dome = new THREE.Mesh(
    gradientSphere(THREE, 148, "#a3b4e0", "#d6dcf2", "#f8f7fd", 96), // periwinkle zenith → pale sky → bright horizon
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false })
  );
  dome.position.set(0, 0, -30);
  // Squash the dome: the gradient is keyed to the sphere's own y, so at full
  // height we only ever saw a flat sliver either side of its equator. Flattened,
  // the horizon band sits at eye level and the full sky ramp spans what's
  // actually visible above the colonnade.
  dome.scale.y = 0.4;
  group.add(dome);
  // the sun is a small disc low ahead — a point of light, NOT a sky-wide
  // wash: oversized glow sprites flatten the whole dome into one yellow slab
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(THREE), color: 0xfff4ec, transparent: true,
    depthWrite: false, fog: false, toneMapped: false, opacity: 0.72,
  }));
  sun.position.set(0, 17, -132); // just clears the portico ridge from down the hall
  sun.scale.set(17, 13, 1);
  group.add(sun);
  const cloudTex = makeCloudTexture(THREE);
  const clouds = [];
  let seed = 5;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, color: 0xfcfbff, transparent: true, depthWrite: false,
      fog: false, toneMapped: false, opacity: 0.3 + rnd() * 0.25,
    }));
    // far and high: a cloud parked 20 units from the camera reads as a fog
    // bank across the whole sky, not as weather
    const w = 34 + rnd() * 40;
    c.scale.set(w, w * (0.3 + rnd() * 0.12), 1);
    c.position.set((rnd() - 0.5) * 210, 46 + rnd() * 42, -60 - rnd() * 150);
    c.userData = { x0: c.position.x, sp: 0.4 + rnd() * 0.8, ph: rnd() * Math.PI * 2 };
    clouds.push(c);
    group.add(c);
  }
  const update = (t) => {
    for (const c of clouds) {
      c.position.x = c.userData.x0 + Math.sin(t * 0.05 * c.userData.sp + c.userData.ph) * 6;
    }
  };
  return { group, update };
}

// Soft cumulus billboard: overlapping faint blobs, denser at the centre.
function makeCloudTexture(THREE) {
  const cv = document.createElement("canvas");
  cv.width = 512;
  cv.height = 256;
  const g = cv.getContext("2d");
  let seed = 31;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 26; i++) {
    const x = 90 + rnd() * 332;
    const y = 90 + rnd() * 80 + (Math.abs(x - 256) / 256) * 40; // edges sag: flat base, puffy top
    const r = 24 + rnd() * 46;
    const grad = g.createRadialGradient(x, y - 10, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${(0.10 + rnd() * 0.12).toFixed(3)})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A single navy hanging: a subdivided sheet bent into vertical pleats. Local
// space is baked to the bay — width along x (±W/2), height along y (0 at the
// pooled bottom → H at the rod), pleats displaced along z (which becomes the
// world axis toward the corridor after the ±90° turn). Folds deepen toward the
// floor and the sheet bellies out at mid-height, so it reads as heavy cloth,
// not a curved plane. Bottom edge scallops slightly where it pools.
function makeDrapeGeo(THREE) {
  const W = 2.05, H = 3.66, F = 6;
  // 48×18 gave 8 segments per pleat, which is enough to CARRY a fold but the
  // folds themselves were only ±0.12 deep on a 2.05-wide sheet — a ripple, not
  // drapery — so the hanging rendered as a flat navy board. Heavy velvet gathers
  // to a fraction of its flat width: the folds want to be as deep as they are
  // wide. Density goes up with them (the tutorial's "density matters" — a fold
  // this deep on the old grid would facet).
  const geo = new THREE.PlaneGeometry(W, H, 96, 40);
  const pos = geo.getAttribute("position");
  // Fold depth varies fold to fold; a perfectly regular corrugation is the tell
  // that it came out of a sine wave. Seeded so the hall looks the same each visit.
  let s = 7;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const jitter = Array.from({ length: F + 1 }, () => 0.72 + rnd() * 0.56);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const u = x / W + 0.5;                     // 0..1 across the width
    const v = (y + H / 2) / H;                 // 0..1 bottom→top
    const phase = u * F * Math.PI * 2;
    const k = jitter[Math.min(F, Math.floor(u * F))];
    // Gathered at the rod, falling open toward the floor: the fold is pinched
    // to a third of its depth at the top, full depth where the cloth hangs free.
    // max(0, …): v reaches exactly 1 at the top edge and float error can push it
    // a hair past, and Math.pow(negative, 0.65) is NaN — one NaN vertex poisons
    // the whole bounding box and the hanging stops drawing
    const gather = 0.34 + 0.66 * Math.pow(Math.max(0, 1 - v), 0.65);
    const amp = 0.30 * gather * k;
    const bow = 0.10 * Math.sin(Math.PI * v);  // the whole curtain bellies out
    // sharper crests than troughs — cloth breaks over a fold, it does not
    // sit on a cosine
    const c = Math.cos(phase);
    pos.setZ(i, amp * Math.sign(c) * Math.pow(Math.abs(c), 0.72) + bow);
    let ny = y + H / 2;                         // shift so the bottom edge is at y=0
    if (v < 0.14) ny -= (0.14 - v) / 0.14 * 0.22 * (0.45 + 0.55 * Math.abs(c)); // pools on the bench
    pos.setY(i, ny);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- the divine torch ----------
// A turned bronze torch for the wall consoles: a pointed finial, an astragal
// bead, a slender shaft, and a flared calyx to hold the fire. One lathe, so
// the whole thing is a single instanced geometry.
//
// The profile turns back on itself at the rim (out to 0.086, then in and down
// to the axis) — that is what hollows the cup, so the flame stands IN a brazier
// rather than balancing on a disc. Local y runs 0 at the finial's point to
// 0.518 at the rim; the cup floor is at 0.442.
//
// Proportion is the whole job here. The first cut flared to 0.118 over a 0.022
// shaft — a five-to-one bowl on a stem, which renders as a wine glass, and at a
// distance as a lampshade. A torch is a shaft that happens to end in a cup: the
// shaft is thick enough to grip, the cup barely wider than the fire it holds.
function makeTorchGeo(THREE) {
  const pts = [
    [0.000, 0.000], [0.030, 0.030], [0.038, 0.058], [0.024, 0.086], // finial
    [0.034, 0.104], [0.026, 0.130],                                 // astragal bead
    [0.030, 0.300], [0.034, 0.340],                                 // shaft
    [0.046, 0.368], [0.038, 0.388],                                 // collar
    [0.052, 0.410], [0.072, 0.450],                                 // cup springs
    [0.084, 0.500], [0.086, 0.518],                                 // rim
    [0.072, 0.512], [0.056, 0.470], [0.000, 0.442],                 // and back down inside
  ].map(([x, y]) => new THREE.Vector2(x, y));
  // 42°: the beads and the collar keep their arrises, the swellings between
  // them go smooth. A lathe smooths everything by default, which turns
  // fine turned mouldings into soft wax at this scale.
  return crease(new THREE.LatheGeometry(pts, 24), 0.73);
}

// The flame: an idealised teardrop, not a simulation. Rotationally symmetric
// on purpose — this hall's whole argument is the ideal form of a thing, and a
// perfect flame is a leaf of light, not a noise field. Pre-translated to stand
// in the calyx so it shares the torch's transform exactly and can never drift
// out of the cup.
//
// Left smooth (no crease): an arris on a flame reads as a facet, and a facet
// reads as polygons.
function makeFlameGeo(THREE) {
  // Widest at 0.057, inside the cup's 0.086 rim, so the fire rises OUT of the
  // brazier instead of sitting on top of it like a lid.
  //
  // The curve is the whole thing. Eight points ran almost straight from the
  // shoulder to the tip, and a straight taper is a CONE — it rendered as a
  // party hat. A flame is convex where it swells off the fuel and then concave
  // for the long draw to the tip, so the extra points all go into that draw.
  // Fatter and shorter than the first pass, which was 2.9 tall for every 1
  // wide — at that ratio it is a spike whatever the curve does. A flame at rest
  // is nearer 1.7:1.
  const pts = [
    [0.000, 0.000], [0.038, 0.016], [0.062, 0.042], [0.073, 0.072],
    [0.075, 0.100], [0.069, 0.132], [0.057, 0.166], [0.042, 0.200],
    [0.027, 0.230], [0.013, 0.255], [0.000, 0.275],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, 20);
  geo.translate(0, 0.43, 0); // seated on the cup floor
  return geo;
}

// Classical baluster profile, unit height (lathe).
function makeBalusterGeo(THREE) {
  const pts = [
    [0.105, 0], [0.105, 0.055], [0.06, 0.10], [0.125, 0.26], [0.105, 0.40],
    [0.062, 0.58], [0.05, 0.74], [0.088, 0.82], [0.075, 0.92], [0.11, 0.96], [0.11, 1],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  // 12 radial segments put a 30° facet on a turned baluster, and the balustrade
  // runs the whole length of both walls at eye level — several hundred of them
  // in frame at once. 28 costs one geometry. Creasing at 42° then keeps the
  // profile's real corners (the fillets, the astragal) crisp while the swellings
  // between them go smooth; a lathe smooths everything by default, which is why
  // the turned mouldings had been reading as soft wax.
  return crease(new THREE.LatheGeometry(pts, 28), 0.73);
}

// Rusticated masonry block: 1.32 × 0.5 drafted (bevelled) face extruding 0.5
// into the wall. The bevel margins catch the light as shadow joints.
function makeRusticBlockGeo(THREE) {
  const s = new THREE.Shape();
  s.moveTo(-0.66, -0.25); s.lineTo(0.66, -0.25); s.lineTo(0.66, 0.25); s.lineTo(-0.66, 0.25); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 2 });
}

// Wall with a round-arched opening, extruded. Local: base y=0, extrudes +z.
function makeArchWallGeo(THREE, halfW, height, openHalf, springY, depth) {
  const outer = new THREE.Shape();
  outer.moveTo(-halfW, 0); outer.lineTo(-halfW, height);
  outer.lineTo(halfW, height); outer.lineTo(halfW, 0); outer.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-openHalf, 0); hole.lineTo(-openHalf, springY);
  hole.absarc(0, springY, openHalf, Math.PI, 0, true);
  hole.lineTo(openHalf, 0); hole.closePath();
  outer.holes.push(hole);
  return crease(new THREE.ExtrudeGeometry(outer, {
    depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, curveSegments: 48,
  }), 0.56); // ≈32°: smooth round the intrados, sharp at every arris
}

// Keystone: a real wedge, wider at the top, springing from the arch crown.
// A plain box straddling the crown reads as a tab stuck onto the arch — and
// when it started well below the crown it hung into the opening as a notch.
function makeKeystoneGeo(THREE, halfBot, halfTop, h, depth) {
  const s = new THREE.Shape();
  s.moveTo(-halfBot, 0); s.lineTo(halfBot, 0);
  s.lineTo(halfTop, h); s.lineTo(-halfTop, h); s.closePath();
  return new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1,
  });
}

// Triangular tympanum slab (pediment infill), apex up, base on local y=0.
function makeTympanumGeo(THREE, halfSpan, rise, depth) {
  const s = new THREE.Shape();
  s.moveTo(-halfSpan, 0); s.lineTo(halfSpan, 0); s.lineTo(0, rise); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

// Moulded frame ring for the walls' relief-panel course.
function makePanelFrameGeo(THREE) {
  const outer = new THREE.Shape();
  outer.moveTo(-0.75, -1.05); outer.lineTo(0.75, -1.05); outer.lineTo(0.75, 1.05); outer.lineTo(-0.75, 1.05); outer.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.62, -0.92); hole.lineTo(0.62, -0.92); hole.lineTo(0.62, 0.92); hole.lineTo(-0.62, 0.92); hole.closePath();
  outer.holes.push(hole);
  return new THREE.ExtrudeGeometry(outer, { depth: 0.08, bevelEnabled: false });
}

// Arch-shaped mirror pane. Local: bottom edge at baseY, springs at baseY+springY.
function makePaneGeo(THREE, halfW, springY, baseY) {
  const s = new THREE.Shape();
  s.moveTo(-halfW, baseY); s.lineTo(-halfW, baseY + springY);
  s.absarc(0, baseY + springY, halfW, Math.PI, 0, true);
  s.lineTo(halfW, baseY); s.closePath();
  return new THREE.ShapeGeometry(s, 48);
}

// ---------- hall textures (canvas-painted; the page stays dependency-free) ----------

// Soft pearl marble with faint lavender veining, for the big wall faces.
function makeMarbleTexture(THREE, renderer) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#f7f6fb";
  g.fillRect(0, 0, 512, 512);
  // soft mineral clouds for large-scale tonal depth
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 70 + Math.random() * 150;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(158, 152, 178, 0.06)");
    grad.addColorStop(1, "rgba(158, 152, 178, 0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 42; i++) {
    // Every sixth vein used to be amber. Veining is the one mark that survives
    // at every distance — it tiles 6× across a 63-unit wall — so a warm thread
    // in the ashlar tinted the biggest surfaces in the hall from close up.
    // The accent thread is iris now; the rest are cool violet-greys.
    const accent = i % 6 === 5;
    g.strokeStyle = accent
      ? `rgba(126, 112, 178, ${(0.07 + Math.random() * 0.06).toFixed(3)})`
      : `rgba(${126 + Math.random() * 34 | 0}, ${124 + Math.random() * 34 | 0}, ${152 + Math.random() * 34 | 0}, ${(0.10 + Math.random() * 0.09).toFixed(3)})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    g.beginPath();
    let x = Math.random() * 512, y = Math.random() * 512;
    g.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (Math.random() - 0.3) * 150;
      y += (Math.random() - 0.5) * 120;
      g.quadraticCurveTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 60, x, y);
    }
    g.stroke();
  }
  // ashlar joints — courses and staggered headers, so the wall reads as masonry
  g.strokeStyle = "rgba(124, 118, 146, 0.18)";
  g.lineWidth = 2;
  for (const y of [128, 256, 384]) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.strokeStyle = "rgba(124, 118, 146, 0.12)";
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? 64 : 0;
    for (let x = off; x <= 512; x += 128) {
      g.beginPath(); g.moveTo(x, row * 128); g.lineTo(x, row * 128 + 128); g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

// Pale lilac limestone for the base courses: horizontal strata and pin-hole
// pitting, kept very low-contrast — the drafted block bevels and per-block
// tint do the talking; this just stops the stone reading as painted plastic.
function makeTravertineTexture(THREE) {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  let seed = 97;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  g.fillStyle = "#eceaf3";
  g.fillRect(0, 0, S, S);
  // broad, feathered bedding drifts — mottle, not stripes: fine parallel
  // banding reads as wood grain, exactly what we must avoid
  for (let i = 0; i < 9; i++) {
    const y = rnd() * S, h = 60 + rnd() * 120, x = rnd() * S;
    const grad = g.createRadialGradient(x, y, 0, x, y, h);
    grad.addColorStop(0, `rgba(148, 140, 172, ${(0.05 + rnd() * 0.05).toFixed(3)})`);
    grad.addColorStop(1, "rgba(148, 140, 172, 0)");
    g.fillStyle = grad;
    g.save();
    g.translate(x, y);
    g.scale(2.6, 1); // flattened along the bedding plane
    g.translate(-x, -y);
    g.fillRect(x - h * 2.6, y - h, h * 5.2, h * 2);
    g.restore();
  }
  // pin-hole pitting, elongated along the bedding plane — the travertine tell
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(112, 106, 138, ${(0.06 + rnd() * 0.08).toFixed(3)})`;
    g.beginPath();
    g.ellipse(rnd() * S, rnd() * S, 1.2 + rnd() * 3, 0.6 + rnd() * 1.2, 0, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Marble floor: naturally veined slabs (soft mineral clouds, thin branching
// grey veins with faint halos, a few iris ones) under the processional
// runner. The floor is the single largest surface in frame and the source of
// the bounce light, so its base tone sets the colour of everything lit from
// below; it was #f2ebdd, a sand. The tile repeats 12× along the hall, so every mark is painted at
// y−H / y / y+H for a seamless vertical wrap. Seeded so the look is stable.
function makeFloorTexture(THREE, renderer) {
  const W = 2048, H = 512; // one tile = 30 × 7.5 world units (isotropic ≈68px/unit)
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  let seed = 41;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const wrap = (paint) => {
    for (const dy of [-H, 0, H]) { g.save(); g.translate(0, dy); paint(); g.restore(); }
  };

  g.fillStyle = "#f5f4fa";
  g.fillRect(0, 0, W, H);

  // soft mineral clouds — wisteria and cool grey patches of the stone
  wrap(() => {
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W, y = rnd() * H, r = 90 + rnd() * 220;
      const violet = rnd() < 0.5;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, violet ? "rgba(174, 164, 202, 0.055)" : "rgba(152, 158, 186, 0.06)");
      grad.addColorStop(1, "rgba(152, 158, 186, 0)");
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });

  // veins: random walks with momentum; each gets a wide faint halo, then the
  // crack line itself; some spawn a short branch part-way along
  const veins = [];
  for (let i = 0; i < 20; i++) {
    const amber = i >= 14; // (name kept: these are the accent veins, now iris)
    let x = rnd() * W, y = rnd() * H, ang = rnd() * Math.PI * 2;
    const pts = [[x, y]];
    const segs = 7 + Math.floor(rnd() * 9);
    for (let s = 0; s < segs; s++) {
      ang += (rnd() - 0.5) * 0.9;
      const len = 40 + rnd() * 80;
      x += Math.cos(ang) * len;
      y += Math.sin(ang) * len;
      pts.push([x, y]);
    }
    veins.push({ pts, amber, lw: 0.7 + rnd() * (amber ? 0.6 : 1.1) });
    if (rnd() < 0.4 && pts.length > 4) { // branch
      const [bx, by] = pts[2 + Math.floor(rnd() * (pts.length - 3))];
      let a2 = ang + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.6);
      let x2 = bx, y2 = by;
      const bpts = [[x2, y2]];
      for (let s = 0; s < 3 + rnd() * 3; s++) {
        a2 += (rnd() - 0.5) * 0.8;
        x2 += Math.cos(a2) * (30 + rnd() * 50);
        y2 += Math.sin(a2) * (30 + rnd() * 50);
        bpts.push([x2, y2]);
      }
      veins.push({ pts: bpts, amber, lw: 0.5 + rnd() * 0.5 });
    }
  }
  for (const v of veins) { // bake curve control points so all wrap copies match
    v.ctrl = [];
    for (let i = 1; i < v.pts.length; i++) {
      const [px, py] = v.pts[i - 1], [qx, qy] = v.pts[i];
      v.ctrl.push([px + (qx - px) * 0.5 + (rnd() - 0.5) * 14, py + (qy - py) * 0.5 + (rnd() - 0.5) * 14]);
    }
  }
  const strokeVein = (v, width, style) => {
    g.strokeStyle = style;
    g.lineWidth = width;
    g.lineJoin = g.lineCap = "round";
    g.beginPath();
    g.moveTo(v.pts[0][0], v.pts[0][1]);
    for (let i = 1; i < v.pts.length; i++) {
      g.quadraticCurveTo(v.ctrl[i - 1][0], v.ctrl[i - 1][1], v.pts[i][0], v.pts[i][1]);
    }
    g.stroke();
  };
  wrap(() => { for (const v of veins) strokeVein(v, v.lw * 4, "rgba(138, 132, 158, 0.06)"); }); // halos
  wrap(() => {
    for (const v of veins) {
      strokeVein(v, v.lw, v.amber ? "rgba(118, 102, 176, 0.20)" : "rgba(110, 114, 142, 0.25)");
    }
  });

  // slab joints cut across the veining, then the runner floats on top
  g.strokeStyle = "rgba(116, 110, 138, 0.22)";
  g.lineWidth = 3;
  for (let x = 0; x <= W; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  // The processional runner is the one line that leads the eye down the whole
  // corridor to the vanishing point, so it carries the accent: --iris borders
  // on a pale lilac field, straight off the stylesheet.
  const half = 110; // runner ≈ 1.6 world units each side
  g.fillStyle = "rgba(206, 202, 226, 0.30)";
  g.fillRect(W / 2 - half, 0, half * 2, H);
  g.fillStyle = "rgba(109, 90, 230, 0.34)";
  g.fillRect(W / 2 - half - 10, 0, 6, H);
  g.fillRect(W / 2 + half + 4, 0, 6, H);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 12);
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}
