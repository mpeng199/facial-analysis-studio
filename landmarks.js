// landmarks.js — MediaPipe FaceLandmarker loader + canonical landmark indices.
//
// MediaPipe returns 478 landmarks (468 mesh + 10 iris) as normalized {x,y,z}
// where x is normalized by image WIDTH, y by image HEIGHT (so they must be
// multiplied back by pixel dimensions before any distance/angle is computed),
// and z is a relative depth in ~the same scale as x.
//
// The index set below is the widely-used canonical FaceMesh mapping. A handful
// are approximate (marked) because soft-tissue points like zygion/gonion have no
// exact mesh vertex; we pick the closest stable vertex. ponytail: these are
// tuned against the canonical map, adjust a specific index if an overlay looks off.

const TASKS_VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12";

export const IDX = {
  // Eyes — canthi (corners). "R"/"L" are the subject's right/left.
  eyeROuter: 33, eyeRInner: 133, // subject right eye: lateral(outer)=33, medial(inner)=133
  eyeLInner: 362, eyeLOuter: 263, // subject left eye:  medial(inner)=362, lateral(outer)=263
  eyeRTop: 159, eyeRBottom: 145,   // right eye vertical extremes (palpebral aperture)
  eyeLTop: 386, eyeLBottom: 374,   // left eye vertical extremes
  // Iris (metric scale). Center + 4 ring points per eye.
  irisRCenter: 468, irisRRing: [469, 470, 471, 472],
  irisLCenter: 473, irisLRing: [474, 475, 476, 477],
  // Brows — apex (peak) and inner head.
  browRApex: 105, browRInner: 55, browRTail: 46,
  browLApex: 334, browLInner: 285, browLTail: 276,
  // Nose
  nasion: 168,      // sellion / bridge dip between eyes (approx)
  noseTip: 4,       // pronasale
  subnasale: 2,     // where columella meets philtrum
  alaR: 129, alaL: 358,        // alar outer points (nose width) — approx
  alaRInner: 98, alaLInner: 327,
  // Lips (vermilion border)
  mouthR: 61, mouthL: 291,     // oral commissures (corners)
  lipTop: 0,                    // labrale superius (cupid's bow center, outer border)
  lipBottom: 17,                // labrale inferius (lower vermilion, outer border)
  lipInnerTop: 13, lipInnerBottom: 14,
  cupidL: 37, cupidR: 267,     // cupid's bow peaks
  // Face oval / width
  zygoR: 234, zygoL: 454,      // widest oval points ≈ bizygomatic (approx)
  cheekR: 116, cheekL: 345,    // malar / cheekbone points (approx)
  gonionR: 172, gonionL: 397,  // jaw angle (approx)
  jawR: 172, jawL: 397,
  menton: 152,                 // chin bottom (soft-tissue menton)
  pogonion: 152,               // most-anterior chin (frontal proxy)
  glabella: 9,                 // between brows
  foreheadTop: 10,             // top of forehead (hairline proxy — NOT true trichion)
  faceMidTop: 10, faceMidBottom: 152,
};

// Landmarks whose vertical extent approximates the palpebral fissure per eye.
export const EYE_R = { outer: IDX.eyeROuter, inner: IDX.eyeRInner, top: IDX.eyeRTop, bottom: IDX.eyeRBottom };
export const EYE_L = { outer: IDX.eyeLOuter, inner: IDX.eyeLInner, top: IDX.eyeLTop, bottom: IDX.eyeLBottom };

// Profile manual-tap points (Quick mode). Order matters — the UI walks them
// top-to-bottom. Each: key used by analysis, label shown to the user, hint.
export const PROFILE_POINTS = [
  { key: "trichion",  label: "Trichion",        hint: "Hairline at the top of the forehead" },
  { key: "glabella",  label: "Glabella",        hint: "Most prominent point between the brows" },
  { key: "nasion",    label: "Nasion",          hint: "Deepest dip at the top of the nose bridge" },
  { key: "pronasale", label: "Pronasale",       hint: "Tip of the nose" },
  { key: "subnasale", label: "Subnasale",       hint: "Where the nose base meets the upper lip" },
  { key: "labSup",    label: "Upper lip",       hint: "Most forward point of the upper lip" },
  { key: "labInf",    label: "Lower lip",       hint: "Most forward point of the lower lip" },
  { key: "pogonion",  label: "Pogonion",        hint: "Most forward point of the chin" },
  { key: "menton",    label: "Menton",          hint: "Lowest point of the chin" },
  { key: "gonion",    label: "Gonion",          hint: "Corner of the jaw, below/behind the ear" },
  { key: "tragion",   label: "Tragion",         hint: "The notch just in front of the ear canal" },
];

let _landmarker = null;
let _videoLandmarker = null;

// Load (and cache) the FaceLandmarker for still images.
export async function getLandmarker() {
  if (_landmarker) return _landmarker;
  const { FaceLandmarker, FilesetResolver } = await import(TASKS_VISION);
  const fileset = await FilesetResolver.forVisionTasks(`${TASKS_VISION}/wasm`);
  _landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    runningMode: "IMAGE",
    numFaces: 1,
  });
  return _landmarker;
}

// A second instance in VIDEO mode for the live webcam preview.
export async function getVideoLandmarker() {
  if (_videoLandmarker) return _videoLandmarker;
  const { FaceLandmarker, FilesetResolver } = await import(TASKS_VISION);
  const fileset = await FilesetResolver.forVisionTasks(`${TASKS_VISION}/wasm`);
  _videoLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    outputFacialTransformationMatrixes: true,
    runningMode: "VIDEO",
    numFaces: 1,
  });
  return _videoLandmarker;
}

// Run detection on an HTMLImageElement / Canvas. Returns a normalized result or null.
export function detectImage(landmarker, imageEl) {
  const res = landmarker.detect(imageEl);
  if (!res || !res.faceLandmarks || res.faceLandmarks.length === 0) return null;
  return {
    landmarks: res.faceLandmarks[0], // [{x,y,z}] normalized
    blendshapes: res.faceBlendshapes?.[0]?.categories || [],
    transform: res.facialTransformationMatrixes?.[0]?.data || null, // 16 floats, column-major
  };
}
