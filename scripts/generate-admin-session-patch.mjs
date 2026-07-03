import fs from "node:fs";
import path from "node:path";

const dir = "supabase/migrations";
const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const funcs = new Map();

for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  const re = /CREATE OR REPLACE FUNCTION public\.(field_tools_admin_[a-z_]+)\s*\(/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1];
    const start = m.index;
    const endMarker = sql.indexOf("$$;", start);
    if (endMarker === -1) continue;
    funcs.set(name, sql.slice(start, endMarker + 4));
  }
}

function splitParams(paramsBlock) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const ch of paramsBlock) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function paramType(part) {
  const withoutDefault = part.replace(/\sDEFAULT[\s\S]*$/i, "").trim();
  const tokens = withoutDefault.split(/\s+/);
  return tokens[tokens.length - 1]?.toLowerCase() ?? null;
}

function patch(body) {
  if (
    !body.includes("PERFORM public.field_tools_require_admin(p_caller_id)") &&
    !body.includes("PERFORM public.field_tools_require_strict_admin(p_caller_id)")
  ) {
    return null;
  }

  const sigMatch = body.match(/FUNCTION public\.[a-z_]+\s*\(([\s\S]*?)\)\s*\nRETURNS/);
  if (!sigMatch) return null;

  const params = splitParams(sigMatch[1]);
  if (params.some((p) => p.startsWith("p_session_token"))) return null;

  const nextParams = [...params];
  if (nextParams[0]?.startsWith("p_caller_id")) {
    nextParams.splice(1, 0, "p_session_token text");
  } else {
    nextParams.unshift("p_session_token text");
  }

  let out = body.replace(
    /FUNCTION public\.[a-z_]+\s*\([\s\S]*?\)\s*\nRETURNS/,
    `FUNCTION public.${body.match(/FUNCTION public\.(field_tools_admin_[a-z_]+)/)?.[1]}(\n  ${nextParams.join(",\n  ")}\n)\nRETURNS`,
  );

  out = out.replace(
    /PERFORM public\.field_tools_require_admin\(p_caller_id\);/g,
    "PERFORM public.field_tools_require_admin(p_caller_id, p_session_token);",
  );
  out = out.replace(
    /PERFORM public\.field_tools_require_strict_admin\(p_caller_id\);/g,
    "PERFORM public.field_tools_require_strict_admin(p_caller_id, p_session_token);",
  );
  return { out, dropTypes: params.map(paramType).filter(Boolean) };
}

const drops = [];
const creates = [];
const grants = [];

function grantTypesFor(name, patched) {
  const sigMatch = patched.out.match(/FUNCTION public\.[a-z_]+\s*\(([\s\S]*?)\)\s*\nRETURNS/);
  if (!sigMatch) return patched.dropTypes;
  return splitParams(sigMatch[1]).map(paramType).filter(Boolean);
}

for (const [name, body] of funcs) {
  const patched = patch(body);
  if (!patched) continue;
  drops.push(`DROP FUNCTION IF EXISTS public.${name}(${patched.dropTypes.join(", ")});`);
  creates.push(patched.out);
  grants.push(
    `GRANT EXECUTE ON FUNCTION public.${name}(${grantTypesFor(name, patched).join(", ")}) TO anon, authenticated;`,
  );
}

const outPath = "supabase/migrations/_gen_admin_session.sql";
fs.writeFileSync(
  outPath,
  `-- Generated admin RPC session-token patches (${creates.length} functions)\n\n${drops.join("\n")}\n\n${creates.join("\n\n")}\n\n${grants.join("\n")}\n`,
);
console.log(`Wrote ${outPath}: ${creates.length} functions`);
