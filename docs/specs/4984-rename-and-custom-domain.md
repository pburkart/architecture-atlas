# Rename to Schematica and host on a custom domain (AB#4984)

Product: architecture-atlas · Version: 1.1 · Lanes: architecture-atlas/all

Estimate: 1 Builder session, about 30 minutes for slice 1 (recalibrated 2026-10-16, AB#4963; slice 2 about 20 more once the domain is known) of Builder time (PM estimate, 2026-10-16; the actual goes beside it when the Feature closes).

> **Board answers (AB#4982, relayed by the Advisor tab, 2026-10-16 and 2026-10-17):** the name is **"Schematica - The Architecture Atlas for Software"**, and the domain is **schematica.ca**, which the Board owns. Apex or www was not answered (the Board asked "wdym"), so the recommendation is the default: the site lives on the **apex, schematica.ca**, and **www.schematica.ca redirects to it**, unless the Board says otherwise. Slice 2 can start now.

## Why

The Atlas (200 plates, 19,997 components) is running on an azurecontainerapps.io address under a working name. The Board wants it renamed and served from its own domain so it can be shared and found. The name and domain are the Board's choice (Decision AB#4982), so this Feature is blocked until they are answered.

## Acceptance

1. `node tools/rename.mjs "Architecture Atlas" "Schematica"` (idempotent, dry run by default) changes the product name everywhere it appears as the name: site title, home page, every plate page title and header and footer, Open Graph tags, README, catalog.js, package metadata and the docs; `tools/scan-names.mjs` is extended to fail if the old name "Architecture Atlas" remains anywhere as the product's name; the tagline "The Architecture Atlas for Software" (full title "Schematica - The Architecture Atlas for Software") is the only permitted use, plus a one-line "formerly architecture-atlas" note in the README. The plates stay language- and vendor-agnostic (the existing name scan still passes).
2. The site is served from schematica.ca (the apex; www.schematica.ca answers with a 301 to the apex, path kept): infra/atlas.bicep binds the custom domain to the Container App with a managed certificate, the Board adds exactly the DNS records the PR lists (a Board action, with the record names and values and where to add them), and `https://<domain>/` serves the home page with a valid certificate. A Builder edits the bicep and docs only; the Board deploys through the Deploy dashboard.
3. The old azurecontainerapps.io address answers every path with a 301 to the same path on the new domain (nginx.conf), and plain http redirects to https; `node tools/check-host.mjs <old host> schematica.ca` (also checking that www.schematica.ca redirects to the apex) proves five sample plate paths, the home page and a missing path (404 stays 404) against the deployed site.
4. Every plate carries a canonical link to the new domain; sitemap.xml lists all 200 plates plus the home page on the new domain and robots.txt points to it; the existing check-map and link checks pass with no broken internal link.
5. Nothing else about the site changes: plate content, URLs under the site root, and the Azure resource names stay as they are unless the Board says otherwise in the Decision.

## Slices

### Slice 1: Rename tool and name scan (lane: architecture-atlas/all)
- [x] tools/rename.mjs with dry run and idempotence test; extend tools/scan-names.mjs; apply once the name is known; screenshots of home and one plate

### Slice 2: Domain binding, redirects, canonical tags and sitemap (lane: architecture-atlas/all)
- [ ] atlas.bicep custom domain and managed certificate; nginx 301 from the old host and http to https; canonical, sitemap.xml, robots.txt; tools/check-host.mjs; list the DNS records for the Board action

## Demo script

1. Open https://schematica.ca/. Shows: the Atlas under its new name with a valid certificate.
2. Open the old azurecontainerapps.io address with a plate path. Shows: a 301 to the same plate on the new domain.
3. Search the repo for the old name. Shows: only the README "formerly" note.
4. Run tools/check-host.mjs. Shows: all checks pass.

## Out of scope

- Changing plate content or adding plates; renaming Azure resources or the GitHub repo (the Board's call); buying the domain.
