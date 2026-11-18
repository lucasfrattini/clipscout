<div align="center">

<img src="public/img/logo.png" alt="" width="96" height="96" />

# clipscout

**Point it at a paginated website. Walk away with a clean, deduplicated list of
everything that matched.**

A self-hosted web app that does the "next page" clicking for you: tell it where
to start, how the site paginates and what you are looking for, and it walks the
pages, opens each result and hands you back the files it found — with live
progress, real cancellation and export.

![Node](https://img.shields.io/badge/node-%E2%89%A520-informational)
![Docker](https://img.shields.io/badge/docker-compose-informational)
![License](https://img.shields.io/badge/license-AGPL--3.0-informational)

</div>

> ⚠️ clipscout only reads what a site already serves to a normal visitor —
> it does not bypass logins, paywalls, CAPTCHAs or DRM. Whether you may access,
> save or redistribute what you find depends on the site and your jurisdiction,
> and that responsibility is yours. See [Responsible use](#responsible-use).

## Contents

- [Features](#features)
- [Install with Docker](#install-with-docker)
- [Configuration](#configuration)
- [Part of Clipgeist](#part-of-clipgeist)
- [Updating and backups](#updating-and-backups)
- [Exposing it on the internet](#exposing-it-on-the-internet)
- [Install without Docker](#install-without-docker)
- [How to use it](#how-to-use-it)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Responsible use](#responsible-use) · [License](#license)

---

## Features

- **Two phases**: walk the pagination collecting the links that match a
  pattern, then (optionally) open each link and find files by extension.
- **Any pagination**: `?page=2`, templates in the URL (`/page/{page}`,
  `{page:02}`) and **infinite scroll**.
- **Auto-detection**: paste a results URL and it proposes the pattern,
  pagination and extensions, explaining each guess.
- **Add sites by address**: paste one or more site addresses and a test term.
  clipscout finds each site's search box, its pagination and which links are
  videos, then runs a real test search. Only sites that return videos are
  saved.
- **Search all your sites at once**, and optionally **the whole web** (with a
  SearXNG instance): sites you have not set up but that returned videos are
  offered for one-click adding.
- **Searches keep running on the server**: switching apps, locking the phone
  or closing the tab does not stop them. Come back and the page picks up
  where it left off. Extra searches wait in a **queue** (paste several, one per
  line, optionally `term → folder`), and running or queued searches **resume
  after a restart**.
- **Result filters and relevance**: must contain / hide if it contains, likely
  language, exact phrase, sort by relevance, and global **always-blocked
  words** that also apply to scheduled searches and to JDownloader. Hidden
  results are counted and can be shown. Albums fold into one card.
- **Saved configurations**: name a setup, load it later from any device, or
  copy a link that opens the app with everything filled in.
- **Optional browser rendering** (bundled Chromium) for sites built with
  JavaScript.
- **Useful results**: duration and size per file, range filters, duplicate
  grouping, thumbnails, pause and resume, CSV / JSON / plain-list export.
- **Single-page analyzer**: inspects one URL in depth (DOM, network requests,
  embedded players, scripts).
- **Send to JDownloader**: one click sends the results to JDownloader 2 as a
  single package, into the folder you choose — see
  [Sending to JDownloader](#sending-to-jdownloader). clipscout follows each
  package (_Activity → Downloads_): when JDownloader can't open a page it sends the direct
  file instead, and when a package finishes it asks clipkeeper to scan that
  folder.
- **Play in place**: **⋯ → Play** plays a result in a sheet, without leaving the list. The video is
  streamed through your server (seeking works), so the browser never talks to the site.
- **Scheduled searches** (_Activity → Scheduled_, or **Repeat every week…** from the result filters): a saved search repeats every few days and sends only
  what is new to JDownloader — with a minimum length, words it must or must not contain, and
  a person or category for clipkeeper. The same video found on several sites is sent once.
  Starts empty.
- **Works with Clipgeist**: lists your clipkeeper folders as download
  destinations and tells you which videos you already have.
- **Per-site numbers** (_Settings → Search → Sites_, in each site's **⋯**): searches, results, how many with
  length, blocks, sent, already owned and failed downloads.
- **Outbound proxy** (`OUTBOUND_PROXY`) for networks that block some sites.
- **Safe to run**: SSRF protection, per-host throttling, rate limiting, memory
  and time caps. English and Spanish interface.

---

## Install with Docker

This is the recommended way. You need **Docker with Docker Compose** and about
**1.5 GB of free RAM** if you plan to use browser rendering (much less without
it).

```bash
git clone https://github.com/lucasfrattini/clipscout.git
cd clipscout
cp .env.example .env     # optional: defaults work as they are
docker compose up -d --build
```

Open **http://localhost:3001** (or `http://<server-ip>:3001` from another
machine). That's it.

The container restarts by itself after a crash or a reboot. Everyday commands,
run from the `clipscout` folder:

```bash
docker compose logs -f         # follow the log
docker compose restart         # restart
docker compose down            # stop
docker compose up -d --build   # start again / apply changes
```

> Always use `--build` after pulling new code: without it Docker keeps running
> the old image.

**Prebuilt image.** Every push to `main` publishes
`ghcr.io/lucasfrattini/clipscout:latest` (amd64 and arm64), and every release
tag `vX.Y.Z` publishes `:X.Y.Z`. To use it instead of building, replace
`build: .` with `image: ghcr.io/lucasfrattini/clipscout:latest` in
`compose.yaml` and run `docker compose pull && docker compose up -d`.

**The whole Clipgeist at once** (clipscout + clonbuster + clipkeeper) on any
Debian/Ubuntu host; it installs Docker if it's missing:

```bash
git clone https://github.com/lucasfrattini/clipkeeper.git
sudo MEDIA=/path/to/your/videos bash clipkeeper/deploy/instalar.sh
```

It ends up in `/opt/clipgeist`; running it again updates the images and keeps your data. For a
Proxmox VE container, see
[clipkeeper/deploy](https://github.com/lucasfrattini/clipkeeper/tree/main/deploy).

**After installing:** open port `3001`. Until a user exists, clipscout only answers this same
computer; from another device the sign-in page asks for the **first-start code** printed in the log
(`docker logs clipscout`: «Código para crear el usuario: XXXX-XXXX»).
To link it with the other apps, see [Part of Clipgeist](#part-of-clipgeist).

---

## Configuration

Everything is optional and lives in `.env`, which is created from
`.env.example`, where every option is documented with its default. After
editing it, apply the change with `docker compose up -d`.

The ones you are most likely to touch:

| Variable                  | Default   | What it does                                                                |
| ------------------------- | --------- | --------------------------------------------------------------------------- |
| `HOST_PORT`               | `3001`    | Port the app is published on                                                |
| `BROWSER_ENABLED`         | `true`    | Allow browser rendering. Set `false` on small machines                      |
| `BROWSER_POOL_SIZE`       | `2`       | Browser tabs at once (each one costs a few hundred MB)                      |
| `CRAWL_MAX_PAGES`         | `50`      | Maximum pages per exploration                                               |
| `CRAWL_MAX_DURATION_MS`   | `600000`  | Maximum duration of one exploration (10 min)                                |
| `RATE_LIMIT_MAX_REQUESTS` | `30`      | API requests per minute per client                                          |
| `SECURITY_ALLOWED_HOSTS`  | _(empty)_ | Restrict crawling to these hosts (comma-separated)                          |
| `TRUST_PROXY`             | `false`   | Set when behind a reverse proxy — see [below](#exposing-it-on-the-internet) |

**Saved configurations** are stored on the server in `data/profiles.json`, so
they are shared by everyone who opens your instance. A fresh install starts
with none.

---

## Part of Clipgeist

clipscout is one of three independent, self-hosted apps that work together, in the style of
Sonarr, Radarr and Prowlarr:

| App            | What it does                                            | Default port |
| -------------- | ------------------------------------------------------- | ------------ |
| **clipscout**  | Finds files on websites (this app)                      | `3001`       |
| **clonbuster** | Detects duplicate videos and photos and sets them aside | `8095`       |
| **clipkeeper** | Catalogs, plays and organizes your video library        | `8096`       |

Each app keeps its own data and works on its own. Connecting them lets each one use what the
others know (for example, "do I already have this?" before downloading).

**Connect them** — every app has a **Settings** tab:

1. In app B, open **Settings → Security → Admin key** (in clipscout, **Settings → Clipgeist**) and
   copy it (it is used once, to register).
2. In app A, open **Settings → Connected apps → + Add connection** (clipscout: **Settings → Clipgeist**), pick B, check the suggested URL
   (`http://<server-ip>:<port>`), paste B's key, press **Test**, then **Save**.
3. With _Also connect in the opposite direction_ ticked (the default), B is connected back to A
   automatically. From then on each app keeps only a **connection key** (`cgc_…`) that the other
   one issued: it only opens the protocol routes, and can be revoked in **Settings → Connections**.
   Connections made with older versions switch to connection keys by themselves.

The header shows the three apps with the same look in all of them (the current one highlighted,
the ones not connected dimmed), to jump between them. With **clipkeeper** connected, the
**Do I have it?** button in the Videos tab marks the results that are already in your library. The protocol (endpoints,
admin and connection keys in the `X-Api-Key` header, shared sessions, error format) is described in
[docs/CREW.md](docs/CREW.md).

### Install the three apps together

If you run all three on the same server, [`deploy/clipgeist/compose.yaml`](deploy/clipgeist/compose.yaml)
builds and starts them together, already connected. It expects the three repositories side by
side (`clipscout/`, `clipkeeper/`, `clonbuster/`):

```bash
cd clipscout/deploy/clipgeist
cp .env.example .env        # set CLIPGEIST_CLAVE (openssl rand -hex 16) and CARPETAS
mkdir -p datos/clipscout datos/clipkeeper datos/clonbuster
docker compose up -d --build
```

All three use the shared key in `CLIPGEIST_CLAVE` for the first registration (then each keeps its
own connection keys) and find each other through
`CLIPGEIST_CLIPSCOUT_URL`, `CLIPGEIST_CLIPKEEPER_URL` and `CLIPGEIST_CLONBUSTER_URL` (by default the
internal service names). On startup each app creates its connections to the other two, and keeps
retrying for a few minutes if one is still starting. Connections you added by hand are left
alone, and without these variables nothing changes. Set the URLs to LAN addresses
(`http://<server-ip>:<port>`) if you want the header links between apps to open in your browser.

### Sending to JDownloader

clipscout can hand what it finds straight to **JDownloader 2**, so a search ends in a download
without copying links by hand.

**1. Turn on JDownloader's local API** (once):

- _Desktop JDownloader_: **Settings → Advanced Settings**, search `RemoteAPI` and set
  `Deprecated API enabled` **on** and `Deprecated API localhost only` **off**. Restart JDownloader.
- _JDownloader in Docker_ (e.g. `jlesage/jdownloader-2`): do the same from its web UI
  (port `5800`) and also publish the API port in its compose file:

  ```yaml
  ports:
    - '5800:5800' # web UI
    - '3128:3128' # local API used by clipscout
  ```

  Check it from the clipscout machine: `curl http://<jdownloader-ip>:3128/jd/version` should
  answer with a number.

**2. Connect it in clipscout**: **Settings → Downloads**, paste
`http://<jdownloader-ip>:3128`, press **Test** and **Save**. Optional:

- **Start downloads right away** (autostart), or leave them in JDownloader's link grabber.
- **clipkeeper library**: if clipkeeper is connected, pick the library that _is_ JDownloader's
  download folder. Its subfolders then become the destinations you choose from.

**3. Send**: **Send to JDownloader** appears above the results (Explorer and Videos tab; it sends
everything visible) and on every video card of the Videos tab. Pressing it asks for the
destination folder — the library's folders, each with the people and tags it holds, a search box,
_default folder_, or _new folder_.

What happens then:

- Everything sent at once goes into **one JDownloader package** in that folder, so JDownloader
  doesn't create a package (or a folder) per file.
- clipkeeper picks up whatever lands there on its next automatic rescan (every 30 minutes by
  default, or press **Refresh**) and catalogues it with the people and tags that folder already
  has.
- When a page offers the same file on several hosts, clipscout keeps the ones JDownloader can
  download **without an account** and drops premium-only hosts. Some free hosts still ask for a
  CAPTCHA: JDownloader shows it in its own window (or web UI on port `5800`), or you can plug a
  CAPTCHA-solving service into JDownloader under _Settings → Captchas_.

> Calls to other Clipgeist apps only go to the URLs you add in **Settings**, and only to their
> `/api/crew/v1/...` endpoints (and, for JDownloader, to its API). The SSRF protection that keeps crawls away from private addresses
> is unchanged.

| Variable          | Default          | What it does                                                                                                                                                                                                                       |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OUTBOUND_PROXY`  | _(empty)_        | Optional outbound proxy for crawls and the browser, e.g. `http://192.168.1.10:8118` (the Privoxy of a VPN container). Useful when your ISP blocks a site                                                                           |
| `ADMIN_PASSWORD`  | _(empty)_        | Fixes the password from the environment (only its hash is kept in memory), username in `ADMIN_USER` (default `admin`, case-insensitive). Otherwise it is set in Settings → System → Access. Scripts use the `X-Api-Key` admin key. |
| `DATA_DIR`        | `data/`          | Folder for all of clipscout's data. When set, `crew.json` and `profiles.json` live inside it too (unless `CREW_PATH`/`PROFILES_PATH` say otherwise). Not set: nothing changes                                                      |
| `CREW_PATH`       | `data/crew.json` | API key, instance name and connections                                                                                                                                                                                             |
| `CREW_TIMEOUT_MS` | `6000`           | Timeout when talking to another Clipgeist app                                                                                                                                                                                      |

---

## Updating and backups

```bash
cd clipscout
git pull
docker compose up -d --build
```

Your saved configurations survive updates. clipscout makes a **daily backup** of its own files
(`data/*.json`: connections, sites, scheduled searches, filters, statistics) in `data/respaldos/`
and keeps the last `RESPALDOS_DIAS` days (7). **Settings → System → Backups** lists them and lets you
download or restore one (restoring first saves the current state, so it can be undone). The
download leaves out the password hash and every key (the local copies keep them, readable only by
the owner, so they can restore the install). Keep a copy of `.env` yourself.

Every data file is written atomically and keeps its previous version as `<file>.bak`. If
`data/crew.json` gets damaged, clipscout restores that copy and keeps the damaged one as
`crew.json.corrupto-<date>`. With no good copy it stays **locked** (HTTP 503) instead of opening
without a password, and never overwrites the file: fix it or copy one from `data/respaldos/`.

Searches that were running or queued when the server stops are saved in `data/busquedas.json` and
resume on their own after a restart (only the sites that hadn't finished). Explorer results are
never written to disk — they live in the browser tab that ran the exploration, so export them if
you want to keep them. Paused explorations are kept in memory and are lost on restart.

---

## Exposing it on the internet

clipscout asks for a user and password (sessions are kept on the server: **Settings → System**
lists them and closes them). It only answers host names it knows (an IP, `localhost`, the
computer's name, the hosts of its connections, or `CLIPGEIST_HOSTS`) and rejects actions sent
from other websites. Without HTTPS the password travels in clear text: if you open it to the
internet, put it behind a reverse proxy with HTTPS (set `CLIPGEIST_PROXY_CONFIABLE=1` so the
cookie is marked secure) or a VPN such as Tailscale or WireGuard. The app shows a warning when it
is reached from a public address without encryption.

Behind a reverse proxy, set `TRUST_PROXY` in `.env` to the proxy's IP address
as the app sees it. Never set it to `true`: that lets any client fake its IP and
skip the rate limit.

Minimal nginx example — the last two lines matter, or the progress bar freezes
until the exploration ends:

```nginx
location / {
    proxy_pass         http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header   Host            $host;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering    off;
    proxy_read_timeout 3600s;
}
```

---

## Install without Docker

Needs **Node.js 20 or newer**. Puppeteer downloads its own Chromium during
`npm install`.

```bash
git clone https://github.com/lucasfrattini/clipscout.git
cd clipscout
npm install
cp .env.example .env
npm start
```

It listens on `PORT` from `.env` (default **http://localhost:3000**). To keep it
running after you log out, use a process manager such as systemd or pm2.

---

## How to use it

**Search** is the start page, with a single box:

- **A name or a word** searches every saved site at once.
- **A link** gets its videos: if it is a listing (a category, a profile) it
  walks its pages; if it is a video page, it gets that video.
- **A bare domain** (`example.com`) offers to add it as a site.

To add sites, press **+ Add sites**, paste their addresses (one per line) and
a term those sites have; the test result tells you which ones work.

The app has five buttons, at the bottom of the screen on a phone and as a side bar on a computer:
**Search**, **Advanced** (walk a page or a whole site by hand), **Activity** (queued searches,
packages sent to JDownloader and scheduled searches), **Settings** (Search · Downloads · Clipgeist ·
System) and, always last, **Apps** (the other Clipgeist apps, using the address you are browsing
from, the guide and **Log out**). It is made to be used with one hand:

- The search box sits in the top row with a single **Filters (N)** button next to it. Its sheet has
  two parts: **What to search** (which sites, pages per site, the web, several searches at once,
  large or compact results) and **Filter results**. N counts what is active in both; the active
  result filters also stay on screen, each with its ✕.
- Results come **large** by default (two per row on a phone, with a big thumbnail) or as a
  **compact list** (about eight per screen), remembered on each device. **Long-press** a result,
  or tick its box, to select several; the bottom bar then offers **Download**, **All** and
  **Remove**. Removing is undone with **Undo**.
- What you **already have** (clipkeeper) and what you **already sent** to JDownloader are hidden
  by default, with a counter to show them, and never go into **Download all**.
- **Stop** stops a search at once, even if a site is not answering.

**Advanced** (`#/explorer`) is the full explorer, for going deep on one site by hand; the same
screen is the **site editor** (_Settings → Search → Sites → ⋯ → Edit_):

1. **Addresses to explore** — the page where the walk starts. You can use
   `{q}` where the search term goes and `{page}` where the page number goes.
   Not sure? Press **Set it up for me** and review what it proposes.
2. **Link pattern** — which links you care about. Plain text (`/videos/`) or a
   regular expression between slashes (`/\/videos\/\d+/`). Empty takes all.
3. **File extensions** — comma-separated (`mp4, jpg`). Empty skips the second
   phase and just lists the links.
4. **Pages** — how far to go. For sites that load more as you scroll, pick the
   _scroll_ mode in the advanced options (it needs browser rendering).

Press **Save** to keep the setup for later. Filters inside the results card
work on what was already found and never start a new crawl.

---

## Troubleshooting

**Saving a configuration fails.** The container runs as user id 1000 and
must be able to write to the `data/` folder. If your user has another id, run
`sudo chown 1000:1000 data` once.

**Browser mode hangs or Chromium crashes.** Not enough memory. Lower
`BROWSER_POOL_SIZE`, add swap, or set `BROWSER_ENABLED=false`.

**The progress bar does not move until the end.** A reverse proxy is buffering
— add `proxy_buffering off` (see above).

**Everyone gets "too many requests" behind a proxy.** Set `TRUST_PROXY` to the
proxy's address.

**It stopped early.** It reached a safety cap such as `CRAWL_MAX_PAGES` or
`CRAWL_MAX_DURATION_MS`; the interface says which. Raise it in `.env`.

**A site keeps answering 429 and it slows down.** Intended: it backs off from
that site automatically to avoid hammering it.

**Local addresses are blocked.** SSRF protection prevents crawling private or
loopback addresses, on purpose.

---

## Development

```bash
npm install
npm run dev      # auto-reload
npm run check    # lint + formatting + tests — run before committing
npm run e2e      # browser smoke test (needs Playwright with Chromium; see tests/e2e/humo.mjs)
```

On a fresh install (no user, no sites, no connections) clipscout opens a **first-run assistant**:
account (or the same one as another Clipgeist app), JDownloader, one to three sites, the other
apps, and a QR code to open it from your phone. Existing installs never see it. To stop it
cleanly, `POST /api/apagar` (from the same machine with `X-Clipgeist: 1`, a session or the admin
key) or send SIGTERM: running and queued searches are saved and resume on the next start.
**Settings → System → About** shows the version, the licence and the third-party components.

No build step and no framework: `public/` is served as-is. How the code is
organised, the API and the design decisions are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Per-site extractors go in
`src/extensions/` (see [its README](src/extensions/README.md)).

---

## Responsible use

clipscout is a generic tool: it automates what you would do by hand clicking
"next page", sending plain HTTP requests (or rendering with a normal browser)
to URLs **you** provide. It ships with no list of targets and does not get past
any access control: it does not break DRM or encryption, bypass paywalls or
logins, or solve CAPTCHAs. It only reads what a page already serves to any
visitor.

It is meant for content you are entitled to download: your own uploads,
public-domain or openly licensed works (see the open-license filter), and
material whose owner allows downloading.

By running it, you are responsible for:

- having the right to access and download the content you point it at;
- respecting each site's terms of service and its `robots.txt`;
- complying with the copyright law of your country, and not downloading or
  redistributing material you have no rights to.

Do not run a public instance that offers its search results to other people:
clipscout is designed to be self-hosted by each user, for their own use.

Keep the throttling defaults so a run does not overload the sites you explore.
The open-license filter relies on what the site declares and is not legal
advice. The software stores no results and the author has no visibility into
what any instance is used for. It is provided "as is", without warranty.

---

## License

[GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html): free to use,
self-host and modify, including commercially. If you distribute a modified
version — including running it as a network service for others — you must
publish that version's source under the same license. Full text in
[`LICENSE`](LICENSE).
