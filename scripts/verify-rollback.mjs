import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const npm = process.env.npm_execpath;
assert.ok(npm, "Run via npm run test:rollback");
const candidate = JSON.parse(await readFile(".qualification/latest-candidate.json", "utf8"));
const oldArchive = resolve(
  process.env.CONTACT_PREVIOUS_ARCHIVE ?? "effortlessmetrics-contact-core-0.1.7.tgz",
);
const root = resolve(".qualification/rollback", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(root, { recursive: true });
await writeFile(
  resolve(root, "package.json"),
  JSON.stringify({ private: true, type: "module" }) + "\n",
);
await writeFile(resolve(root, "index.html"), await readFile("tests/fixtures/client.html"));
const receipts = [];
let previousLock;
for (const [stage, archive] of [
  ["previous", oldArchive],
  ["candidate", candidate.archive],
  ["rollback", oldArchive],
]) {
  execFileSync(
    process.execPath,
    [npm, "install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", archive],
    { cwd: root, stdio: "inherit" },
  );
  const installedLock = await readFile(resolve(root, "package-lock.json"), "utf8");
  if (stage === "previous") previousLock = installedLock;
  if (stage === "rollback")
    assert.equal(installedLock, previousLock, "Rollback restores the exact previous lockfile");
  const installed = JSON.parse(
    await readFile(
      resolve(root, "node_modules/@effortlessmetrics/contact-core/package.json"),
      "utf8",
    ),
  );
  if (stage === "candidate") assert.equal(installed.version, candidate.version);
  const env = {
    ...process.env,
    CONTACT_CONSUMER_ROOT: root,
    CONTACT_PACKED_MODULE: pathToFileURL(
      resolve(root, "node_modules/@effortlessmetrics/contact-core/dist/index.js"),
    ).href,
  };
  execFileSync(process.execPath, ["scripts/contact-tests.mjs"], { env, stdio: "inherit" });
  execFileSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], {
    env,
    stdio: "inherit",
  });
  receipts.push({
    stage,
    version: installed.version,
    archive,
    sha512: createHash("sha512")
      .update(await readFile(archive))
      .digest("hex"),
    endpointCases: 20,
    browserCases: 15,
  });
}
assert.equal(receipts[0].sha512, receipts[2].sha512);
assert.equal(receipts[0].version, receipts[2].version);
assert.notEqual(receipts[0].version, receipts[1].version);
await writeFile(
  resolve(".qualification/rollback-receipt.json"),
  JSON.stringify({ node: process.version, receipts }, null, 2) + "\n",
);
console.log(JSON.stringify({ oldNewOld: true, receipts }));
