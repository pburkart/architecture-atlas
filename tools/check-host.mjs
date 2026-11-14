// After the custom domain is live (AB#4984): does the new host serve the site, and does the old one send everything there?
//   node tools/check-host.mjs <old host> <new host>
//   node tools/check-host.mjs architecture-atlas.salmonbay-0aeaf94d.canadacentral.azurecontainerapps.io schematica.ca
// Checks, each printed with ok or FAIL (exit 1 on any FAIL): the new home page answers 200 under the new name; five
// plates answer 200 there; each of those paths, and the home page, on the old host answers 301 to the same path on the
// new one; www on an apex domain answers 301 to the apex; plain http on the new host is sent to https; a missing path
// answers 404 on the new host and is moved, not served, on the old one.
import { pathToFileURL } from "node:url";

export const PLATES = ["compiler", "web-server", "relational-database", "os-kernel", "game-engine"];

/** The checks against `oldHost` and `newHost`, over `scheme` (tests use http on local ports): [{ ok, what }]. */
export async function checkHosts(oldHost, newHost, { scheme = "https", plainBase = `http://${newHost}`, wwwHost = newHost.split(".").length === 2 ? `www.${newHost}` : null } = {}) {
  const out = [], add = (ok, what) => out.push({ ok, what });
  const get = (url) => fetch(url, { redirect: "manual" }).catch((e) => ({ status: 0, error: e.message, headers: new Headers() }));
  const home = await get(`${scheme}://${newHost}/`);
  const body = home.status === 200 ? await home.text() : "";
  add(home.status === 200 && body.includes("Schematica"), `new home page: ${home.status}${home.status === 200 && !body.includes("Schematica") ? ", without the name Schematica" : ""}`);
  for (const p of PLATES) {
    const r = await get(`${scheme}://${newHost}/atlas/${p}/`);
    add(r.status === 200, `new /atlas/${p}/: ${r.status}`);
  }
  for (const p of ["/", ...PLATES.map((s) => `/atlas/${s}/`), "/atlas/no-such-plate/"]) {
    const r = await get(`${scheme}://${oldHost}${p}`), to = r.headers.get("location");
    add(r.status === 301 && to === `https://${newHost}${p}`, `old ${p}: ${r.status} -> ${to ?? "(no location)"}`);
  }
  if (wwwHost) { // the www host only redirects to the apex (the Board, 2026-10-17)
    const r = await get(`${scheme}://${wwwHost}/atlas/compiler/`), to = r.headers.get("location");
    add(r.status === 301 && to === `https://${newHost}/atlas/compiler/`, `www /atlas/compiler/: ${r.status} -> ${to ?? "(no location)"}`);
  }
  const missing = await get(`${scheme}://${newHost}/atlas/no-such-plate/`);
  add(missing.status === 404, `new missing path: ${missing.status} (404 stays 404)`);
  const http = await get(`${plainBase}/atlas/compiler/`), to = http.headers.get("location") ?? "";
  add([301, 302, 307, 308].includes(http.status) && to.startsWith(`https://${newHost}/atlas/compiler/`), `plain http: ${http.status} -> ${to || "(no location)"}`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [oldHost, newHost] = process.argv.slice(2);
  if (!oldHost || !newHost) { console.error("usage: node tools/check-host.mjs <old host> <new host>"); process.exit(2); }
  const results = await checkHosts(oldHost, newHost);
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.what}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `${bad} check(s) failed` : "all checks passed");
  process.exit(bad ? 1 : 0);
}
