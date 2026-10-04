import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const npm = process.env.npm_execpath;
assert.ok(npm, "Run through npm run test:packed");
const packed = JSON.parse(
  execFileSync(process.execPath, [npm, "pack", "--json"], { encoding: "utf8" }),
)[0];
for (const name of ["LICENSE-MIT", "LICENSE-APACHE", "dist/index.js", "dist/index.d.ts"])
  assert.ok(
    packed.files.some((file) => file.path === name),
    name,
  );
const root = resolve(".qualification/packed-consumer");
await mkdir(root, { recursive: true });
await writeFile(
  resolve(root, "package.json"),
  JSON.stringify({ private: true, type: "module" }) + "\n",
);
execFileSync(
  process.execPath,
  [
    npm,
    "install",
    "--ignore-scripts",
    "--offline",
    "--no-audit",
    "--no-fund",
    resolve(packed.filename),
  ],
  { cwd: root, stdio: "inherit" },
);
const module = resolve(root, "node_modules/@effortlessmetrics/contact-core/dist/index.js");
assert.ok(!(await readFile(module, "utf8")).includes("../src/"));
execFileSync(process.execPath, ["scripts/contact-tests.mjs"], {
  stdio: "inherit",
  env: { ...process.env, CONTACT_PACKED_MODULE: pathToFileURL(module).href },
});
console.log(
  JSON.stringify({
    packedConsumer: true,
    archive: packed.filename,
    integrity: packed.integrity,
    sourceAliases: false,
  }),
);
