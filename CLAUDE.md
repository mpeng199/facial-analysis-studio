# Facial Analysis Studio — project instructions

Static site: plain HTML/CSS/ES modules, no build step, no dependencies.
three.js, MediaPipe and Draco load from a CDN at runtime.

## Always deploy after changing the site

**Standing instruction from the user (2026-07-30): the Netlify site must always
represent the most recent version of the website.** After you finish a piece of
work that changes anything the site serves, deploy it. Don't wait to be asked.

Live: <https://facial-analysis-studio.netlify.app>
Netlify project `facial-analysis-studio` · siteId `72bbbc18-4ac6-4de8-ba44-2d2bb3541ba8`
(also in `.netlify/state.json`) · team `6a62ba9f840332e3e686078a`.

Repo: <https://github.com/mpeng199/facial-analysis-studio> (`origin`, branch `main`).

### Preferred: commit and push

Once Netlify's GitHub CI is connected, **a push to `main` is the deploy**. So
finish the work, then:

```bash
git add -A && git commit -m "…" && git push
```

Check `git remote -v` and that the last deploy on Netlify came from git before
assuming CI is live. **Do not mix the two paths**: a manual folder deploy while
CI is connected produces a deploy the next push simply replaces, and leaves the
live site out of step with `main`. If you deploy manually, commit and push the
same state immediately after.

### Fallback: manual folder deploy (used before CI was connected)

Two steps, and it has to be an agent action — there is no local `netlify` CLI
and no stored credentials on this machine, so a plain script or a Stop hook
cannot do it unaided. The upload token comes from the MCP:

1. Call the Netlify MCP `netlify-deploy-services-updater` with
   `{operation: "deploy-site", params: {siteId: "72bbbc18-…"}}`.
   It replies with a scoped, **single-use** `npx -y @netlify/mcp@latest …
   --proxy-path "…"` command. Re-request it for every attempt; a token that has
   been used once will not work again.
2. Run that command from the project root with a generous timeout (~7 min).

Known gotcha: the returned proxy path has sometimes contained a double slash
(`netlify-mcp.netlify.app//proxy/`), which 404s. Normalise it to one slash.

The MCP cannot link the repo to Netlify — its project operations are limited to
naming, env vars, forms and access controls. That link is a one-time OAuth step
in the Netlify UI.

### Deploy only verified work

Deploy when the change is finished and checked, not mid-edit — this publishes
to a public URL. Before deploying, run the checks below and load the page once
in the browser pane. If something is half-finished, say so and hold the deploy.

Then confirm the deploy actually landed, rather than trusting "Deploy is ready":

```bash
curl -s https://facial-analysis-studio.netlify.app/ | grep -E 'landing\.(css|js)\?v='
```

The versions must match `index.html`. **The pane and Netlify both cache
`index.html`, so bump the `?v=` query on `landing.js` / `landing.css` whenever
you change them** — otherwise returning visitors keep the old file.

## Checks

```bash
node dev/test-geometry.mjs
```

Self-checks for the hand-built geometry in `landing.js`: the chamfered unit box
(counts, closed manifold, outward winding) and the swept pedestal moulding
(profile invariants, consistent orientation, signed volume, finished
dimensions). `test.html` is the 19-assert analysis-engine suite (open it in a
browser; needs no camera).

`dev/_audit.js` is the dev-only geometry auditor — **not** referenced by any
page, and 404'd in `netlify.toml`. It is the regression harness for the
"statues phasing through the curtains" bug; its header documents how to load it.
After touching the drapery, the niches or figure placement,
`__audit.figureClashes(11, 0.02)` filtered to `member.startsWith('Plane')` must
come back empty, and `__audit.seating().filter(r => !r.ok)` must be empty too.

**The animation loop is `requestAnimationFrame`, so it does not run while the
browser pane is hidden** — and `javascript_tool` hides it. Anything the tick
sets (light positions and intensities, the roaming niche keys and torches, the
camera) therefore reads back at its boot value if you just query it. To observe
live state, install a probe that samples inside its own rAF, take a screenshot
to front the pane and let frames run, then read what the probe recorded. Several
hours were lost to "the torch lights are broken" that were only ever unticked.

## The hall's modelling rules

Three rules the hall is built to. Breaking one is what makes it read as
primitives glued together rather than as a building.

1. **One edge rule.** `ARRIS` (22mm) is the single constant for the hardness of
   every edge: `CHAMFER` aliases it for the chamfer box, and every
   `ExtrudeGeometry` takes it as `bevelThickness`/`bevelSize` with
   `bevelSegments: 2`. 12mm was geometrically present and visually absent —
   under a pixel at these distances, so it never caught a highlight.
   Measured, so you do not have to rediscover it: three's bevel inflates a
   solid **outward** by `bevelSize` on every axis and symmetrically in z, and
   leaves the effective size of a *hole* unchanged. Anything derived from a
   bevelled member's face must be written in terms of `ARRIS` (see `PIER_FACE`),
   never as a copied literal.
2. **One pedestal vocabulary.** `PEDESTAL_PROFILE` is the only moulding profile
   in the building: `makeSweptMouldingGeo` sweeps it round a rounded rectangle
   for the six niche pedestals, `makeLathePedestalGeo` turns it for the
   beyond's. `r` is normalised to the plinth (the widest course) and `y` to the
   height, independently — the beyond's pedestal is wide and low, a niche's is
   narrow and tall, and a profile tied to height alone gives the wide one
   mouldings too small to see.
3. **Nothing butts.** Where two members meet there is a transitional course —
   the podium's and pier ledge's bed moulds, the niche sill, the drapery's
   valance. GTAO's radius (0.34) is tuned to make exactly these joints read as
   contact rather than as general grey; raising it back toward 0.55 washes the
   contact lines out again.

### Seating the casts

The pedestals are cut to the figures, not the other way round: each is sized
from that cast's measured **footprint** (the lowest tenth of the scan) so the
cap oversails it by `FOOT_MARGIN` on every visible side. The scan bases differ
wildly — the Doryphoros' is 0.739 deep, which is what sets `PED_MAX_HZ`, which
in turn sets `LEDGE_FRONT` and so the depth of the pier's projecting footing.
That chain is derived in code; do not re-type any link of it as a literal.

In z the figure is seated **forward** — front margin held at exactly
`FOOT_MARGIN`, any shortfall pushed to the back where the niche backing hides
it. Only the Doryphoros needs it. In x it is centred, because both flanks show.

## Local preview

`.claude/launch.json` defines a `hall` server on port 8123, with `autoPort` so a
second session can run one at the same time (the command reads `$PORT`) — use
`preview_start` with that name, never `Bash` for servers. The browser pane caches `index.html`,
so navigate to `index.html?cb=<something>` and confirm the loaded script version
via `[...document.scripts].map(s => s.src)`.
