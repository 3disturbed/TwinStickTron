// Resolves every ES-module import across server/, shared/, client/js/ and
// test/ (the Space Dwarves pattern): a typo'd import otherwise only
// surfaces as a blank screen in production. Also verifies named imports
// against the target file's exports (regex-level, good enough to catch
// renames).

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIRS = ["server", "shared", "client/js", "test", "tools"];

let errors = 0;
const files = [];
for (const d of DIRS) {
  const dir = path.join(ROOT, d);
  if (!existsSync(dir)) continue;
  for (const f of walk(dir)) if (/\.(js|mjs)$/.test(f)) files.push(f);
}

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const re = /import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?(?:\*\s+as\s+[\w$]+\s*)?from\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const [, defaultImport, named, spec] = m;
    if (spec.startsWith("node:") || (!spec.startsWith(".") && !spec.startsWith("/"))) continue; // builtin/deps
    const target = spec.startsWith("/")
      ? path.join(ROOT, spec.replace(/^\//, "").replace(/^shared\//, "shared/"))
      : path.resolve(path.dirname(file), spec);
    if (!existsSync(target)) {
      fail(file, `import "${spec}" → ${target} does not exist`);
      continue;
    }
    if (named) {
      const targetSrc = readFileSync(target, "utf8");
      for (const rawName of named.split(",")) {
        const name = rawName.split(" as ")[0].trim();
        if (!name) continue;
        const exportRe = new RegExp(
          `export\\s+(?:async\\s+)?(?:const|let|var|function|class)\\s+${escapeRe(name)}\\b|export\\s*\\{[^}]*\\b${escapeRe(name)}\\b`
        );
        if (!exportRe.test(targetSrc)) fail(file, `"${name}" is not exported by ${spec}`);
      }
    }
    if (defaultImport) {
      const targetSrc = readFileSync(target, "utf8");
      if (!/export\s+default/.test(targetSrc)) fail(file, `default import but ${spec} has no default export`);
    }
  }
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
function fail(file, msg) {
  errors++;
  console.error(`✗ ${path.relative(ROOT, file)}: ${msg}`);
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

if (errors) {
  console.error(`check-imports: ${errors} problem(s)`);
  process.exit(1);
}
console.log(`check-imports: ${files.length} files OK`);
