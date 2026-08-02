// wizard.js — step navigation and the report's contents rail.
//
// Deliberately decoupled from app.js: it watches #report's `hidden` attribute
// rather than being called by the analysis code, so the orchestration in
// app.js stays untouched and this file can't break a working analysis.

(() => {
  const steps = [...document.querySelectorAll(".step")];
  const chips = [...document.querySelectorAll(".stepper li")];
  const report = document.getElementById("report");
  const shell = document.getElementById("reportShell");
  const empty = document.getElementById("reportEmpty");
  const rail = document.getElementById("reportRail");
  const smooth = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Steps 1 and 2 are open from the start; 3 unlocks when a report exists.
  let unlocked = 2;

  const go = (n) => {
    if (n > unlocked) return;
    steps.forEach((s) => s.classList.toggle("on", +s.dataset.step === n));
    chips.forEach((c) => {
      const i = +c.dataset.step;
      c.classList.toggle("on", i === n);
      c.classList.toggle("done", i < n);
      if (i === n) c.setAttribute("aria-current", "step");
      else c.removeAttribute("aria-current");
      c.toggleAttribute("data-locked", i > unlocked);
    });
    scrollTo({ top: 0, behavior: smooth() ? "smooth" : "auto" });
  };

  document.querySelectorAll("[data-goto]").forEach((b) =>
    b.addEventListener("click", () => go(+b.dataset.goto))
  );
  chips.forEach((c) => c.addEventListener("click", () => go(+c.dataset.step)));

  // ---- report arrives → unlock step 3, build the rail, go there ----
  const roman = (n) => {
    let out = "";
    for (const [v, s] of [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]) {
      while (n >= v) { out += s; n -= v; }
    }
    return out;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // A section heading now ends in a `?` button, whose text content is a literal
  // "?" — read the leading text node instead of the whole subtree, or every
  // rail entry picks up a trailing question mark.
  const headingText = (t) => {
    const first = t.firstChild;
    return (first && first.nodeType === 3 ? first.textContent : t.textContent).trim();
  };

  function buildRail() {
    const titles = [...report.querySelectorAll(".section-title")];
    if (!titles.length) return;
    rail.innerHTML = titles.map((t, i) => {
      const num = roman(i + 1);
      t.id = `sec-${i + 1}`;
      t.dataset.num = num;                       // CSS renders it as the plate number
      // The report is split into two parts; where one starts, the rail says so.
      const head = t.previousElementSibling?.classList.contains("part-head")
        ? t.previousElementSibling : null;
      const part = head
        ? `<p class="rail-head">${esc(head.querySelector(".part-num")?.textContent || "")} · ${esc(head.querySelector("h3")?.textContent || "")}</p>`
        : "";
      return `${part}<a href="#sec-${i + 1}"><span class="rn">${num}</span>${esc(headingText(t))}</a>`;
    }).join("");

    // scrollspy: the last section whose heading has passed the sticky chrome
    const links = [...rail.querySelectorAll("a")];
    let queued = false;
    const spy = () => {
      queued = false;
      let active = 0;
      titles.forEach((t, i) => { if (t.getBoundingClientRect().top <= 140) active = i; });
      links.forEach((l, i) => l.classList.toggle("on", i === active));
    };
    addEventListener("scroll", () => {
      if (!queued) { queued = true; requestAnimationFrame(spy); }
    }, { passive: true });
    // Safe to measure now: go(3) has already shown the step. (Measuring while
    // it was still display:none read every rect as 0 and marked the LAST
    // section active.) The delayed re-run catches the smooth scroll landing —
    // a timer rather than rAF, which browsers throttle in background tabs.
    spy();
    setTimeout(spy, 500);
  }

  new MutationObserver(() => {
    if (report.hidden) return;
    empty.hidden = true;
    shell.hidden = false;
    unlocked = 3;
    go(3);        // show the step first — buildRail measures section positions
    buildRail();
  }).observe(report, { attributes: true, attributeFilter: ["hidden"] });
})();
