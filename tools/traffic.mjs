// How many people read the Atlas, and which plates (AB#5009). nginx writes one anonymous JSON line per request
// (infra/nginx.conf, atlas_anon: minute, method, path, status, bot flag; nothing about the person). This counts them.
//
//   node tools/traffic.mjs [--days 30] [--csv]          from Log Analytics, with your own az login (read only)
//   node tools/traffic.mjs --file <log> [--days N] [--csv]  the same sums over a local log (the tests use this)
//
// A view is a GET answered 200 for the home page or a plate page (/ or /atlas/<plate>/), not flagged as a bot. Assets,
// 404s, HEAD requests, the health check and bots stay in the log and are left out here.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const APP = "architecture-atlas", ENV = "orch-env", GROUP = "rg-orchestrata";

/** One log line as nginx wrote it, or null for anything else (Container Apps mixes in nginx's own notices). */
export function parseLine(line) {
  const i = line.indexOf("{");
  if (i < 0) return null;
  try {
    const r = JSON.parse(line.slice(i));
    return typeof r.t === "string" && typeof r.p === "string" && Number.isInteger(r.s) ? r : null;
  } catch { return null; }
}

/** The page a path is, "/" or "/atlas/<plate>/", or null for anything that is not a page. nginx logs the path after
 *  its index lookup, so "/atlas/x/" arrives as "/atlas/x/index.html". */
export function pageOf(path) {
  const p = path.replace(/index\.html$/, "");
  if (p === "/") return "/";
  const m = /^\/atlas\/([a-z0-9-]+)\/$/.exec(p);
  return m ? `/atlas/${m[1]}/` : null;
}

/** Whether a logged request is a real read: a GET, answered 200, of a page, by something not flagged as a bot. */
export const isView = (r) => r.m === "GET" && r.s === 200 && !r.b && pageOf(r.p) !== null;

/** Per day: views and distinct plates; over the period: the 10 most viewed plates. `since` is "YYYY-MM-DD" or null. */
export function count(records, { since = null } = {}) {
  const days = new Map(), plates = new Map();
  for (const r of records) {
    if (!isView(r)) continue;
    const day = r.t.slice(0, 10);
    if (since && day < since) continue;
    const page = pageOf(r.p);
    const d = days.get(day) ?? { views: 0, plates: new Set() };
    d.views++;
    if (page !== "/") { d.plates.add(page); plates.set(page, (plates.get(page) ?? 0) + 1); }
    days.set(day, d);
  }
  return {
    days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({ day, views: d.views, plates: d.plates.size })),
    top: [...plates.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([page, views]) => ({ plate: page.slice(7, -1), views })),
  };
}

export function render({ days, top }, { csv = false } = {}) {
  if (csv) return ["day,views,plates", ...days.map((d) => `${d.day},${d.views},${d.plates}`)].join("\n");
  const total = days.reduce((a, d) => a + d.views, 0);
  return [
    "Page views (status 200 GETs of the home page or a plate, bots left out; counted from the anonymous nginx log):",
    ...days.map((d) => `  ${d.day}  ${String(d.views).padStart(6)} views  ${String(d.plates).padStart(4)} plates`),
    `  total ${total} views over ${days.length} day(s) with any`,
    "Most viewed plates:",
    ...(top.length ? top.map((t, i) => `  ${String(i + 1).padStart(2)}. ${t.plate}  ${t.views}`) : ["  none yet"]),
  ].join("\n");
}

const sinceOf = (days) => new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);

function az(args) {
  const r = spawnSync("az", args, { encoding: "utf8", maxBuffer: 1 << 28, shell: process.platform === "win32" });
  if (r.error || r.status !== 0) { const e = new Error((r.stderr || r.error?.message || "az failed").trim()); e.az = true; throw e; }
  return r.stdout;
}

/** The log lines from the shared environment's Log Analytics workspace, through the Board's az login. */
function fromLogAnalytics(days) {
  let ws;
  try { ws = az(["containerapp", "env", "show", "-n", ENV, "-g", GROUP, "--query", "properties.appLogsConfiguration.logAnalyticsConfiguration.customerId", "-o", "tsv"]).trim(); }
  catch (e) { throw new Error(`Cannot read the ${ENV} environment's Log Analytics workspace: ${e.message}\nThe Board needs Reader on ${GROUP} (az login first).`); }
  const q = `ContainerAppConsoleLogs_CL | where ContainerAppName_s == '${APP}' and TimeGenerated > ago(${days}d) | project Log_s`;
  try {
    return JSON.parse(az(["monitor", "log-analytics", "query", "-w", ws, "--analytics-query", q, "-o", "json"])).map((row) => row.Log_s ?? "");
  } catch (e) {
    throw new Error(`Cannot query the Log Analytics workspace ${ws}: ${e.message.split("\n")[0]}\n` +
      `Board action: grant your account the "Log Analytics Reader" role on that workspace (its resource in ${GROUP}), then run this again.`);
  }
}

async function main(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const days = Number(arg("--days") ?? 30);
  if (!(days >= 1 && days <= 730)) throw new Error("--days is 1 to 730");
  const file = arg("--file");
  const lines = file ? fs.readFileSync(file, "utf8").split("\n") : fromLogAnalytics(days);
  const records = lines.map(parseLine).filter(Boolean);
  console.log(render(count(records, { since: file && !argv.includes("--days") ? null : sinceOf(days) }), { csv: argv.includes("--csv") }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
