import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const specifierPattern = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

function resolveSpecifier(fromFile: string, spec: string): string | null {
  const target = path.resolve(path.dirname(fromFile), spec);
  const extension = path.extname(spec);
  const stem = extension ? target.slice(0, -extension.length) : target;
  const candidates = [
    `${stem}.ts`,
    `${stem}.tsx`,
    `${stem}.js`,
    `${stem}.mjs`,
    path.join(stem, "index.ts"),
    path.join(stem, "index.tsx"),
    path.join(stem, "index.js"),
  ];
  if (extension && fs.existsSync(target)) candidates.unshift(target);
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function serverImportProblems(): string[] {
  const entries = fs
    .readdirSync(path.join(root, "api"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .map((name) => path.join(root, "api", name));
  const seen = new Set<string>();
  const problems: string[] = [];

  function walk(file: string) {
    const key = path.normalize(file);
    if (seen.has(key)) return;
    seen.add(key);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(specifierPattern)) {
      const spec = match[1];
      if (!spec) continue;
      if (spec.endsWith(".ts") || spec.endsWith(".tsx")) {
        problems.push(`${path.relative(root, file)} imports ${spec}`);
      }
      const next = resolveSpecifier(file, spec);
      if (next && !next.endsWith(".test.ts")) walk(next);
    }
  }

  for (const entry of entries) walk(entry);
  return problems;
}

test("scheduled functions import compiled JavaScript modules", () => {
  assert.deepEqual(serverImportProblems(), []);
});
