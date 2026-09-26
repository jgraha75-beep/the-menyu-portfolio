import { execFileSync } from "node:child_process";

const [base, head = "HEAD"] = process.argv.slice(2);
const zeroSha = /^0+$/;
const commitExists = (commit) => {
  if (!commit || zeroSha.test(commit)) return false;

  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const revision = commitExists(base) ? `${base}..${head}` : head;
const output = execFileSync("git", ["log", "--format=%s", revision], { encoding: "utf8" }).trim();
const messages = output ? output.split("\n") : [];
const format = /^(feat|fix|docs|test|refactor|build|ci|chore|perf)(\([a-z0-9-]+\))?!?: [a-z0-9].*$/;
const vagueSubject = /^(?:feat|fix|docs|test|refactor|build|ci|chore|perf)(?:\([a-z0-9-]+\))?!?: (?:changes?|misc|stuff|updates?|wip|work in progress)(?:\b|$)/i;
const failures = [];

for (const message of messages) {
  if (message.startsWith("Merge pull request #")) continue;
  if (!format.test(message)) failures.push(`${message}: use a Conventional Commit subject`);
  if (message.length > 72) failures.push(`${message}: keep the subject at 72 characters or fewer`);
  if (vagueSubject.test(message)) failures.push(`${message}: name the concrete product or code change`);
}

if (failures.length) {
  console.error("Commit message check failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Checked ${messages.length} commit message${messages.length === 1 ? "" : "s"}.`);
