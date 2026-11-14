# Schematica

The Architecture Atlas for Software. (Formerly architecture-atlas: the repository and the Azure resources keep that name.)

Plates of how software is built: one layered architecture map per kind of software, written for engineers (human and
AI) who need to understand a system before changing it. Every component opens into what it does, the design decisions
behind it, its pitfalls, how to verify it, and what it depends on. The maps describe kinds of software, not products,
so they stay language- and vendor-agnostic.

It is a static site. There is no build step to view it and no runtime dependencies other than Google Fonts.

## What it does today

- A home page listing all 50 plates by domain, with a search box and a thumbnail for each.
- All 200 plates are drawn: 19,997 components across 13 domains, each with a full entry. `docs/writing-a-plate.md` is
  the brief they were written against.
- Each drawn plate renders as an SVG chart of numbered layers, groups and components, with optional components marked
  and a hover tooltip.
- Clicking a component opens a detail drawer with its summary, design decisions, pitfalls, how to verify it, and its
  direct dependencies.
- Light and dark themes with a toggle.
- Data loads through script tags rather than `fetch`, so the site also works when opened from disk.

## Getting started

Prerequisites: a web browser. Node.js is needed only for the validation and page-generation scripts, which use ES
modules and have no npm dependencies, so there is nothing to install.

To view the site, open `index.html` in a browser, or serve the folder with any static file server, for example:

```
python -m http.server 8000
```

There is no `package.json` or `.env` file. The checks are the scripts described below, and `node --test tools/traffic.test.mjs` for the traffic counts.

## Layout

- `index.html`, `atlas/<slug>/index.html`: generated pages; do not edit by hand.
- `assets/atlas.css`: design tokens (light and dark), page and chart styles.
- `assets/atlas.js`: the data registry (`ATLAS.register`, `ATLAS.details`) and the theme toggle.
- `assets/chart.js`: draws a plate as SVG, plus the home-page thumbnails.
- `assets/site.js`: home page and plate page (tooltip, detail drawer, search).
- `assets/catalog.js`: all 50 plates, by domain. Plate numbers come from the order.
- `assets/manifest.js`: generated list of drawn plates and their data files.
- `atlas/<slug>/data.js`: a plate's structure. `atlas/<slug>/details*.js`: its component entries.
- `tools/check-map.mjs`, `tools/build.mjs`: validation and page generation.

## Adding a plate

1. Write `atlas/<slug>/data.js` (`ATLAS.register({...})`), using `atlas/game-engine/data.js` as the model: bands from
   top to bottom, 8-15 groups each with a unique `color` from 1 to 15, and `optional: true` where many implementations
   omit the system.
2. Write `atlas/<slug>/details*.js` (`ATLAS.details(slug, { id: { s, d, k, p, v, dep } })`) for every component and
   cross-cutting concern: hover summary, detail, decisions, pitfalls, how to verify, direct dependencies.
3. Run `node tools/check-map.mjs <slug>` until it reports a clean map. It checks structure, word counts, ids,
   dependencies, and that no product, brand or language names appear.
4. Run `node tools/build.mjs` to regenerate the pages and the manifest.

## Configuration

None. There are no environment variables or config files.

## Traffic

The Atlas counts its readers from its own web server's log, with no cookie, no script and nothing added to the pages
(AB#5009). For each request nginx writes one line with five things: the minute (UTC), the method (GET, HEAD), the
path without its query string, the status code, and whether the visitor looked like a bot. It does not record your IP
address, your browser's user agent, the page you came from, any cookie or any other header; the user agent is read
only to set the bot flag and is then discarded. The lines go to the shared environment's Log Analytics workspace
(`orch-logs`), which keeps them for 30 days.

`node tools/traffic.mjs [--days 30] [--csv]` prints page views per day, the number of distinct plates viewed, and the
ten most viewed plates. A view is a GET answered 200 for the home page or a plate page by something not flagged as a
bot; assets, 404s, HEAD requests, the health check and bots stay in the log and are not counted. It reads Log
Analytics with your own `az login` (read only); if that is refused it prints the role to grant. `--file <log>` counts
a local log instead. Tests: `node --test tools/traffic.test.mjs` (the container test needs Docker).

The pages do load their fonts from Google Fonts, which sees a visitor's IP address as any web font host does; that
predates the traffic counts and is not part of them.

## Custom domain: schematica.ca

The Board named the domain on 2026-10-17 (Decision AB#4982; AB#4984): **schematica.ca**, served on the apex, with
`www.schematica.ca` sent to it. It is set in one place, `infra/site.json`. From it:

- `node tools/build.mjs` gives every page a canonical link on `https://schematica.ca/`, lists the home page and all 200
  plates in `sitemap.xml`, and names the sitemap in `robots.txt`.
- `infra/deploy.sh` (and `infra/deploy.ps1`) pass `customDomain=schematica.ca` and `redirectDomain=www.schematica.ca` to `infra/atlas.bicep`,
  which adds both hosts to the Container App with an Azure-managed certificate each, and gives the container
  `SITE_DOMAIN`. nginx then answers every path on the old azurecontainerapps.io address, and on `www.schematica.ca`,
  with a 301 to the same path on `schematica.ca`. Plain http already goes to https (the ingress refuses insecure).

**The Board's steps** (a Board action on AB#4984):

1. Register `schematica.ca`, at any registrar that sells .ca (IONOS, where burkart.dev is, does).
2. Add these four records in its DNS:

   | Type | Name (host) | Value | Why |
   |---|---|---|---|
   | A | `@` | `20.116.245.0` | the apex, to the orch-env environment's static IP |
   | TXT | `asuid` | `5445C7B0F50317B1FDE1E32A150516EB6F3F8F0E05F39BE4452A92135663ACB7` | proves the apex is ours to Azure |
   | CNAME | `www` | `architecture-atlas.salmonbay-0aeaf94d.canadacentral.azurecontainerapps.io` | www, to the app |
   | TXT | `asuid.www` | `5445C7B0F50317B1FDE1E32A150516EB6F3F8F0E05F39BE4452A92135663ACB7` | proves www is ours to Azure |

   The TXT value is the environment's domain verification id (a public value; `infra/atlas.bicep` outputs it).
3. Once all four records resolve (`resolvectl query schematica.ca` gives 20.116.245.0, and
   `resolvectl query -t TXT asuid.schematica.ca` the verification id; this machine has no `dig`), approve it in the Console's Deploy dashboard,
   then from the architecture-atlas folder run `infra/deploy.sh -Live` (Linux; `infra/deploy.ps1` on Windows): both
   hosts are added to the app, unbound; Azure checks the `asuid` TXT records as it adds them. The old address keeps
   serving the site: nothing redirects yet (Bug AB#5066). `infra/deploy.sh` with no
   flags is a dry run that prints every command.
4. Then run `infra/deploy.sh -Live -CertificateReady`: Azure issues a managed certificate for each host (it validates
   the apex over HTTP and www by its CNAME, which can take several minutes) and binds them; only now do the old address
   and www start redirecting to schematica.ca. Record what is live in the
   Deploy dashboard.
5. Check it: `node tools/check-host.mjs architecture-atlas.salmonbay-0aeaf94d.canadacentral.azurecontainerapps.io schematica.ca`
   (the new home page and five plates, the old host and www moving every path, a 404 kept, http to https).

## Tech stack

Plain HTML, CSS and JavaScript (no framework, no bundler), SVG for the charts, Google Fonts (Fraunces, Geist, Geist
Mono), and Node.js scripts for tooling.

## Status

All 200 planned plates are drawn and pass `tools/check-map.mjs`; `tools/scan-names.mjs` is a second-line check for product names. The entries were written by AI agents against the brief
and have not yet been reviewed by people who build each kind of software, so treat individual claims accordingly.

## Licence

All rights reserved. The source is public to read, not to reuse: see [LICENSE](LICENSE).
