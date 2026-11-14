# First-party traffic counts (page views and plates viewed per day) (AB#5009)

Product: architecture-atlas · Version: 1.1 · Lanes: architecture-atlas/all

Estimate: 1 Builder session, about 30 minutes of Builder time (PM estimate, 2026-10-16; the actual goes beside it when the Feature closes).

## Why

The Atlas is 200 plates on a static nginx Container App with no idea how many people read it or which plates matter; the Board wants that number before spending effort on a name, a domain and promotion. The app has no server code and must stay a static site, so the counts come from nginx's own access log, written without any personal data, and read with a script: no cookies, no third-party scripts, no beacon in the pages. This does not wait for the rename (Decision AB#4982).

## Acceptance

1. nginx.conf writes one JSON line per request to stdout with only: UTC timestamp to the minute, path with the query string removed, status, and a bot flag set by a `map` over the request's user agent. It logs no IP address, no user agent, no referrer, no cookie and no header values; a test starts the container (or `nginx -t` plus a replay against a local instance), makes requests with an IP-bearing and UA-bearing client, and asserts the logged line contains none of those and parses as the documented shape.
2. Only real reads count: a "view" is a status-200 GET of the home page or a plate page (`/` or `/atlas/<plate>/`) with the bot flag unset. Asset requests, 404s, HEAD requests, health checks and flagged bots are excluded by the counting script, not dropped from the log, and a fixture log proves each exclusion.
3. `node tools/traffic.mjs [--days 30] [--csv]` prints, per day, page views, distinct plates viewed, and the 10 most viewed plates over the period, from Log Analytics through `az monitor log-analytics query` using the Board's existing az login (read-only, no key handled); `--file <log>` runs the same maths on a local log, which is what the tests use. If the shared environment's workspace cannot be queried, the script says so and prints the exact role the Board must grant (a Board action) instead of failing silently.
4. The pages are untouched: the built HTML of all 200 plates and the home page is byte-identical before and after (a test diffs the build), and no cookie, script or beacon is added.
5. README states what is logged and what is not, in plain words, and how long Log Analytics keeps it. Deploying the nginx change is the Board's, through the Deploy dashboard; the PR names what to check after deploy (a request, then the script showing it).

## Slices

### Slice 1: Anonymous access log, the counting script and its tests (lane: architecture-atlas/all)
- [x] nginx.conf log_format and bot map; tools/traffic.mjs with --file and the Log Analytics query; fixture logs and exclusion tests; byte-identical build test; README paragraph

## Demo script

1. Request three plates and the home page against a local container. Shows: four JSON lines with no IP or user agent.
2. Run `node tools/traffic.mjs --file <log>`. Shows: page views, distinct plates and the top plates per day, with the bot request left out.
3. After the Board's deploy, run `node tools/traffic.mjs --days 1`. Shows: today's real counts.

## Out of scope

- Unique visitors or any per-person measure; third-party analytics; changing any plate.
- The rename and domain (AB#4984).
