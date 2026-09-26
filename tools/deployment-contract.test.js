const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const frontendPackage = JSON.parse(fs.readFileSync(path.join(root, "react-frontend", "package.json"), "utf8"));
const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

test("the frontend TypeScript compiler is installable on Vercel Linux", () => {
  const typescriptLock = lockfile.packages?.["react-frontend/node_modules/typescript"]
    || lockfile.packages?.["node_modules/typescript"];
  assert.ok(typescriptLock?.version, "frontend TypeScript must be present in the root workspace lockfile");

  const major = Number.parseInt(typescriptLock.version.split(".")[0], 10);
  const linuxCompiler = lockfile.packages?.["react-frontend/node_modules/@typescript/typescript-linux-x64"];

  assert.ok(
    major < 7 || linuxCompiler,
    `TypeScript ${typescriptLock.version} requires @typescript/typescript-linux-x64 in the root lockfile`,
  );
  assert.equal(frontendPackage.devDependencies.typescript, typescriptLock.version);
});

test("the Vite bundler has its native Vercel Linux binding", () => {
  const rolldownLock = lockfile.packages?.["react-frontend/node_modules/rolldown"]
    || lockfile.packages?.["node_modules/rolldown"];
  const linuxBinding = lockfile.packages?.["react-frontend/node_modules/@rolldown/binding-linux-x64-gnu"]
    || lockfile.packages?.["node_modules/@rolldown/binding-linux-x64-gnu"];

  assert.ok(rolldownLock?.version, "Rolldown must be present in the root workspace lockfile");
  assert.ok(linuxBinding, "@rolldown/binding-linux-x64-gnu must be present in the root lockfile");
  assert.equal(linuxBinding.version, rolldownLock.version);
});

test("Vercel serves the app with browser security headers", () => {
  const securityRoute = vercelConfig.routes?.find((route) => route.src === "/(.*)" && route.continue === true);
  assert.ok(securityRoute, "Vercel must apply security headers before routing static files");

  const names = new Set(Object.keys(securityRoute.headers || {}).map((name) => name.toLowerCase()));
  for (const name of ["content-security-policy", "permissions-policy", "referrer-policy", "x-content-type-options", "x-frame-options"]) assert.ok(names.has(name), `${name} must be configured in vercel.json`);
});
