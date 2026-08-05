// app.js — orchestration: capture, detect, pose-normalize, analyze, render.
import { getLandmarker, getVideoLandmarker, detectImage, IDX, PROFILE_POINTS } from "./landmarks.js";
import * as G from "./geometry3d.js";
import { analyze } from "./analysis.js";
import { buildWarpMesh, computeTargets, renderMorph } from "./morph.js";
import { buildReportHTML } from "./render.js";

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 720; // cap internal canvas resolution for perf

const state = {
  front: null,   // { img, canvas, w, h, det (raw), pxPts, norm, pose }
  side: null,    // { img, canvas, w, h, taps: {key:{x,y}}, tapIdx, done }
  views: [],     // max-mode extra photos [{img,canvas,w,h,det}]
  ready: false,
};

// ---------------------------------------------------------------------------
// Boot: load model
// ---------------------------------------------------------------------------
(async function boot() {
  try {
    await getLandmarker();
    state.ready = true;
    $("analyzeStatus").textContent = "Model ready. Add a front photo to begin.";
    refreshAnalyzeBtn();
  } catch (e) {
    $("analyzeStatus").textContent = "Failed to load the face model (needs internet on first run). " + e.message;
  }
})();

// ---------------------------------------------------------------------------
// Image loading helpers
// ---------------------------------------------------------------------------
function fileToImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    // accept="image/*" offers HEIC, which no browser but Safari decodes. Say so:
    // a rejection nobody explains reads as "the upload button is broken".
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error(/heic|heif/i.test(file.type + file.name)
        ? `Can't read “${file.name}” — iPhone HEIC photos don't decode in this browser. Export or screenshot it as JPEG first.`
        : `Can't read “${file.name}” — try a JPEG or PNG.`));
    };
    img.src = url;
  });
}
function drawToCanvas(img, canvas) {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return { w, h, ctx };
}

// ---------------------------------------------------------------------------
// Frontal capture
// ---------------------------------------------------------------------------
async function setFrontImage(img) {
  const canvas = $("frontCanvas");
  const { w, h } = drawToCanvas(img, canvas);
  canvas.classList.add("show");
  $("frontHint").style.display = "none";
  $("frontStatus").textContent = "Detecting…";
  const lm = await getLandmarker();
  const det = detectImage(lm, canvas);
  if (!det) { $("frontStatus").textContent = "No face found — try a clearer, front-facing photo."; state.front = null; refreshAnalyzeBtn(); return; }
  const pxPts = G.toPixels(det.landmarks, w, h);
  const { pts: norm } = G.poseNormalize(pxPts, IDX);
  const pose = G.headPose(det.transform);
  state.front = { img, canvas, w, h, det, pxPts, norm, pose };
  const q = G.qualityGate(pose);
  $("frontStatus").innerHTML = `Face detected. <span class="pill ${q.level === 'good' ? 'good' : q.level === 'retake' ? 'bad' : 'warn'}">${q.level === 'good' ? 'good alignment' : q.level === 'retake' ? 'too turned — retake ideal' : 'usable'}</span>`;
  refreshAnalyzeBtn();
}

function wireDropzone(dropId, fileId, pickId, onImage, statusId) {
  const dz = $(dropId), file = $(fileId);
  const open = () => file.click();
  // Every failure on this path has to reach the plate. Anything that only
  // rejects a promise leaves the page looking like it ignored the photo.
  const take = async (f) => {
    if (!f) return;
    try { await onImage(await fileToImage(f)); }
    catch (err) { $(statusId).textContent = err.message; }
    file.value = ""; // so re-picking the same file fires change again
  };
  $(dropId).addEventListener("click", (e) => { if (e.target.tagName !== "CANVAS" || !dz.classList.contains("tapping")) open(); });
  if (pickId) $(pickId).addEventListener("click", (e) => { e.stopPropagation(); open(); });
  file.addEventListener("change", () => take(file.files[0]));
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("drag");
    take(e.dataTransfer.files[0]);
  });
}
wireDropzone("frontDrop", "frontFile", "frontPick", setFrontImage, "frontStatus");

// ---------------------------------------------------------------------------
// Webcam
// ---------------------------------------------------------------------------
let stream = null, videoLoop = null, camTarget = setFrontImage;
function wireCam(btnId, onImage) {
  $(btnId).addEventListener("click", async (e) => {
    e.stopPropagation();
    camTarget = onImage;
    $("webcam").hidden = false;
    $("webcam").scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 1280 } });
      const v = $("video"); v.srcObject = stream;
      const vlm = await getVideoLandmarker();
      videoLoop = setInterval(() => {
        if (v.readyState < 2) return;
        const r = vlm.detectForVideo(v, performance.now());
        const pose = r.facialTransformationMatrixes?.[0] ? G.headPose(r.facialTransformationMatrixes[0].data) : null;
        $("camPose").textContent = pose ? `yaw ${pose.yaw.toFixed(0)}° · pitch ${pose.pitch.toFixed(0)}° · roll ${pose.roll.toFixed(0)}°` : "align your face";
      }, 200);
    } catch (err) { $("camPose").textContent = "Camera unavailable: " + err.message; }
  });
}
wireCam("frontCam", setFrontImage);
wireCam("sideCam", setSideImage);
$("closeCam").addEventListener("click", closeCam);
function closeCam() {
  if (videoLoop) clearInterval(videoLoop);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  $("webcam").hidden = true;
}
$("snap").addEventListener("click", async () => {
  const v = $("video");
  const c = document.createElement("canvas");
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  const img = new Image();
  img.onload = () => camTarget(img);
  img.src = c.toDataURL("image/png");
  closeCam();
});

// ---------------------------------------------------------------------------
// Profile capture + manual tap flow
// ---------------------------------------------------------------------------
async function setSideImage(img) {
  const canvas = $("sideCanvas");
  const { w, h } = drawToCanvas(img, canvas);
  canvas.classList.add("show");
  $("sideHint").style.display = "none";
  state.side = { img, canvas, w, h, taps: {}, tapIdx: 0, done: false };
  startTapFlow();
}
wireDropzone("sideDrop", "sideFile", "sidePick", setSideImage, "sideStatus");

function startTapFlow() {
  $("tapflow").hidden = false;
  $("sideCanvas").classList.add("tapping");
  $("sideDrop").classList.add("tapping");
  state.side.tapIdx = 0; state.side.taps = {}; state.side.done = false;
  showTapPrompt();
}
function showTapPrompt() {
  const i = state.side.tapIdx;
  if (i >= PROFILE_POINTS.length) {
    state.side.done = true;
    $("tapInstruction").innerHTML = `<span class="pill good">All points placed ✓</span>`;
    $("sideCanvas").classList.remove("tapping"); $("sideDrop").classList.remove("tapping");
    redrawSide();
    $("sideStatus").textContent = "Profile ready.";
    return;
  }
  const pt = PROFILE_POINTS[i];
  $("tapInstruction").innerHTML = `Tap: <strong>${pt.label}</strong> (${i + 1}/${PROFILE_POINTS.length})<span class="hint">${pt.hint}</span>`;
}
$("sideCanvas").addEventListener("click", (e) => {
  if (!state.side || state.side.done) return;
  const canvas = $("sideCanvas");
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  const pt = PROFILE_POINTS[state.side.tapIdx];
  state.side.taps[pt.key] = { x, y };
  state.side.tapIdx++;
  redrawSide();
  showTapPrompt();
});
$("tapUndo").addEventListener("click", () => {
  if (!state.side || state.side.tapIdx === 0) return;
  state.side.tapIdx--;
  delete state.side.taps[PROFILE_POINTS[state.side.tapIdx].key];
  state.side.done = false;
  $("sideCanvas").classList.add("tapping"); $("sideDrop").classList.add("tapping");
  redrawSide(); showTapPrompt();
});
$("tapRestart").addEventListener("click", startTapFlow);

function redrawSide() {
  const s = state.side; const ctx = s.canvas.getContext("2d");
  drawToCanvas(s.img, s.canvas);
  ctx.font = "12px sans-serif";
  for (const pt of PROFILE_POINTS) {
    const t = s.taps[pt.key]; if (!t) continue;
    ctx.fillStyle = "#3a6df0"; ctx.beginPath(); ctx.arc(t.x, t.y, 4, 0, 7); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 3;
    ctx.strokeText(pt.label, t.x + 6, t.y - 6); ctx.fillText(pt.label, t.x + 6, t.y - 6);
  }
}

// ---------------------------------------------------------------------------
// Accuracy mode toggle → multiview slots
// ---------------------------------------------------------------------------
const MV_LABELS = ["¾ left", "profile left", "¾ right", "profile right"];
document.querySelectorAll('input[name=acc]').forEach((r) =>
  r.addEventListener("change", () => {
    const max = document.querySelector('input[name=acc]:checked').value === "max";
    $("multiviewCard").hidden = !max;
    $("profileBlurb").textContent = max
      ? "Optional in Max mode — triangulation derives profile angles from the extra angles below."
      : "Left or right profile. You'll tap a few points so the profile angles are exact.";
    if (max) buildMvSlots();
  })
);
function buildMvSlots() {
  const wrap = $("multiviewSlots"); wrap.innerHTML = "";
  MV_LABELS.forEach((lab, i) => {
    const slot = document.createElement("div"); slot.className = "mv-slot"; slot.textContent = lab;
    slot.addEventListener("click", () => { $("mvFile").dataset.slot = i; $("mvFile").dataset.label = lab; $("mvFile").click(); });
    wrap.appendChild(slot);
  });
}
$("mvFile").addEventListener("change", async (e) => {
  if (!e.target.files[0]) return;
  const i = +e.target.dataset.slot;
  let img;
  try { img = await fileToImage(e.target.files[0]); }
  catch (err) { $("multiviewSlots").children[i].title = err.message; return; }
  const canvas = document.createElement("canvas");
  const { w, h } = drawToCanvas(img, canvas);
  const lm = await getLandmarker();
  const det = detectImage(lm, canvas);
  state.views[i] = det ? { img, canvas, w, h, det, label: e.target.dataset.label } : null;
  const slot = $("multiviewSlots").children[i];
  slot.innerHTML = ""; const c2 = document.createElement("canvas"); drawToCanvas(img, c2); slot.appendChild(c2);
  if (!det) { slot.title = "no face found"; }
});

// ---------------------------------------------------------------------------
// Analyze
// ---------------------------------------------------------------------------
function refreshAnalyzeBtn() { $("analyzeBtn").disabled = !(state.ready && state.front); }

$("analyzeBtn").addEventListener("click", async () => {
  if (!state.front) return;
  $("analyzeStatus").textContent = "Analyzing…";
  const meta = collectMeta();

  // frontal
  const F = state.front.norm;
  const iris = G.irisScale(state.front.pxPts, IDX);
  const mmPerPx = iris ? iris.mmPerPx : null;

  // profile — from taps, or triangulated in max mode
  let P = null, scaleNote = "";
  const maxMode = meta.accuracy === "max";
  let tri = null;
  if (maxMode && state.views.filter(Boolean).length >= 1) {
    tri = triangulate3D();
    if (tri) { P = profileFrom3D(tri); scaleNote = "profile angles from multi-view 3D reconstruction"; }
  }
  let profileMmPerPx = mmPerPx;
  if (!P && state.side && state.side.done) {
    P = state.side.taps;
    profileMmPerPx = profileScaleFromTaps(P, meta.sex); // per-photo estimate
    scaleNote = "profile angles from tapped landmarks (mm estimated from average face height)";
  }

  const ctx = {
    F, P, mmPerPx: P ? profileMmPerPx : mmPerPx,
    blendshapes: state.front.det.blendshapes, dims: { w: state.front.w, h: state.front.h },
    meta: { ...meta, pose: state.front.pose, quality: G.qualityGate(state.front.pose), scaleNote,
      scaleSource: iris ? "iris (~11.7 mm)" : "unscaled (relative)" },
  };
  const report = analyze(ctx);
  renderReport(report);
  $("report").hidden = false;
  $("report").scrollIntoView({ behavior: "smooth" });
  $("analyzeStatus").textContent = "Done.";
});

function collectMeta() {
  return {
    sex: $("sex").value, age: $("age").value ? +$("age").value : null,
    ethnicity: $("ethnicity").value, goal: $("goal").value, culture: $("culture").value,
    accuracy: document.querySelector('input[name=acc]:checked').value,
    lifestyle: { sleep: +$("sleep").value || null, bodyfat: $("bodyfat").value, stress: $("stress").value, sun: $("sun").value },
  };
}

// Estimate mm/px on the profile photo from tapped trichion→menton vs average face height.
function profileScaleFromTaps(P, sex) {
  if (!P.trichion || !P.menton) return null;
  const px = Math.hypot(P.trichion.x - P.menton.x, P.trichion.y - P.menton.y);
  const avgMM = sex === "m" ? 187 : 175; // Farkas-range trichion–menton
  return px ? avgMM / px : null;
}

// ---------------------------------------------------------------------------
// Max-mode: multi-view triangulation → metric 3D landmarks
// ---------------------------------------------------------------------------
function extractRt(m) {
  // column-major 4x4 → R (row-major 9) + t (3)
  return {
    R: [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]],
    t: [m[12], m[13], m[14]],
  };
}
function triangulate3D() {
  try {
    const views = [];
    const pushView = (v) => {
      if (!v || !v.det || !v.det.transform) return;
      const { R, t } = extractRt(v.det.transform);
      const K = G.nominalK(v.w, v.h);
      const Pm = G.projectionMatrix(K, R, t);
      views.push({ Pm, lm: v.det.landmarks, w: v.w, h: v.h });
    };
    pushView(state.front);
    state.views.forEach(pushView);
    if (views.length < 2) return null;
    const out = {};
    const need = [IDX.glabella, IDX.nasion, IDX.noseTip, IDX.subnasale, IDX.lipTop, IDX.lipBottom,
      IDX.pogonion, IDX.menton, IDX.gonionR, IDX.zygoR];
    for (const idx of need) {
      const obs = views.map((v) => ({ P: v.Pm, x: v.lm[idx].x * v.w, y: v.lm[idx].y * v.h }));
      const X = G.triangulatePoint(obs);
      if (X) out[idx] = X;
    }
    return out;
  } catch { return null; }
}
function profileFrom3D(t) {
  const g = (i) => t[i];
  if (![IDX.glabella, IDX.nasion, IDX.noseTip, IDX.subnasale, IDX.lipTop, IDX.lipBottom, IDX.pogonion, IDX.menton, IDX.gonionR].every((i) => g(i))) return null;
  return {
    glabella: g(IDX.glabella), nasion: g(IDX.nasion), pronasale: g(IDX.noseTip),
    subnasale: g(IDX.subnasale), labSup: g(IDX.lipTop), labInf: g(IDX.lipBottom),
    pogonion: g(IDX.pogonion), menton: g(IDX.menton), gonion: g(IDX.gonionR),
    tragion: g(IDX.zygoR), // approx posterior reference
  };
}

// ===========================================================================
// RENDER — HTML is built in render.js (testable); canvases drawn here.
// ===========================================================================
function renderReport(R) {
  $("report").innerHTML = buildReportHTML(R);
  drawOverlay(R);
  setupMorph(R);
}

// ---------------------------------------------------------------------------
// Overlay drawing
// ---------------------------------------------------------------------------
function drawOverlay(R) {
  const src = state.front;
  const canvas = $("overlayCanvas");
  canvas.width = src.w; canvas.height = src.h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(src.img, 0, 0, src.w, src.h);
  const P = src.pxPts;
  // all landmarks faint
  ctx.fillStyle = "rgba(58,109,240,.5)";
  for (const p of P) { ctx.beginPath(); ctx.arc(p.x, p.y, 1, 0, 7); ctx.fill(); }
  const line = (a, b, col, w = 2) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
  // canthal axes
  line(P[IDX.eyeRInner], P[IDX.eyeROuter], "#e8963a", 2);
  line(P[IDX.eyeLInner], P[IDX.eyeLOuter], "#e8963a", 2);
  // thirds (horizontal lines)
  const yLine = (y, col) => { ctx.strokeStyle = col; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(src.w, y); ctx.stroke(); ctx.setLineDash([]); };
  yLine(P[IDX.foreheadTop].y, "rgba(18,161,80,.7)");
  yLine(P[IDX.glabella].y, "rgba(18,161,80,.7)");
  yLine(P[IDX.subnasale].y, "rgba(18,161,80,.7)");
  yLine(P[IDX.menton].y, "rgba(18,161,80,.7)");
  // fifths (vertical) & midline
  const xLine = (x, col) => { ctx.strokeStyle = col; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, src.h); ctx.stroke(); ctx.setLineDash([]); };
  [IDX.zygoR, IDX.eyeROuter, IDX.eyeRInner, IDX.eyeLInner, IDX.eyeLOuter, IDX.zygoL].forEach((i) => xLine(P[i].x, "rgba(107,149,255,.5)"));
  // symmetry midline
  const midx = (P[IDX.foreheadTop].x + P[IDX.menton].x + P[IDX.subnasale].x) / 3;
  ctx.strokeStyle = "rgba(229,72,77,.8)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(midx, 0); ctx.lineTo(midx, src.h); ctx.stroke();
}

// ---------------------------------------------------------------------------
// Morph
// ---------------------------------------------------------------------------
let morphCache = null;
function setupMorph(R) {
  const src = state.front;
  const canvas = $("morphCanvas");
  canvas.width = src.w; canvas.height = src.h;
  const ctx = canvas.getContext("2d");
  // The mesh carries a pinned border, so an edit that moves the silhouette has
  // tissue to stretch into instead of tearing against a static background.
  const { points, tris, faceCount, freeCount } = buildWarpMesh(src.pxPts, src.w, src.h);
  const frontal = R.results.filter((r) => r.side !== "profile");
  const targetsFor = (mode) => computeTargets(points, { faceCount, freeCount, metrics: frontal, mode, pose: R.pose });
  morphCache = { ctx, img: src.img, points, tris, targetsFor, targets: targetsFor("realistic") };

  const slider = $("morphSlider");
  const draw = () => renderMorph(morphCache.ctx, morphCache.img, morphCache.points,
    morphCache.targets, morphCache.tris, slider.value / 100);
  draw();

  // Coalesce to one render per frame: `input` fires faster than the display
  // refreshes during a drag, and each frame is ~900 clipped triangles.
  let queued = false;
  slider.addEventListener("input", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; draw(); });
  });

  for (const radio of document.querySelectorAll('input[name="morphMode"]')) {
    radio.addEventListener("change", (e) => {
      if (!e.target.checked) return;
      morphCache.targets = morphCache.targetsFor(e.target.value);
      $("morphModeNote").textContent = MORPH_NOTE[e.target.value];
      draw();
    });
  }

  // Every ideal range describes a face seen straight on. Turn the head and a
  // width reads shorter than it is, so the morph holds back — and says so,
  // rather than quietly showing a correction aimed at the wrong number.
  const trust = morphCache.targets.applied?.poseTrust ?? 1;
  if (trust < 0.97) {
    $("morphPoseNote").textContent =
      `Your head is turned about ${Math.round(Math.abs(R.pose.yaw))}° and tilted ${Math.round(Math.abs(R.pose.pitch))}°, `
      + `so the measurements below are read off a foreshortened view. The morph is scaled to `
      + `${Math.round(trust * 100)}% to match how much of it can be trusted at that angle — a straight-on photo gives a truer preview.`;
  }
}
const MORPH_NOTE = {
  realistic: "Bounded to what soft-tissue work, dermatology and grooming actually move — every edit is scaled by the same improvability figure the protocol above uses.",
  formulaic: "Unbounded: every measurement driven the whole way to its ideal range, including the parts of your face that only bone surgery would change. Shown for contrast, not as a target.",
};
