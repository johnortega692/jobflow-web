import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Node's test runner executes TypeScript in place. Server code imports the `.js` name Vercel emits. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    const parent = fileURLToPath(context.parentURL);
    const requested = path.resolve(path.dirname(parent), specifier);
    const typescript = `${requested.slice(0, -3)}.ts`;
    const tsx = `${requested.slice(0, -3)}.tsx`;
    const source = existsSync(typescript) ? typescript : existsSync(tsx) ? tsx : null;
    if (source && !existsSync(requested)) {
      return { url: pathToFileURL(source).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
