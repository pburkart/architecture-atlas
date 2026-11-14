// node --test tools/rename.test.mjs
// AB#4984: the rename tool keeps the tagline and the "formerly" note, is a dry run unless told, and is idempotent; the
// name scan fails on the old name anywhere else.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renameText, rename, files } from "./rename.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const O = "Architecture Atlas", N = "Schematica";

test("the name changes; the tagline and the formerly note stay; a second pass changes nothing", () => {
  const t = `<title>Compiler · ${O}</title>\n<p>${N} - The ${O} for Software</p>\n(Formerly architecture-atlas, the ${O} repo.)\n# ${O}\n`;
  const once = renameText(t, O, N);
  assert.equal(once, `<title>Compiler · ${N}</title>\n<p>${N} - The ${O} for Software</p>\n(Formerly architecture-atlas, the ${O} repo.)\n# ${N}\n`);
  assert.equal(renameText(once, O, N), once);
});

test("records are left alone: specs and the tools' own name lists", () => {
  const list = files(root);
  assert.ok(list.includes("tools/build.mjs") && list.includes("index.html") && list.includes("README.md"));
  for (const f of ["docs/specs/4984-rename-and-custom-domain.md", "tools/rename.mjs", "tools/scan-names.mjs"]) assert.ok(!list.includes(f), f);
});

test("the repo is renamed: a dry run finds nothing left to change, and writes nothing", () => {
  const before = execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
  assert.deepEqual(rename(O, N), []);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }), before);
});

test("the name scan fails on the old name planted in a page, and passes once it is gone", () => {
  const f = path.join(root, "index.html"), text = fs.readFileSync(f, "utf8");
  const scan = () => spawnSync(process.execPath, [path.join(root, "tools/scan-names.mjs")], { encoding: "utf8" }).stdout;
  try {
    fs.writeFileSync(f, text.replace("</title>", ` · ${O}</title>`));
    assert.match(scan(), /index\.html: old product name/);
  } finally { fs.writeFileSync(f, text); }
  assert.match(scan(), /0 use\(s\) of the old product name/);
});
