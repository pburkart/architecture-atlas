// node --test tools/traffic.test.mjs
// AB#5009: the anonymous access log's shape (infra/nginx.conf) and the counting script (tools/traffic.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseLine, pageOf, isView, count, render } from "./traffic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = fs.readFileSync(path.join(root, "tools/fixtures/traffic.log"), "utf8").split("\n");
const records = fixture.map(parseLine).filter(Boolean);

test("the log format holds only the minute, method, path, status and bot flag: nothing about the person", () => {
  const conf = fs.readFileSync(path.join(root, "infra/nginx.conf"), "utf8");
  const fmt = /log_format atlas_anon escape=json '([^']*)';/.exec(conf)?.[1];
  assert.ok(fmt, "the atlas_anon log_format");
  assert.deepEqual([...fmt.matchAll(/\$(\w+)/g)].map((m) => m[1]), ["atlas_minute", "request_method", "uri", "status", "atlas_bot"]);
  assert.match(conf, /access_log \/dev\/stdout atlas_anon;/);
  assert.doesNotMatch(conf, /access_log [^;]*\b(main|combined)\b/, "no other access log format left in use");
  for (const v of ["remote_addr", "http_x_forwarded_for", "http_referer", "http_cookie", "request_uri", "args", "query_string"])
    assert.ok(!fmt.includes(`$${v}`), `$${v} is not logged`);
  // a logged line parses as the documented shape
  const line = fmt.replace("$atlas_minute", "2026-10-16T10:00").replace("$request_method", "GET").replace("$uri", "/").replace("$status", "200").replace("$atlas_bot", "0");
  assert.deepEqual(JSON.parse(line), { t: "2026-10-16T10:00", m: "GET", p: "/", s: 200, b: 0 });
});

test("pages are the home page and plate pages, however nginx logs them", () => {
  assert.equal(pageOf("/index.html"), "/");
  assert.equal(pageOf("/"), "/");
  assert.equal(pageOf("/atlas/compiler/index.html"), "/atlas/compiler/");
  assert.equal(pageOf("/atlas/compiler/"), "/atlas/compiler/");
  for (const p of ["/assets/site.css", "/atlas/compiler/data.js", "/healthz", "/atlas/", "/LICENSE"]) assert.equal(pageOf(p), null, p);
});

test("each exclusion in the fixture: assets, a 404, HEAD, the health check, a bot, a POST, a 304 and non-log lines", () => {
  assert.equal(records.length, fixture.filter((l) => l.startsWith("{")).length, "every JSON line parses, the notices do not");
  const views = records.filter(isView).map((r) => `${r.t} ${r.p}`);
  assert.deepEqual(views, [
    "2026-10-15T09:01 /index.html", "2026-10-15T09:02 /atlas/hpc-scheduler/index.html", "2026-10-15T09:03 /atlas/hpc-scheduler/index.html",
    "2026-10-15T09:04 /atlas/compiler/index.html", "2026-10-16T10:00 /atlas/compiler/index.html", "2026-10-16T10:01 /atlas/compiler/",
  ]);
});

test("per day: views and distinct plates; over the period: the most viewed plates; --since cuts days off", () => {
  const c = count(records);
  assert.deepEqual(c.days, [{ day: "2026-10-15", views: 4, plates: 2 }, { day: "2026-10-16", views: 2, plates: 1 }]);
  assert.deepEqual(c.top, [{ plate: "compiler", views: 3 }, { plate: "hpc-scheduler", views: 2 }]);
  assert.deepEqual(count(records, { since: "2026-10-16" }).days, [{ day: "2026-10-16", views: 2, plates: 1 }]);
  assert.equal(render(c, { csv: true }), "day,views,plates\n2026-10-15,4,2\n2026-10-16,2,1");
});

test("the command line: --file over the fixture prints the table and the CSV", () => {
  const run = (...a) => execFileSync(process.execPath, [path.join(root, "tools/traffic.mjs"), "--file", path.join(root, "tools/fixtures/traffic.log"), ...a], { encoding: "utf8" });
  assert.match(run(), /2026-10-15\s+4 views\s+2 plates[\s\S]*1\. compiler  3/);
  assert.equal(run("--csv").trim(), "day,views,plates\n2026-10-15,4,2\n2026-10-16,2,1");
});

// AB#5009 proved, when it landed, that main and its branch built byte-identical pages. That comparison is not kept:
// any later change that rightly edits the pages (AB#4984's canonical links) would fail it. What must stay true is kept.
test("no page carries a tracker: no cookie, no beacon, no analytics script, on the home page or any plate", () => {
  const pages = ["index.html", ...fs.readdirSync(path.join(root, "atlas")).map((d) => `atlas/${d}/index.html`).filter((f) => fs.existsSync(path.join(root, f)))];
  assert.ok(pages.length >= 201, `${pages.length} pages`);
  for (const f of pages) assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /document\.cookie|navigator\.sendBeacon|gtag\(|google-analytics|googletagmanager|plausible|umami|matomo/i, f);
});

// The container itself: needs Docker. Where it cannot run, this says so rather than passing quietly.
const docker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
test("the built image logs a request with an IP and a user agent without either (needs Docker)", { skip: docker ? false : "Docker is not available here: run `node --test tools/traffic.test.mjs` where it is" }, async () => {
  const tag = `atlas-log-test-${Date.now()}`;
  execFileSync("docker", ["build", "-q", "-t", tag, root], { stdio: "ignore" });
  const id = execFileSync("docker", ["run", "-d", "-p", "127.0.0.1::8080", tag], { encoding: "utf8" }).trim();
  try {
    const port = execFileSync("docker", ["port", id, "8080"], { encoding: "utf8" }).trim().split(":").pop();
    await new Promise((ok) => setTimeout(ok, 1500));
    const res = await fetch(`http://127.0.0.1:${port}/atlas/compiler/?ref=secret-query`, { headers: { "user-agent": "Mozilla/5.0 UniqueAgent123", "x-forwarded-for": "203.0.113.77", referer: "https://example.test/from", cookie: "sid=cookie-value" } });
    assert.ok(res.status === 200 || res.status === 404);
    await new Promise((ok) => setTimeout(ok, 500));
    const logs = execFileSync("docker", ["logs", id], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const line = logs.split("\n").map(parseLine).filter(Boolean).find((r) => r.p.startsWith("/atlas/compiler/"));
    assert.ok(line, `a logged line for the request in:\n${logs}`);
    assert.deepEqual(Object.keys(line).sort(), ["b", "m", "p", "s", "t"]);
    assert.equal(line.b, 0, "a browser is not flagged as a bot");
    await fetch(`http://127.0.0.1:${port}/`, { headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
    await new Promise((ok) => setTimeout(ok, 500));
    const bot = execFileSync("docker", ["logs", id], { encoding: "utf8" }).split("\n").map(parseLine).filter(Boolean).find((r) => r.p === "/index.html" || r.p === "/");
    assert.equal(bot?.b, 1, "a crawler is flagged");
    for (const leak of ["203.0.113.77", "172.17.", "UniqueAgent123", "example.test", "cookie-value", "secret-query"]) assert.ok(!logs.includes(leak), `${leak} is in the log`);
  } finally { spawnSync("docker", ["rm", "-f", id], { stdio: "ignore" }); spawnSync("docker", ["rmi", tag], { stdio: "ignore" }); }
});
