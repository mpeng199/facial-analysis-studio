// render.js — pure report → HTML builders (no DOM mutation, no global state),
// so the full report layout can be unit-tested without MediaPipe. app.js sets
// the returned HTML and then draws the canvases separately.

export function scoreClass(s) { return s >= 78 ? "good" : s >= 55 ? "warn" : "bad"; }
export function scoreColor(s) {
  const el = typeof document !== "undefined" ? document.documentElement : null;
  const varname = s >= 78 ? "--good" : s >= 55 ? "--warn" : "--bad";
  const v = el ? getComputedStyle(el).getPropertyValue(varname) : "";
  return v && v.trim() ? v : (s >= 78 ? "#12a150" : s >= 55 ? "#e8963a" : "#e5484d");
}
export function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

export function dial(value, label, sub) {
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
    <div class="lab">${label}</div>${sub ? `<div class="sub">${sub}</div>` : ""}
  </div>`;
}

// Per-region prose ("how each feature impacts your appearance").
export function featureImpact(region, rs) {
  const worst = [...rs].sort((a, b) => a.score - b.score)[0];
  const best = [...rs].sort((a, b) => b.score - a.score)[0];
  const templates = {
    brows: "Brows frame the eyes and set upper-face dimorphism; shape is almost entirely soft-tissue, so this is high-leverage.",
    eyes: "The eyes are the first thing observers fixate on. Canthal tilt and eye shape drive youth and femininity cues more than almost any other region.",
    nose: "The nose sits at the centre of the face; its width and projection anchor overall harmony and are judged against your own ethnic norms, not a single ideal.",
    cheeks: "Malar projection catches light and defines the midface; fat distribution and body composition shift this read.",
    lips: "Lips gate the lower face and often reveal underlying dental structure; fullness balance reads as youth.",
    jaw: "The jaw and lower face carry the strongest dimorphism signal — definition here is fat- and posture-responsive even when bone is fixed.",
    chin: "Chin projection sets profile balance; a supportive chin offsets nasal projection and lengthens the jawline read.",
    harmony: "These global proportions determine whether individually good features actually cohere.",
  };
  let base = templates[region] || "";
  if (worst && worst.score < 60) base += ` Your ${worst.label.toLowerCase()} (${worst.valueText}) is the main drag here.`;
  else if (best && best.score >= 85) base += ` Your ${best.label.toLowerCase()} is a genuine asset.`;
  return esc(base);
}

// Build the full report HTML string. Canvases are placeholders the caller fills.
export function buildReportHTML(R) {
  const d = R.dashboard;
  const goalTxt = { natural: "balanced", feminine: "more feminine", masculine: "more masculine", youthful: "more youthful" }[R.meta.goal];
  let html = `<div class="report-head">
    <h2>Your Aesthetic Report</h2>
    <p class="muted">${R.meta.sex === 'm' ? 'Male' : 'Female'} · ${R.meta.age ? R.meta.age + ' yrs · ' : ''}${esc(R.meta.ethnicity)} · goal: ${goalTxt}</p>
  </div>`;

  html += `<div class="section-title">Biometric dashboard</div>
    <div class="dashboard">
      ${dial(d.attractiveness, "Overall", "harmony-weighted")}
      ${dial(d.harmony.score ?? d.harmony, "Harmony")}
      ${dial(d.symmetry, "Symmetry")}
      ${dial(d.proportionality, "Proportionality")}
      ${dial(d.averageness, "Averageness")}
      ${dial(R.meta.sex === 'm' ? d.masculinity : d.femininity, R.meta.sex === 'm' ? "Masculinity" : "Femininity")}
      ${dial(d.dimorphism, "Dimorphism fit")}
      <div class="dial"><svg viewBox="0 0 96 96"><text x="48" y="42" text-anchor="middle" font-size="26" font-weight="700" fill="var(--ink)">${d.perceivedAge}</text><text x="48" y="64" text-anchor="middle" font-size="10" fill="var(--muted)">est.</text></svg><div class="lab">Perceived age</div></div>
    </div>`;

  const q = R.quality || { notes: [] };
  html += `<div class="section-title">Method &amp; photo quality</div>
    <div class="card">
      <p class="muted">Measured from ${R.results.filter(r => r.side !== 'profile').length} frontal metrics${R.results.some(r => r.side === 'profile') ? ` + ${R.results.filter(r => r.side === 'profile').length} profile angles` : ''}, pose-normalised before scoring. Scale: ${esc(R.meta.scaleSource || 'relative')}. ${R.meta.scaleNote ? esc(R.meta.scaleNote) + '.' : ''}</p>
      <ul class="notes">${(q.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    </div>`;

  html += `<div class="section-title">Landmark overlay &amp; corrected-face preview</div>
    <div class="canvas-wrap">
      <figure><canvas id="overlayCanvas"></canvas><figcaption>Detected landmarks, midline, thirds &amp; fifths, canthal axis.</figcaption></figure>
      <figure><canvas id="morphCanvas"></canvas>
        <div class="slider-row"><span class="muted">Real</span><input type="range" id="morphSlider" min="0" max="100" value="0"><span class="muted">Corrected</span></div>
        <figcaption>Soft symmetrisation + canthal lift. An approximation, not a result guarantee.</figcaption>
      </figure>
    </div>`;

  html += `<div class="section-title">The four tenets of attractiveness</div><div class="cards">`;
  for (const [k, label] of [["proportion", "Proportion"], ["symmetry", "Symmetry"], ["averageness", "Averageness"], ["dimorphism", "Sexual dimorphism"]]) {
    const s = R.tenets[k]; if (s == null) continue;
    html += `<div class="card"><h4>${label}</h4><div class="metric"><span class="mlabel">Score</span><span class="mval">${s}/100</span></div><div class="bar"><i style="width:${s}%;background:${scoreColor(s)}"></i></div></div>`;
  }
  html += `</div>`;

  html += `<div class="section-title">Regional feature analysis</div><div class="cards">`;
  const byRegion = {};
  for (const r of R.results) { (byRegion[r.region] = byRegion[r.region] || []).push(r); }
  for (const region of ["brows", "eyes", "nose", "cheeks", "lips", "jaw", "chin", "harmony"]) {
    const rs = byRegion[region]; if (!rs) continue;
    const rScore = R.regions[region];
    html += `<div class="card"><h4>${region} <span class="pill ${scoreClass(rScore)}">${rScore}</span></h4>`;
    for (const r of rs) {
      html += `<div class="metric"><span class="mlabel">${esc(r.label)}</span><span class="mval">${esc(r.valueText)} · <b style="color:${scoreColor(r.score)}">${r.score}</b></span></div>`;
    }
    html += `<p class="why" style="margin-top:8px">${featureImpact(region, rs)}</p></div>`;
  }
  html += `</div>`;

  html += `<div class="section-title">Strengths &amp; priorities</div><div class="split">
    <div class="card"><h4>Strongest features</h4><ul class="list">
      ${R.strengths.map((s) => `<li><span class="lead">${esc(s.label)}</span> — <span class="pill good">${s.score}</span><div class="why">${esc(s.valueText)}</div></li>`).join("") || "<li class='why'>No standout strengths detected — most features sit mid-range.</li>"}
    </ul></div>
    <div class="card"><h4>Biggest opportunities</h4><ul class="list">
      ${R.weaknesses.slice(0, 6).map((w) => `<li><span class="lead">${esc(w.label)}</span> — <span class="pill ${scoreClass(w.score)}">${w.score}</span><div class="why">${esc(w.valueText)}</div></li>`).join("")}
    </ul></div>
  </div>`;

  const hnotes = (R.dashboard.harmony && R.dashboard.harmony.notes) || [];
  html += `<div class="section-title">Facial harmony</div>
    <div class="card"><div class="metric"><span class="mlabel">Harmony score</span><span class="mval">${R.dashboard.harmony.score ?? R.dashboard.harmony}/100</span></div>
    <p class="why" style="margin-top:8px">${hnotes.length ? hnotes.map(esc).join(" ") : "Your features are in balanced proportion to one another — no single region overpowers the rest, which is itself a strong attractiveness signal."}</p></div>`;

  html += `<div class="section-title">Improvement potential</div><div class="cards">`;
  for (const im of R.improvement) {
    html += `<div class="card"><h4>${esc(im.label)}</h4>
      <div class="metric"><span class="mlabel">Now → potential</span><span class="mval">${im.current} → <b style="color:var(--good)">${im.potential}</b></span></div>
      <div class="bar"><i style="width:${im.potential}%;background:linear-gradient(90deg,${scoreColor(im.current)} ${im.current}%,var(--good) ${im.current}%)"></i></div>
      <p class="why" style="margin-top:6px">${esc(im.note)}.</p></div>`;
  }
  html += `</div>`;

  html += `<div class="section-title">Aging trajectory</div><div class="card"><div class="timeline">
    ${R.aging.items.map((a) => `<div class="tl-item"><div class="tl-when">${esc(a.when)}</div><div class="tl-what">${esc(a.change)}</div><div class="tl-why">${esc(a.why)}</div></div>`).join("")}
  </div></div>`;

  html += `<div class="section-title">Your non-surgical protocol</div>
    <p class="muted">Sequenced by effort — quick wins first, structural work last. Each step cites its rationale.</p>`;
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
