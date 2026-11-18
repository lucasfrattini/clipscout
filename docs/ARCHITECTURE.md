# clipscout — Architecture

How the code is organised and why. For installing and running it, see the [README](../README.md).

## The shape of a request

```
Browser  ──  public/  (no bundler, no framework, hash-routed views)
   │
   │  POST /api/scrape        ·  GET /api/scrape/stream (SSE)
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ server.js      startup and orderly shutdown only (~45 lines)         │
│ src/app.js     Express app, CSP and headers                          │
│                                                                      │
│ middleware/    rateLimit → (route) → errorHandler                    │
│                                                                      │
│ routes/        scrape · video · thumbnail · media · profiles ·       │
│                buscar · sitios · crew · index                        │
│   HTTP shape only: parse, validate, stream, map AppError → status    │
│                          │                                           │
│ services/      the actual work                                       │
│   scraper.js      reads the HTML, validates params, assembles:       │
│     crawl/        descarga · fase1 · fase2 · orquestacion            │
│   pagination.js   ONE STRATEGY PER MODE  ← the extension seam        │
│   detector.js     proposes a configuration from a URL                │
│   jobs.js         paused explorer runs (memory, TTL)                 │
│   busqueda.js     Buscar: one search across every saved site         │
│   busquedasFondo  searches run server-side: queue, resume, events    │
│   programadas.js  scheduled searches                                 │
│   paquetesJd.js   packages sent to JDownloader and their state       │
│   proxySalida.js  outbound proxy health                              │
│   profiles.js     reads/writes data/profiles.json                    │
│   thumbnails.js   downloads and caches thumbnails IN MEMORY          │
│   video.js        single-URL analysis                                │
│   extensions.js   safe loader for per-site modules                   │
│                          │                                           │
│ lib/           reusable, dependency-light pieces                     │
│   http · browser · throttle · ssrf · dedupe · pattern · relevance    │
│   license · media · blocking · concurrency · document · format       │
│   errors · logger · url · firmaProxy · almacen · ficheroJson         │
│                          │                                           │
│ config/index.js  EVERY constant, every env var, one source of truth  │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
Target site  ──  always through lib/http.js (SSRF-checked, throttled, retried)
```

## The two phases

```
PHASE 1 — collect                          PHASE 2 — inspect  (optional)
walks the pagination, accumulates links    visits each link, finds files

sequential by design: whether to fetch     a real worker pool: as soon as a
page N+1 depends on what page N            worker finishes a URL it takes the
returned, so there is nothing to           next one, instead of waiting for a
parallelise                                whole batch to drain

stops when: pages run out · a page         duration and size are read from the
yields no links · the link cap is hit      HTML already downloaded — never with
· the client cancels                       extra requests
```

Phase 2 is skipped entirely when no extensions are requested: if all you want is
the list of links, nothing else runs.

## The design decisions that shape the code

**One strategy per pagination mode, not nested conditionals.**
`services/pagination.js` resolves the mode in a fixed order — `scroll` if the
client asked for it, `plantilla` if the URL contains `{page}`, `parametro` if a
page parameter was given, otherwise `unica` — and each mode is its own strategy.
A template inside the URL beats a page parameter on purpose: it is the thing the
user typed deliberately.

**`listarPagina()` is the extension seam.** It is the only function that knows
where a page's links come from, which is exactly why per-site extensions plug in
there: an extension implementing `listar` replaces it, and the traversal code
does not change by a single line.

**Every constant lives in `src/config/index.js`.** Nothing is hard-coded in a
service. Adding an option means adding it there **and** to `.env.example` — the
second is what makes it discoverable rather than folklore.

**No `innerHTML` anywhere in `public/`.** Enforced by ESLint through
`no-restricted-properties`. It is what closed an XSS and what stops it coming
back.

**No bundler on the frontend.** Deployment is `npm start` with no pipeline, and
without a bundler the app can serve a strict CSP with no `unsafe-inline`.

**What downloads and what filters are separate.** The form decides what gets
fetched; the controls inside the results card decide what is displayed of what
was already fetched. When those were mixed, nobody could tell which control did
which — and re-crawling to change a filter is unforgivable.

**Nothing is discarded silently.** Duplicates are grouped and can be expanded,
approximate sizes are marked with `~`, a scroll cut short by a cap says so, and
a result with unknown duration is never removed by the duration slider.
Filtering on data you do not have can only throw away good results.

## State: what lives on disk and why

Everything goes in the data folder (`DATA_DIR`; `crew.json` and `profiles.json` too since 2.21).

| What                       | Where it lives                                             | Survives a restart? |
| -------------------------- | ---------------------------------------------------------- | ------------------- |
| Saved sites                | `profiles.json`                                            | Yes                 |
| Settings, users, links     | `crew.json` (cached in memory, re-read only if it changed) | Yes                 |
| Buscar searches            | `busquedas.json` (index) + `busquedas/<id>.jsonl` (events) | Yes, for an hour    |
| Per-site stats and health  | `estadisticas.json`                                        | Yes                 |
| Proxy signing key          | `firma-intermediario.key`                                  | Yes                 |
| Paused explorer runs       | Memory (`services/jobs.js`), with a TTL and a cap          | No                  |
| Thumbnail and detail cache | Memory (`thumbnails.js`, `cacheFichas.js`)                 | No                  |
| Explorer results           | Nowhere — they live in the browser tab that ran them       | No                  |

**Buscar searches are persisted on purpose** (they run on the server, so a restart must not lose
the queue or what was already found). Since 2.22 the index is tiny and rewritten only when a
search changes state; each search's events are **appended** to its own `.jsonl`, so every result
is written once (a 3,000-result search went from 53 MB written to 1.1 MB). A cut-off last line is
dropped on startup; an unreadable index is set aside as `busquedas.json.corrupto-<date>`, never
overwritten. The 2.21 format is migrated on startup without losing the queue.

**Resuming is per page, not per site.** Besides what the screen needs, each site logs the list of
detail pages its listing produced (`sitio_enlaces`) and, in batches, the ones already inspected
(`sitio_hechas`). Those two event types are stored but never sent to clients (so `seq` may have
gaps). After a restart a site that was half done skips its listing and its finished detail
pages; sites are identified by a stable key (host + search path), not by their position.

Paused explorer runs stay in memory: resuming them requires the pending links, and writing the
names of the sites you explored to disk for a pause nobody may resume is not worth it.

## Security architecture

Three mechanisms carry the weight, and each closes a specific hole:

**SSRF validation happens at DNS lookup, not on the URL.** `guardRedirect`
re-validates every redirect, but with a _synchronous_ shape check that cannot
resolve DNS — so a perfectly-shaped public host redirecting to one that resolves
to `127.0.0.1` sails straight through it. The real guard is `secureLookup` in
`lib/ssrf.js`, installed on the HTTP/HTTPS agents: it validates the IP **at
connect time**. That is the single point every first request, every redirect and
every real resolution passes through, so there is no window left — and it also
closes DNS rebinding, which existed because the URL was resolved once for
validation and then resolved _again_ by the HTTP client.

**`trust proxy` defaults to `false` and must never be `true`.** `true` does not
mean "I am behind a proxy", it means "trust anybody". Since `req.ip` comes from
`X-Forwarded-For` and rate limiting keys off `req.ip`, `true` lets a client
rotate that header and bypass the limit entirely — measured: 0 blocks in 40
requests, against 10 of 40 from the same IP.

**Loading an extension means executing code, so nothing untrusted may reach a
`require`.** The extensions directory is fixed, resolved from `__dirname` and
deliberately **not** configurable by environment. The loader _enumerates_ the
directory and never builds a filename from a request; there is an allowlist as a
second barrier; loading happens once at startup with no hot reload. Adding an
extension means adding reviewed code to the repository, with its commit. If
user-supplied rules were ever needed, the answer is a declarative format
interpreted by the core — not executable code.

One smaller one worth knowing: `/api/health` does not mention which extensions
are loaded, since an extension's name is a site's name.

## Being a good citizen of the sites it crawls

`lib/throttle.js` enforces a minimum interval and a concurrency cap **per
host**, so one slow site cannot starve another. On repeated 429s a circuit
breaker multiplies that host's interval for a cooldown period; a `Retry-After`
header wins over the computed delay, capped so that an hour-long value cannot
stall a run. `lib/blocking.js` watches for anti-bot signals in both phases —
including the ones that arrive inside a rejected 4xx rather than through the
normal path — and reports them as _suspicion_, never as diagnosis.

## Known limits, stated rather than hidden

- **The detector guesses well, not always.** It is presented as an editable
  suggestion on purpose: presented as automatic, every miss would read as a
  breakage.
- **Duplicate grouping compares within a single exploration only.** Across
  searches it would need content fingerprints and state between runs.
- **Rate limiting is in-memory**, so it does not hold across multiple instances.
- **The ReDoS guard is a time budget, not static analysis.** A JavaScript regex
  is synchronous and cannot be interrupted mid-match; the nested-quantifier
  filter only inspects parentheses, so it does not catch every pathological
  pattern. Detecting this in general is undecidable.
- **Infinite scroll has no automated test** — it needs a real browser. It was
  verified by hand against a fixture that grows as you scroll, all three caps
  included. If you touch `renderPageWithInfiniteScroll`, repeat that check.
- **CI runs lint and the tests** on Linux and Windows for every push (`.github/workflows/ci.yml`),
  plus the browser smoke test (`npm run e2e`, Chromium and WebKit). Run `npm run check` before
  committing anyway: CI does not check formatting.

## API

The full list of routes, with the requirement each one serves, is in [SPEC.md](SPEC.md) and the
cross-app protocol in [CREW.md](CREW.md). By area:

| Area           | Routes (prefix `/api`)                                                               |
| -------------- | ------------------------------------------------------------------------------------ |
| Explorer       | `/scrape`, `/scrape/stream` (SSE), `/scrape/pause`, `/scrape/detect`                 |
| Buscar         | `/buscar/iniciar`, `/buscar/trabajos/:id/stream` (SSE, `?resumen=1`), `/buscar/cola` |
| Single URL     | `/video/extract`                                                                     |
| Proxied media  | `/thumbnail`, `/media` (signed URLs or configured-site domains only)                 |
| Sites          | `/profiles`, `/sitios/*` (add, reconfigure), `/ajustes/sitios`                       |
| Settings, apps | `/ajustes/*` (JDownloader, proxy, connections, backups), `/auth/*`, `/health`        |

Every error answers `{ codigo, detail, params }` (plus the older `error` and `code`): `formatoErrores`
(lib/errores.js) wraps `res.json`, so even the access guard's rejections carry a code, and
`detail` follows `Accept-Language`. Unexpected failures become `error_interno` with a short id that
is also in the log (`<data>/registro/clipscout.log`, rotated 5 MB × 3). Any `GET` that does not start with `/api/` serves the
frontend shell; views are routed by hash (`#/buscar`, `#/actividad`, `#/ajustes`, `#/explorer`,
`#/video`) and **each view's module is loaded the first time it is opened** — only Buscar loads
at startup, its modules announced with `modulepreload` so they download in parallel, and only the
active language's dictionary is fetched. Avanzada and Ajustes bring their own stylesheets
(`avanzada.css`, `sistema.css`).

## Project layout

```
server.js              Entry point — Express wiring only
src/
  config/index.js      Every env var, with its default. Single source of truth.
  routes/              HTTP layer: scrape, buscar, video, thumbnail, media, sitios…;
                       sistema: salud, diagnóstico, copia de la suite, versiones
  services/            The actual work — scraper, pagination, detector,
                       jobs (pause/resume), profiles, thumbnails, video
  lib/                 Reusable pieces: http, browser, throttle, ssrf,
                       dedupe, pattern, license, media, relevance, url,
                       errores (error codes), registro (rotating log), zip…
  middleware/          rateLimit, errorHandler
  extensions/          Drop-in point for custom extractors (see its README)
public/                Frontend — no build step, plain JS
  js/app.js            router: loads each view when first opened
  js/views/            buscar, actividad, ajustes, explorer, video
                       (ajustes/: sitios, conexiones, sistema; explorer/: piezas)
  js/buscarModelo.js   what Buscar shows (filters, order, duplicates): pure, tested
  js/components/       dialog, progress, resultList, jdEnvio, altaSitios…
  cg/                  shared Clipgeist UI package (byte-identical copy)
  js/i18n/             engine + es / en dictionaries
tests/                 73 files, ~690 tests (node:test) + e2e/ (Playwright)
data/                  Runtime state (gitignored)
```

```bash
npm test           # ~690 tests, ~45 s
npm run check      # lint + format check + tests — run this before committing
npm run lint:fix   # autofix
```

No build step and no framework on the frontend: `public/` is served as-is, and
views are routed by hash. Adding a config option means adding it to
`src/config/index.js` **and** to `.env.example` — the second is what makes it
discoverable.
