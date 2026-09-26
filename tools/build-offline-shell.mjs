import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const directory = fileURLToPath(new URL("../react-frontend/dist/", import.meta.url));
const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== "sw.js")
  .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split("\\").join("/")).sort();
const digest = createHash("sha256");
for (const file of files) digest.update(file).update(await readFile(`${directory}${file}`));
const template = await readFile(new URL("../react-frontend/public/sw.js", import.meta.url), "utf8");
const assets = ["/", ...files.filter((file) => file !== "index.html").map((file) => `/${file}`)];
await writeFile(`${directory}sw.js`, template
  .replace(/const CACHE_NAME = .*?;/, `const CACHE_NAME = "the-menyu-shell-${digest.digest("hex").slice(0, 16)}";`)
  .replace(/const APP_SHELL = \[[\s\S]*?\];/, `const APP_SHELL = ${JSON.stringify(assets)};`));
console.log(`Offline shell includes ${assets.length} build files.`);
