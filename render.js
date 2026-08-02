// render.js — pure report → HTML builders (no DOM mutation, no global state),
// so the full report layout can be unit-tested without MediaPipe. app.js sets
// the returned HTML and then draws the canvases separately.
//
// The report is two parts. Part one is the plain-English read: what the numbers
// add up to, said the way you'd say it out loud. Part two is every measurement
// with its working shown. Nothing in part one is missing from part two — it's
// the same report at two altitudes, not a teaser.

export function scoreClass(s) { return s >= 78 ? "good" : s >= 55 ? "warn" : "bad"; }
export function scoreColor(s) {
  const el = typeof document !== "undefined" ? document.documentElement : null;
  const varname = s >= 78 ? "--good" : s >= 55 ? "--warn" : "--bad";
  const v = el ? getComputedStyle(el).getPropertyValue(varname) : "";
  return v && v.trim() ? v : (s >= 78 ? "#12a150" : s >= 55 ? "#e8963a" : "#e5484d");
}
export function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------
// Plain-English glossary.
//
// Every measurement, region, headline score, tenet and section in the report
// carries a `?` that shows its entry here. Two rules held while writing these:
// no jargon may appear inside a definition (that just moves the problem), and
// `name` is the phrase part one uses in place of the clinical label — so the
// summary can say "eye tilt" where the detail says "canthal tilt".
//
// Keys are namespaced by kind because the same word is a metric, a region, a
// tenet and a dial: `symmetry` / `reg:harmony` / `tenet:symmetry` / `dial:harmony`.
// Bare keys are metric keys straight off analysis.js's METRICS catalogue.
// ---------------------------------------------------------------------------
export const GLOSS = {
  // ---- measurements (keys match analysis.js METRICS) ----
  canthalTilt: { name: "eye tilt", tip: "Whether the outer corner of your eye sits higher or lower than the inner corner. A slight upward tilt reads as alert and youthful; a downward one reads as tired." },
  eyeAlmondness: { name: "eye shape", tip: "How wide your eye is compared to how tall it is. Around three times as wide as it is tall gives the classic almond shape." },
  intercanthalRatio: { name: "eye spacing", tip: "The gap between your eyes compared to the width of one eye. When they're about equal — one eye would fit in the gap — the spacing reads as balanced." },
  browPosition: { name: "brow height", tip: "How far your eyebrow sits above your eyelid, measured in eye-widths. Higher brows read more open and more feminine; lower, heavier brows read more masculine." },
  noseWidth: { name: "nose width", tip: "The width of your nostrils compared to the distance between your eyes. This one is judged against norms for your own background, not against a single ideal." },
  mouthNose: { name: "mouth width", tip: "How wide your mouth is compared to your nose. A mouth roughly one and a half times the width of the nose is the usual balance point." },
  lipRatio: { name: "lip balance", tip: "The thickness of your top lip compared to your bottom lip. A bottom lip a little fuller than the top — roughly 1 to 1.6 — reads full and youthful." },
  philtrum: { name: "upper lip length", tip: "The gap between the base of your nose and the top of your lip, as a share of your lower face. A shorter gap reads younger; it lengthens with age." },
  jawWidth: { name: "jaw width", tip: "How wide your jaw is at the back corners compared to your cheekbones. Wider reads stronger and more masculine; narrower reads more tapered and more feminine." },
  lowerThird: { name: "lower face length", tip: "The height of your face from the base of your nose to your chin, compared to the middle of your face. Close to equal is the balanced read." },
  fwhr: { name: "face width-to-height", tip: "How wide your face is compared to its height between brow and lip. Research links a wider ratio to a more dominant first impression. Facial fat pushes it up." },
  nasofrontal: { name: "nose-to-forehead angle", tip: "The angle where your forehead meets the bridge of your nose, seen from the side. A softer, more open angle reads more feminine." },
  nasolabial: { name: "nose tip angle", tip: "The angle between the underside of your nose and your top lip — in plain terms, how much the tip of your nose points up or down." },
  convexity: { name: "profile straightness", tip: "Seen from the side, how straight a line runs from forehead to lip to chin. A nearly straight profile is the usual target; a strong bend usually means the chin sits back." },
  eLineUpper: { name: "top lip position from the side", tip: "How far your top lip sits behind an imaginary line drawn from the tip of your nose to your chin. Sitting a few millimetres behind that line is typical." },
  eLineLower: { name: "bottom lip position from the side", tip: "How far your bottom lip sits behind an imaginary line drawn from the tip of your nose to your chin. It normally sits a touch closer to the line than the top lip." },
  gonial: { name: "jaw angle", tip: "The angle at the back corner of your jaw — from ear, to jaw corner, to chin. A tighter angle reads as a sharper, more defined jawline." },
  symmetry: { name: "symmetry", tip: "How closely the left and right halves of your face mirror each other. Every face is a little uneven; a score below 100 is normal, not a flaw." },
  fifths: { name: "side-to-side spacing", tip: "Your face split into five equal vertical columns, each about one eye wide. It checks whether your features are evenly spaced across your face." },
  thirds: { name: "top-to-bottom spacing", tip: "Your face split into three equal horizontal bands — hairline to brow, brow to nose, nose to chin. It checks whether your face is evenly divided down its height." },

  // ---- regions ----
  "reg:brows": { name: "brows", tip: "Your eyebrows — their height, shape and arch. Almost all of this is hair and skin rather than bone, which is why it's the easiest region on the face to change." },
  "reg:eyes": { name: "eyes", tip: "Your eyes — their tilt, their shape, and how far apart they sit. This is the first place people look at a face." },
  "reg:nose": { name: "nose", tip: "Your nose — its width, its angles, and how far it projects from your face." },
  "reg:cheeks": { name: "cheeks", tip: "Your cheekbones and the middle of your face — how much they catch the light. Body fat shifts this read more than most people expect." },
  "reg:lips": { name: "lips", tip: "Your lips and mouth — fullness, width, and where they sit relative to the rest of your face." },
  "reg:jaw": { name: "jaw", tip: "Your jawline and lower face — its width, its length and how defined it looks." },
  "reg:chin": { name: "chin", tip: "Your chin — how far forward it sits, and how it balances against your nose when seen from the side." },
  "reg:harmony": { name: "overall harmony", tip: "How well everything fits together as one face, rather than each feature judged on its own." },

  // ---- headline dials ----
  "dial:overall": { name: "overall", tip: "One blended number combining proportion, symmetry, closeness to average, and how well your features match typical patterns for your sex. It's a rough summary of the report, not a verdict on you." },
  "dial:harmony": { name: "harmony", tip: "Whether your features work together as a set. You can have good individual features that don't quite cohere — this measures the fit between them." },
  "dial:symmetry": { name: "symmetry", tip: "How closely your left and right sides match. Nobody scores 100 here, and small differences are part of what makes a face look real." },
  "dial:proportionality": { name: "proportionality", tip: "Whether the distances between your features land inside the usual ranges — eye spacing, mouth width, face length and so on." },
  "dial:averageness": { name: "averageness", tip: "How close your measurements sit to the population average. This is not an insult: study after study finds average faces are rated more attractive, because average means nothing sticks out." },
  "dial:femininity": { name: "femininity", tip: "How strongly your face carries the features that typically differ between men and women — jaw width, brow height, eye tilt, lip fullness." },
  "dial:masculinity": { name: "masculinity", tip: "How strongly your face carries the features that typically differ between men and women — jaw width, brow height, eye tilt, lip fullness." },
  "dial:dimorphism": { name: "dimorphism fit", tip: "How closely your mix of masculine and feminine features lands on the target you picked in step one. Scoring low here means your face leans a different way than you asked for — not that anything is wrong with it." },
  "dial:perceivedAge": { name: "perceived age", tip: "Roughly the age your face is likely to read as. It starts from the age you entered and adjusts for youth cues like eye tilt and lower-face length." },

  // ---- the four tenets ----
  "tenet:proportion": { name: "proportion", tip: "Do the distances between your features land in the usual ranges? This is the measuring-tape part of the report." },
  "tenet:symmetry": { name: "symmetry", tip: "Do your two sides match each other? Small mismatches are universal; large ones are what registers." },
  "tenet:averageness": { name: "averageness", tip: "Are your measurements close to the population norm? Faces near the average are consistently rated as more attractive, because no single feature draws attention away from the rest." },
  "tenet:dimorphism": { name: "sexual dimorphism", tip: "How strongly your face carries the features that typically separate male and female faces. Neither direction is better — what matters is whether it matches the look you're going for." },

  // ---- sections ----
  "sec:glance": { name: "your result at a glance", tip: "The whole report boiled down to one number and a few sentences. Every claim here is backed by a measurement in part two." },
  "sec:working": { name: "what's already working", tip: "The measurements that scored well, and the ones you'd be making a mistake to change." },
  "sec:start": { name: "where to start", tip: "The first three steps from your full plan, chosen because they're the quickest and easiest to act on. The complete plan is at the end of part two." },
  "sec:dashboard": { name: "biometric dashboard", tip: "Eight headline scores summarising the whole analysis. Each runs 0 to 100, where 100 means the measurement sits squarely inside the usual range." },
  "sec:method": { name: "method & photo quality", tip: "How these numbers were produced, and how much weight your particular photo can carry. A turned head or soft focus widens the error on every measurement below." },
  "sec:overlay": { name: "landmark overlay", tip: "The exact points the software found on your face, with the guide lines it measured against — plus a preview of a lightly evened-out version of your face." },
  "sec:tenets": { name: "the four tenets", tip: "The four qualities that facial-attractiveness research ties most consistently to how a face is rated. Every measurement in this report feeds one of them." },
  "sec:regional": { name: "regional feature analysis", tip: "Every measurement taken, grouped by the part of the face it belongs to. The number beside each region is that region's weighted average." },
  "sec:priorities": { name: "strengths & priorities", tip: "Your best-scoring measurements on one side; on the other, the ones with the most room to move, ranked by how much of a difference changing them would make." },
  "sec:harmony": { name: "facial harmony", tip: "Whether your features are in balance with each other. Two features can each score well on their own and still fight each other — this is where that shows up." },
  "sec:improvement": { name: "improvement potential", tip: "Where each weak score could realistically get to with non-surgical work. The gap between the two numbers is the honest ceiling, not a promise." },
  "sec:aging": { name: "aging trajectory", tip: "How faces built like yours typically change over the coming decades, and which of those changes are worth getting ahead of now." },
  "sec:protocol": { name: "your plan", tip: "A sequenced plan, easiest first. Nothing here is surgical, and each step says what the evidence behind it actually is." },
};

// The `?` badge. Renders nothing for an unknown key, so an unglossed metric
// degrades to a plain label instead of an empty bubble.
export function qm(key) {
  const g = GLOSS[key];
  if (!g) return "";
  // The tip goes in aria-label too: the bubble is CSS ::after content, which
  // screen readers are not obliged to announce.
  return `<button type="button" class="qm" data-tip="${escAttr(g.tip)}" aria-label="${escAttr(g.name)}: ${escAttr(g.tip)}">?</button>`;
}
const gname = (key, fallback) => GLOSS[key]?.name || fallback;

// A section heading, with its own `?`. wizard.js reads these to build the rail.
function sect(title, key) {
  return `<div class="section-title">${esc(title)}${qm(key)}</div>`;
}

export function dial(value, label, sub, tipKey) {
  const v = Math.round(value);
  const r = 40, C = 2 * Math.PI * r, off = C * (1 - v / 100);
  const col = scoreColor(v);
  return `<div class="dial">
    <svg viewBox="0 0 96 96">
      <circle cx="48" cy="48" r="${r}" fill="none" stroke="var(--line)" stroke-width="8"/>
      <circle cx="48" cy="48" r="${r}" fill="none" stroke="${col}" stroke-width="8"
        stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}"
        transform="rotate(-90 48 48)"/>
      <text x="48" y="54" text-anchor="middle" font-size="22" font-weight="700" fill="var(--ink)">${v}</text>
    </svg>
    <div class="lab">${label}${qm(tipKey)}</div>${sub ? `<div class="sub">${sub}</div>` : ""}
  </div>`;
}

// Per-region prose ("how each feature impacts your appearance"). Deliberately
// plain: the `?` explains the term, this explains why the region matters.
export function featureImpact(region, rs) {
  const worst = [...rs].sort((a, b) => a.score - b.score)[0];
  const best = [...rs].sort((a, b) => b.score - a.score)[0];
  const templates = {
    brows: "Your brows frame your eyes and set much of the upper face's masculine or feminine read. They're hair and skin rather than bone, so this is the easiest region on your face to change.",
    eyes: "Eyes are the first thing anyone looks at. Their tilt and shape drive how youthful and how feminine a face reads more than almost anything else.",
    nose: "Your nose sits at the centre of your face, so its width and how far it projects anchor everything around it. It's measured against norms for your own background, not one universal ideal.",
    cheeks: "Your cheekbones catch the light and give the middle of your face its shape. How much fat you carry shifts this read noticeably.",
    lips: "Your lips set the balance of your lower face and often hint at the tooth and jaw structure behind them. Fullness reads as youth.",
    jaw: "Your jaw and lower face carry the strongest masculine-or-feminine signal of any region. Even where the bone is fixed, definition here responds to body fat and posture.",
    chin: "Your chin decides how your profile balances. A chin with enough projection offsets your nose and makes the jawline look longer.",
    harmony: "These are the whole-face proportions that decide whether individually good features actually add up to a coherent face.",
  };
  let base = templates[region] || "";
  if (worst && worst.score < 60) base += ` Your ${gname(worst.key, worst.label.toLowerCase())} (${worst.valueText}) is the main thing holding this region back.`;
  else if (best && best.score >= 85) base += ` Your ${gname(best.key, best.label.toLowerCase())} is a genuine asset.`;
  return esc(base);
}

// ---------------------------------------------------------------------------
// Part one — the plain-English read
// ---------------------------------------------------------------------------
const band = (s) => s >= 85 ? "excellent" : s >= 78 ? "strong" : s >= 65 ? "good" : s >= 55 ? "about average" : s >= 40 ? "below average" : "a weak spot";

// analysis.js phrases improvability for a clinician; say it the other way.
const CHANGEABILITY = {
  "Highly responsive to non-surgical work": "You can move this a long way on your own.",
  "Partially improvable non-surgically": "You can move this some, but not all the way.",
  "Mostly structural — limited non-surgical change": "This is bone structure — largely fixed.",
};

function partHead(num, title, blurb) {
  return `<div class="part-head">
    <span class="part-num">${esc(num)}</span>
    <h3>${esc(title)}</h3>
    <p>${esc(blurb)}</p>
  </div>`;
}

function summaryHTML(R) {
  const d = R.dashboard;
  const overall = d.attractiveness;
  const sym = d.symmetry;
  const harmony = d.harmony.score ?? d.harmony;
  const regs = Object.entries(R.regions);
  const best = [...regs].sort((a, b) => b[1] - a[1])[0];
  const worst = [...regs].sort((a, b) => a[1] - b[1])[0];

  // How much of the priority list is actually yours to move?
  const movable = R.improvement.filter((i) => i.note.startsWith("Highly")).length;

  const says = [];
  says.push(`Your face scores ${overall} out of 100 overall — ${band(overall)}. That number blends four things: how well your proportions land in the usual ranges, how closely your two sides match, how close you sit to the population average, and how strongly your features lean masculine or feminine.`);
  if (best && worst && best[0] !== worst[0]) {
    says.push(`Your strongest region is your ${gname("reg:" + best[0], best[0])}, at ${best[1]} out of 100. The one with the most room to move is your ${gname("reg:" + worst[0], worst[0])}, at ${worst[1]}.`);
  }
  says.push(`Your left and right sides match ${sym >= 85 ? "closely" : sym >= 70 ? "reasonably closely" : "less closely than most faces"} — ${sym} out of 100. No face scores 100 here, so treat anything short of it as normal rather than as a fault.`);
  if (R.improvement.length) {
    says.push(movable
      ? `Of the ${R.improvement.length} priorities below, ${movable} respond well to things entirely in your hands — grooming, skincare, sleep, body composition. The rest are bone structure, and no routine will move those.`
      : `Most of what's holding your score down is bone structure rather than anything a routine can change. That's worth knowing before you spend money on one.`);
  }
  says.push(`Your face reads as roughly ${d.perceivedAge} years old${R.meta.age ? `, against the ${R.meta.age} you entered` : ""}.`);

  let html = sect("Your result at a glance", "sec:glance");
  html += `<div class="glance">
    <div class="glance-score">
      <span class="gs-num" style="color:${scoreColor(overall)}">${overall}</span>
      <span class="gs-den">out of 100</span>
      <span class="gs-band pill ${scoreClass(overall)}">${band(overall)}</span>
    </div>
    <div class="glance-say">${says.map((s) => `<p>${esc(s)}</p>`).join("")}</div>
  </div>`;

  html += `<div class="quickstats">
    ${[["Features fit together", harmony, "dial:harmony"],
       ["Left and right match", sym, "dial:symmetry"],
       ["Spacing and proportions", d.proportionality, "dial:proportionality"],
       ["Close to typical", d.averageness, "dial:averageness"]]
      .map(([lab, v, k]) => `<div class="qs">
        <span class="qs-lab">${esc(lab)}${qm(k)}</span>
        <span class="qs-val" style="color:${scoreColor(v)}">${v}</span>
        <span class="qs-band">${band(v)}</span>
        <div class="bar"><i style="width:${v}%;background:${scoreColor(v)}"></i></div>
      </div>`).join("")}
  </div>`;

  html += sect("What's working and what to focus on", "sec:working");
  html += `<div class="split">
    <div class="card"><h4>Already working${qm("sec:working")}</h4>
      <p class="why card-lede">These scored well. Whatever else you change, leave these alone.</p>
      <ul class="plain-list">
      ${R.strengths.slice(0, 5).map((s) => `<li><span class="lead">Your ${esc(gname(s.key, s.label.toLowerCase()))}</span>
        <span class="pill good">${s.score}</span>
        <div class="why">${esc(s.valueText)}</div></li>`).join("")
      || `<li class="why">Nothing scored high enough to call a standout. Most of your measurements sit mid-range, which is a perfectly ordinary result and gives you a wide base to work from.</li>`}
    </ul></div>
    <div class="card"><h4>Worth your attention${qm("sec:improvement")}</h4>
      <p class="why card-lede">Ranked by how much difference a change would make. The second number is a realistic ceiling, not a promise.</p>
      <ul class="plain-list">
      ${R.improvement.slice(0, 5).map((im) => `<li><span class="lead">Your ${esc(gname(im.key, im.label.toLowerCase()))}</span>
          <span class="pill ${scoreClass(im.current)}">${im.current} → ${im.potential}</span>
          <div class="why">${esc(CHANGEABILITY[im.note] || im.note)}</div></li>`).join("")
      || `<li class="why">Nothing scored low enough to flag as a priority.</li>`}
    </ul></div>
  </div>`;

  html += sect("Where to start", "sec:start");
  html += `<ol class="startlist">
    ${R.protocol.slice(0, 3).map((it) => `<li>
      <div class="start-what">${esc(it.what)}<span class="tag">${esc(it.tier)}</span><span class="tag">${esc(it.timeline)}</span></div>
      <div class="start-how">${esc(it.how)}</div>
    </li>`).join("")}
  </ol>
  <p class="muted start-note">These are the first three steps of your full plan, picked because they're the easiest to start. The complete sequence, with the evidence behind each step, is at the end of part two.</p>`;

  return html;
}

// ---------------------------------------------------------------------------
// Build the full report HTML string. Canvases are placeholders the caller fills.
// ---------------------------------------------------------------------------
export function buildReportHTML(R) {
  const d = R.dashboard;
  const goalTxt = { natural: "balanced", feminine: "more feminine", masculine: "more masculine", youthful: "more youthful" }[R.meta.goal];
  let html = `<div class="report-head">
    <h2>Your Aesthetic Report</h2>
    <p class="muted">${R.meta.sex === 'm' ? 'Male' : 'Female'} · ${R.meta.age ? R.meta.age + ' yrs · ' : ''}${esc(R.meta.ethnicity)} · goal: ${goalTxt}</p>
  </div>`;

  // ===== PART ONE =====
  html += partHead("Part one", "The short version",
    "Plain English, nothing to decode. Everything claimed here is measured and shown in full in part two.");
  html += summaryHTML(R);

  // ===== PART TWO =====
  html += partHead("Part two", "The full detail",
    "Every measurement taken, what it means and where the number came from. Hover or tap any ? for a plain-English definition.");

  html += sect("Biometric dashboard", "sec:dashboard") +
    `<div class="dashboard">
      ${dial(d.attractiveness, "Overall", "harmony-weighted", "dial:overall")}
      ${dial(d.harmony.score ?? d.harmony, "Harmony", "", "dial:harmony")}
      ${dial(d.symmetry, "Symmetry", "", "dial:symmetry")}
      ${dial(d.proportionality, "Proportionality", "", "dial:proportionality")}
      ${dial(d.averageness, "Averageness", "", "dial:averageness")}
      ${dial(R.meta.sex === 'm' ? d.masculinity : d.femininity, R.meta.sex === 'm' ? "Masculinity" : "Femininity", "", R.meta.sex === 'm' ? "dial:masculinity" : "dial:femininity")}
      ${dial(d.dimorphism, "Dimorphism fit", "", "dial:dimorphism")}
      <div class="dial"><svg viewBox="0 0 96 96"><text x="48" y="42" text-anchor="middle" font-size="26" font-weight="700" fill="var(--ink)">${d.perceivedAge}</text><text x="48" y="64" text-anchor="middle" font-size="10" fill="var(--muted)">est.</text></svg><div class="lab">Perceived age${qm("dial:perceivedAge")}</div></div>
    </div>`;

  const q = R.quality || { notes: [] };
  html += sect("Method & photo quality", "sec:method") +
    `<div class="card">
      <p class="muted">Measured from ${R.results.filter(r => r.side !== 'profile').length} frontal metrics${R.results.some(r => r.side === 'profile') ? ` + ${R.results.filter(r => r.side === 'profile').length} profile angles` : ''}, pose-normalised before scoring. Scale: ${esc(R.meta.scaleSource || 'relative')}. ${R.meta.scaleNote ? esc(R.meta.scaleNote) + '.' : ''}</p>
      <ul class="notes">${(q.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    </div>`;

  html += sect("Landmark overlay & corrected-face preview", "sec:overlay") +
    `<div class="canvas-wrap">
      <figure><canvas id="overlayCanvas"></canvas><figcaption>Every point the software found, plus the guide lines it measured against: your midline, the thirds and fifths, and the axis through each eye.</figcaption></figure>
      <figure><canvas id="morphCanvas"></canvas>
        <div class="slider-row"><span class="muted">Real</span><input type="range" id="morphSlider" min="0" max="100" value="0"><span class="muted">Corrected</span></div>
        <figcaption>Drag to see your face gently evened out and the eye corners lifted. It's an illustration of the direction, not a preview of a result.</figcaption>
      </figure>
    </div>`;

  html += sect("The four tenets of attractiveness", "sec:tenets") + `<div class="cards">`;
  for (const [k, label] of [["proportion", "Proportion"], ["symmetry", "Symmetry"], ["averageness", "Averageness"], ["dimorphism", "Sexual dimorphism"]]) {
    const s = R.tenets[k]; if (s == null) continue;
    html += `<div class="card"><h4>${label}${qm("tenet:" + k)}</h4><div class="metric"><span class="mlabel">Score</span><span class="mval">${s}/100</span></div><div class="bar"><i style="width:${s}%;background:${scoreColor(s)}"></i></div></div>`;
  }
  html += `</div>`;

  html += sect("Regional feature analysis", "sec:regional") + `<div class="cards">`;
  const byRegion = {};
  for (const r of R.results) { (byRegion[r.region] = byRegion[r.region] || []).push(r); }
  for (const region of ["brows", "eyes", "nose", "cheeks", "lips", "jaw", "chin", "harmony"]) {
    const rs = byRegion[region]; if (!rs) continue;
    const rScore = R.regions[region];
    html += `<div class="card"><h4>${region[0].toUpperCase() + region.slice(1)}${qm("reg:" + region)} <span class="pill ${scoreClass(rScore)}">${rScore}</span></h4>`;
    for (const r of rs) {
      html += `<div class="metric"><span class="mlabel">${esc(r.label)}${qm(r.key)}</span><span class="mval">${esc(r.valueText)} · <b style="color:${scoreColor(r.score)}">${r.score}</b></span></div>`;
    }
    html += `<p class="why" style="margin-top:8px">${featureImpact(region, rs)}</p></div>`;
  }
  html += `</div>`;

  html += sect("Strengths & priorities", "sec:priorities") + `<div class="split">
    <div class="card"><h4>Strongest features</h4><ul class="list">
      ${R.strengths.map((s) => `<li><span class="lead">${esc(s.label)}</span>${qm(s.key)} — <span class="pill good">${s.score}</span><div class="why">${esc(s.valueText)}</div></li>`).join("") || "<li class='why'>No standout strengths detected — most features sit mid-range.</li>"}
    </ul></div>
    <div class="card"><h4>Biggest opportunities</h4><ul class="list">
      ${R.weaknesses.slice(0, 6).map((w) => `<li><span class="lead">${esc(w.label)}</span>${qm(w.key)} — <span class="pill ${scoreClass(w.score)}">${w.score}</span><div class="why">${esc(w.valueText)}</div></li>`).join("")}
    </ul></div>
  </div>`;

  const hnotes = (R.dashboard.harmony && R.dashboard.harmony.notes) || [];
  html += sect("Facial harmony", "sec:harmony") +
    `<div class="card"><div class="metric"><span class="mlabel">Harmony score</span><span class="mval">${R.dashboard.harmony.score ?? R.dashboard.harmony}/100</span></div>
    <p class="why" style="margin-top:8px">${hnotes.length ? hnotes.map(esc).join(" ") : "Your features are in balanced proportion to one another — no single region overpowers the rest, which is itself a strong attractiveness signal."}</p></div>`;

  html += sect("Improvement potential", "sec:improvement") + `<div class="cards">`;
  for (const im of R.improvement) {
    html += `<div class="card"><h4>${esc(im.label)}${qm(im.key)}</h4>
      <div class="metric"><span class="mlabel">Now → potential</span><span class="mval">${im.current} → <b style="color:var(--good)">${im.potential}</b></span></div>
      <div class="bar"><i style="width:${im.potential}%;background:linear-gradient(90deg,${scoreColor(im.current)} ${im.current}%,var(--good) ${im.current}%)"></i></div>
      <p class="why" style="margin-top:6px">${esc(CHANGEABILITY[im.note] || im.note)}</p></div>`;
  }
  html += `</div>`;

  html += sect("Aging trajectory", "sec:aging") + `<div class="card"><div class="timeline">
    ${R.aging.items.map((a) => `<div class="tl-item"><div class="tl-when">${esc(a.when)}</div><div class="tl-what">${esc(a.change)}</div><div class="tl-why">${esc(a.why)}</div></div>`).join("")}
  </div></div>`;

  html += sect("Your non-surgical protocol", "sec:protocol") +
    `<p class="muted">Sequenced by effort — quick wins first, structural work last. Each step cites its rationale.</p>`;
  for (const it of R.protocol) {
    html += `<div class="proto-item">
      <div class="proto-head"><span class="proto-what">${esc(it.what)}</span>
        <span class="proto-meta"><span class="tag">${esc(it.tier)}</span><span class="tag">${esc(it.timeline)}</span>
        <span class="diff">${[1, 2, 3].map((n) => `<i class="${n <= it.difficulty ? 'on' : ''}"></i>`).join("")}</span></span></div>
      <div class="proto-body"><b>How:</b> ${esc(it.how)}</div>
      <div class="proto-sci"><b>The science:</b> ${esc(it.science)}</div>
    </div>`;
  }
  return html;
}
