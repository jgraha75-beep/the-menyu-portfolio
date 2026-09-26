import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const accessCode = process.env.STAFF_ACCESS_CODE || "review-code";
const sessionSecret = process.env.SESSION_SECRET || "review-session-secret-with-32-characters";
const port = process.env.PORT || "3000";
const children = [];
let shuttingDown = false;

function localNetworkAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

function stop(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((child) => child.kill(signal));
  setTimeout(() => process.exit(exitCode), 2_000).unref();
}

function start(label, command, cwd, env = {}) {
  const child = spawn(npm, command, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });

  child.on("error", (error) => {
    if (!shuttingDown) {
      console.error(`Could not start ${label}: ${error.message}`);
      stop("SIGTERM", 1);
    }
  });

  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`${label} stopped unexpectedly.`);
      stop("SIGTERM", code || 1);
    }
  });

  children.push(child);
}

const phoneAddress = localNetworkAddress();
console.log("\nThe Menyu development servers are starting.");
console.log("Desktop: http://127.0.0.1:4175/");
if (phoneAddress) console.log(`Phone (same Wi-Fi): http://${phoneAddress}:4175/`);
console.log(`Access code: ${accessCode}\n`);

start("backend", ["run", "start"], resolve(root, "backend"), {
  PORT: port,
  STAFF_ACCESS_CODE: accessCode,
  SESSION_SECRET: sessionSecret,
});
start("frontend", ["run", "dev"], resolve(root, "react-frontend"));

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
