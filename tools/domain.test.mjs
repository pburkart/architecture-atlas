// node --test tools/domain.test.mjs
// AB#4984 slice 2: the custom domain prepared before the Board names it. The build writes canonical links and the
// sitemap only for a domain (and leaves the pages alone without one); tools/check-host.mjs tells a right deploy from
// a wrong one; the image and nginx carry the redirect from the old address.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkHosts, PLATES } from "./check-host.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("the site is on schematica.ca: canonical links on the home page and the plates, and a sitemap of them all", () => {
  assert.equal(JSON.parse(read("infra/site.json")).domain, "schematica.ca");
  assert.match(read("index.html"), /<link rel="canonical" href="https:\/\/schematica\.ca\/">/);
  assert.match(read("atlas/compiler/index.html"), /<link rel="canonical" href="https:\/\/schematica\.ca\/atlas\/compiler\/">/);
  assert.equal([...read("sitemap.xml").matchAll(/<loc>/g)].length, fs.readdirSync(path.join(root, "atlas")).filter((d) => fs.existsSync(path.join(root, "atlas", d, "index.html"))).length + 1);
  assert.match(read("robots.txt"), /^Sitemap: https:\/\/schematica\.ca\/sitemap\.xml$/m);
});

test("with a domain, every page names its address on it, and the sitemap lists the home page and every plate", () => {
  const work = fs.mkdtempSync(path.join(path.dirname(root), ".atlas-domain-"));
  try {
    for (const d of ["assets", "atlas", "tools", "infra", "index.html", "LICENSE"]) fs.cpSync(path.join(root, d), path.join(work, d), { recursive: true });
    fs.writeFileSync(path.join(work, "infra/site.json"), JSON.stringify({ domain: "schematica.example" }));
    execFileSync(process.execPath, [path.join(work, "tools/build.mjs")], { cwd: work, stdio: "ignore" });
    const plates = fs.readdirSync(path.join(work, "atlas")).filter((d) => fs.existsSync(path.join(work, "atlas", d, "index.html")));
    assert.match(fs.readFileSync(path.join(work, "index.html"), "utf8"), /<link rel="canonical" href="https:\/\/schematica\.example\/">/);
    for (const p of plates) assert.match(fs.readFileSync(path.join(work, "atlas", p, "index.html"), "utf8"), new RegExp(`<link rel="canonical" href="https://schematica\\.example/atlas/${p}/">`), p);
    const locs = [...fs.readFileSync(path.join(work, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(locs.length, plates.length + 1);
    assert.equal(locs[0], "https://schematica.example/");
    assert.match(fs.readFileSync(path.join(work, "robots.txt"), "utf8"), /^Sitemap: https:\/\/schematica\.example\/sitemap\.xml$/m);
    fs.writeFileSync(path.join(work, "infra/site.json"), JSON.stringify({ domain: "not a host" }));
    assert.throws(() => execFileSync(process.execPath, [path.join(work, "tools/build.mjs")], { cwd: work, stdio: "pipe" }));
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
});

test("the image fills SITE_DOMAIN into nginx, and nginx moves the old address only when it is set", () => {
  const df = read("Dockerfile"), conf = read("infra/nginx.conf"), bicep = read("infra/atlas.bicep");
  assert.match(df, /ENV SITE_DOMAIN=""/);
  assert.match(df, /COPY infra\/nginx\.conf \/etc\/nginx\/templates\/default\.conf\.template/);
  assert.match(df, /robots\.txt sitemap\.xml/);
  assert.match(conf, /set \$atlas_home "\$\{SITE_DOMAIN\}";/);
  assert.match(conf, /if \(\$host ~\* \\\.azurecontainerapps\\\.io\$\) \{ set \$atlas_move "\$atlas_home"; \}/);
  assert.match(conf, /return 301 https:\/\/\$atlas_move\$request_uri;/);
  assert.match(bicep, /name: 'SITE_DOMAIN', value: certificateReady \? customDomain : ''/); // Bug AB#5066
  for (const p of PLATES) assert.ok(fs.existsSync(path.join(root, "atlas", p, "index.html")), `check-host's sample plate ${p} exists`);
});

/** A local stand-in for the deployed site: `new` serves the repo, `old` moves to https://<new>, `plain` to https too. */
function serve(handler) { return new Promise((ok) => { const s = http.createServer(handler).listen(0, "127.0.0.1", () => ok(s)); }); }
const fileFor = (url) => { const p = path.join(root, decodeURIComponent(url.split("?")[0])); return fs.existsSync(path.join(p, "index.html")) ? path.join(p, "index.html") : fs.existsSync(p) && fs.statSync(p).isFile() ? p : null; };

test("check-host passes a right deploy and fails a wrong one", async () => {
  const site = await serve((req, res) => { const f = fileFor(req.url); res.writeHead(f ? 200 : 404).end(f ? fs.readFileSync(f) : "not found"); });
  const newHost = `127.0.0.1:${site.address().port}`;
  const old = await serve((req, res) => res.writeHead(301, { location: `https://${newHost}${req.url}` }).end());
  const plain = await serve((req, res) => res.writeHead(308, { location: `https://${newHost}${req.url}` }).end());
  const lazyOld = await serve((req, res) => res.writeHead(301, { location: `https://${newHost}/` }).end()); // drops the path
  try {
    const good = await checkHosts(`127.0.0.1:${old.address().port}`, newHost, { scheme: "http", plainBase: `http://127.0.0.1:${plain.address().port}`, wwwHost: null });
    assert.deepEqual(good.filter((r) => !r.ok), [], JSON.stringify(good.filter((r) => !r.ok)));
    assert.equal(good.length, 1 + 5 + 7 + 1 + 1);
    const bad = await checkHosts(`127.0.0.1:${lazyOld.address().port}`, newHost, { scheme: "http", plainBase: `http://${newHost}`, wwwHost: null });
    assert.equal(bad.filter((r) => !r.ok).length, 6 + 1, "the five plates and the missing path lose their path on the old host, and plain http is not moved");
  } finally { for (const s of [site, old, plain, lazyOld]) s.close(); }
});

// AB#4984: the redirects in the built image itself, with the Board's domain. Needs Docker; says so where it cannot run.
const docker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
test("in the image: the old host and www answer 301 to the same path on schematica.ca, the apex is served, and with no SITE_DOMAIN nothing moves (needs Docker)", { skip: docker ? false : "Docker is not available here" }, async () => {
  const tag = `atlas-domain-test-${Date.now()}`;
  execFileSync("docker", ["build", "-q", "-t", tag, root], { stdio: "ignore" });
  const run = (env) => execFileSync("docker", ["run", "-d", "-p", "127.0.0.1::8080", ...env, tag], { encoding: "utf8" }).trim();
  const ids = [run(["-e", "SITE_DOMAIN=schematica.ca"]), run([])];
  try {
    const port = (id) => execFileSync("docker", ["port", id, "8080"], { encoding: "utf8" }).trim().split("\n")[0].split(":").pop();
    await new Promise((ok) => setTimeout(ok, 2000));
    const ask = (id, host, p) => new Promise((ok, no) => http.get({ host: "127.0.0.1", port: port(id), path: p, headers: { host } }, (r) => { r.resume(); ok({ status: r.statusCode, location: r.headers.location }); }).on("error", no));
    const old = "architecture-atlas.salmonbay-0aeaf94d.canadacentral.azurecontainerapps.io";
    assert.deepEqual(await ask(ids[0], old, "/atlas/compiler/"), { status: 301, location: "https://schematica.ca/atlas/compiler/" });
    assert.deepEqual(await ask(ids[0], "www.schematica.ca", "/atlas/web-server/"), { status: 301, location: "https://schematica.ca/atlas/web-server/" });
    assert.equal((await ask(ids[0], "schematica.ca", "/atlas/compiler/")).status, 200);
    assert.equal((await ask(ids[0], "schematica.ca", "/atlas/no-such-plate/")).status, 404);
    assert.equal((await ask(ids[1], old, "/atlas/compiler/")).status, 200, "no SITE_DOMAIN: the old host is served, not moved");
    assert.equal((await ask(ids[1], "www.", "/")).status, 200);
  } finally { for (const id of ids) spawnSync("docker", ["rm", "-f", id], { stdio: "ignore" }); spawnSync("docker", ["rmi", tag], { stdio: "ignore" }); }
});

// Bug AB#5066: the first -Live deploy (hosts added, bindings Disabled) turned the redirect on, and the old address sent
// every visitor to a name with no certificate. The container's SITE_DOMAIN, which turns nginx's redirects on, must be
// empty until the -CertificateReady deploy binds the hosts. Checked in the compiled template; needs the az CLI's bicep.
const bicep = spawnSync("az", ["bicep", "version"], { stdio: "ignore" }).status === 0;
test("the redirect switches on only in the -CertificateReady deploy: SITE_DOMAIN is empty until the hosts are bound (Bug AB#5066)", { skip: bicep ? false : "no az bicep here" }, () => {
  const arm = JSON.parse(execFileSync("az", ["bicep", "build", "--file", path.join(root, "infra/atlas.bicep"), "--stdout"], { encoding: "utf8" }));
  const app = Object.values(arm.resources).find((r) => r.type === "Microsoft.App/containerApps");
  const env = app.properties.template.containers[0].env.find((e) => e.name === "SITE_DOMAIN");
  assert.equal(env.value, "[if(parameters('certificateReady'), parameters('customDomain'), '')]");
  // and the bindings it waits for: SniEnabled with certificateReady, Disabled without
  const domains = JSON.stringify(arm.variables?.customDomains ?? app.properties.configuration.ingress.customDomains);
  assert.match(domains, /SniEnabled/);
  assert.match(domains, /Disabled/);
});
