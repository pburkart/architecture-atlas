// Rename the product everywhere it appears as the product's name (AB#4984).
//   node tools/rename.mjs "Architecture Atlas" "Schematica"           dry run: lists each file and how many it would change
//   node tools/rename.mjs "Architecture Atlas" "Schematica" --apply   writes them; run node tools/build.mjs after
// Idempotent: a second run finds nothing. Two uses of the old words stay, by the Board's choice of name (AB#4982,
// "Schematica - The Architecture Atlas for Software"): the tagline "The <old> for Software", and the README's one-line
// "formerly" note. Records are left as written: docs/specs (what was decided, and when), and the name lists of this
// tool and of tools/scan-names.mjs. Azure resource names and the repo's kebab-case name are not the product's name.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT = /\.(html|js|mjs|css|md|bicep|ps1|conf|json|txt|xml)$|(^|\/)(LICENSE|Dockerfile)$/;
export const SKIP = [/^docs\/specs\//, /^tools\/rename(\.test)?\.mjs$/, /^tools\/scan-names\.mjs$/, /^tools\/fixtures\//];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Text with `oldName` replaced by `newName`, keeping the tagline and the "formerly" note. */
export function renameText(text, oldName, newName) {
  const keep = new RegExp(`The ${escRe(oldName)} for Software|^.*formerly ${escRe(oldName.toLowerCase().replace(/ /g, "-"))}.*$`, "gmi");
  const kept = [];
  const held = text.replace(keep, (m) => `\u0000${kept.push(m) - 1}\u0000`);
  return held.replaceAll(oldName, newName).replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}

/** The tracked text files the rename may touch. */
export function files(dir = root) {
  return execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8" }).split("\n").filter((f) => f && TEXT.test(f) && !SKIP.some((r) => r.test(f)));
}

export function rename(oldName, newName, { apply = false, dir = root } = {}) {
  const changed = [];
  for (const f of files(dir)) {
    const p = path.join(dir, f), text = fs.readFileSync(p, "utf8");
    const next = renameText(text, oldName, newName);
    if (next === text) continue;
    changed.push({ file: f, n: text.split(oldName).length - next.split(oldName).length });
    if (apply) fs.writeFileSync(p, next);
  }
  return changed;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [oldName, newName] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!oldName || !newName) { console.error('usage: node tools/rename.mjs "<old name>" "<new name>" [--apply]'); process.exit(2); }
  const apply = process.argv.includes("--apply");
  const changed = rename(oldName, newName, { apply });
  for (const c of changed) console.log(`${c.file}: ${c.n}`);
  console.log(`${changed.length} file(s) ${apply ? "changed" : "would change (dry run: add --apply)"}`);
}
