// node --test tools/deploy.test.mjs
// AB#4984: infra/deploy.sh, the Linux deploy (the Board's machine has no PowerShell). A bare run is a dry run that
// touches neither Azure nor Docker; -Live with Docker unusable stops before Azure, saying what is wrong; the custom
// domain and its www come from infra/site.json, and -CertificateReady is the second deploy. Stand-in az and docker
// commands record every call, so nothing real runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "infra/deploy.sh");

/** Runs deploy.sh with stand-ins for az and docker; `dockerSays` is what `docker info` prints to stderr (empty: fine). */
function deploy(args, { dockerSays = "" } = {}) {
  const dir = fs.mkdtempSync(path.join(path.dirname(root), ".deploy-test-"));
  try {
    const bin = path.join(dir, "bin"), log = path.join(dir, "calls");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "az"), `#!/bin/sh\necho "az $*" >> ${log}\nexit 1\n`);
    fs.writeFileSync(path.join(bin, "docker"), `#!/bin/sh\necho "docker $*" >> ${log}\n${dockerSays ? `echo "${dockerSays}" >&2\nexit 1` : "exit 0"}\n`);
    fs.chmodSync(path.join(bin, "az"), 0o755); fs.chmodSync(path.join(bin, "docker"), 0o755);
    const r = spawnSync("bash", [script, ...args], { encoding: "utf8", cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
    return { status: r.status, out: r.stdout + r.stderr, calls };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("a bare run is a dry run: it prints the deploy with schematica.ca and its www, and calls neither az nor docker", () => {
  const r = deploy([]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls, []);
  assert.match(r.out, /would run: docker build -t \S+\/architecture-atlas:\w+ /);
  assert.match(r.out, /would run: az acr login/);
  assert.match(r.out, /would ask: az deployment group create .* customDomain=schematica\.ca certificateReady=false domainValidation=HTTP redirectDomain=www\.schematica\.ca/);
  assert.match(r.out, /Dry run: nothing was run\. To deploy for real, add -Live\./);
});

test("-CertificateReady is the second deploy: it binds the certificates (still a dry run without -Live)", () => {
  const r = deploy(["-CertificateReady"]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.calls, []);
  assert.match(r.out, /certificateReady=true/);
});

test("-Live with -DryRun, or an unknown flag, is refused", () => {
  assert.equal(deploy(["-Live", "-DryRun"]).status, 2);
  assert.equal(deploy(["--deploy-everything"]).status, 2);
});

test("-Live with Docker refused stops before Azure and says what is wrong", () => {
  const denied = deploy(["-Live"], { dockerSays: "permission denied while trying to connect to the docker API at unix:///var/run/docker.sock" });
  assert.equal(denied.status, 1);
  assert.match(denied.out, /Docker is running, but .* may not use it[\s\S]*newgrp docker[\s\S]*Nothing was deployed/);
  assert.ok(!denied.calls.some((c) => c.startsWith("az")), denied.calls.join("\n"));
  const down = deploy(["-Live"], { dockerSays: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" });
  assert.equal(down.status, 1);
  assert.match(down.out, /Docker is not running\. Start it/);
  assert.ok(!down.calls.some((c) => c.startsWith("az")));
});

test("the script never builds in the cloud: no `az acr build`, a local docker build and push instead", () => {
  const code = fs.readFileSync(script, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(code, /az acr build/);
  assert.match(code, /run docker build -t "\$image"/);
  assert.match(code, /run docker push "\$image"/);
});
