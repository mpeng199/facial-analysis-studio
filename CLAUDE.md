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

Deploy is two steps, and it has to be an agent action — there is no local
`netlify` CLI and no stored credentials on this machine, so a plain script or a
Stop hook cannot do it unaided. The upload token comes from the MCP:

1. Call the Netlify MCP `netlify-deploy-services-updater` with
   `{operation: "deploy-site", params: {siteId: "72bbbc18-…"}}`.
   It replies with a scoped, **single-use** `npx -y @netlify/mcp@latest …
   --proxy-path "…"` command. Re-request it for every attempt; a token that has
   been used once will not work again.
2. Run that command from the project root with a generous timeout (~7 min).

Known gotcha: the returned proxy path has sometimes contained a double slash
(`netlify-mcp.netlify.app//proxy/`), which 404s. Normalise it to one slash.

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

Self-check for the chamfered unit box in `landing.js` (counts, closed manifold,
outward winding). `test.html` is the 19-assert analysis-engine suite (open it in
a browser; needs no camera).

`dev/_audit.js` is the dev-only geometry auditor — **not** referenced by any
page, and 404'd in `netlify.toml`. It is the regression harness for the
"statues phasing through the curtains" bug; its header documents how to load it.
After touching the drapery, the niches or figure placement,
`__audit.figureClashes(11, 0.02)` filtered to `member.startsWith('Plane')` must
come back empty.

## Local preview

`.claude/launch.json` defines a `hall` server on port 8123 — use `preview_start`
with that name, never `Bash` for servers. The browser pane caches `index.html`,
so navigate to `index.html?cb=<something>` and confirm the loaded script version
via `[...document.scripts].map(s => s.src)`.
