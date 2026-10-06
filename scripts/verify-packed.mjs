import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const npm = process.env.npm_execpath;
assert.ok(npm, "Run through npm run test:packed");
const candidateId = new Date().toISOString().replace(/[:.]/g, "-");
const packDestination = resolve(".qualification/candidate", candidateId);
await mkdir(packDestination, { recursive: true });
const packedOutput = execFileSync(
  process.execPath,
  [npm, "pack", "--json", "--pack-destination", packDestination],
  { encoding: "utf8" },
);
// npm lifecycle commands may print build output before the final JSON array.
const packed = JSON.parse(packedOutput.slice(packedOutput.lastIndexOf("\n[") + 1))[0];
for (const name of [
  "LICENSE",
  "NOTICE",
  "README.md",
  "CHANGELOG.md",
  "LICENSE-MIT",
  "LICENSE-APACHE",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/client.js",
  "dist/client.d.ts",
])
  assert.ok(
    packed.files.some((file) => file.path === name),
    name,
  );
const allowedRootFiles = new Set([
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "LICENSE-MIT",
  "LICENSE-APACHE",
  "NOTICE",
]);
for (const file of packed.files) {
  assert.ok(
    allowedRootFiles.has(file.path) || /^(dist|src)\/[a-zA-Z0-9_.-]+$/.test(file.path),
    `Unexpected packed file: ${file.path}`,
  );
  const content = await readFile(file.path, "utf8");
  assert.ok(
    !/Sentinel_[a-f0-9]+|[A-Z]:\\Users\\|\/Users\/|\/home\//.test(content),
    `Private provenance or machine path in ${file.path}`,
  );
}
const root = resolve(".qualification/packed-consumer", candidateId);
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
    resolve(packDestination, packed.filename),
  ],
  { cwd: root, stdio: "inherit" },
);
await writeFile(
  resolve(root, "consumer.mts"),
  `
import { handleContactPost, handleContactOptions, handleContactGet } from '@effortlessmetrics/contact-core';
import type { ContactEnv, KVStore } from '@effortlessmetrics/contact-core';
import { mountContactForm } from '@effortlessmetrics/contact-core/client';
import type { ContactFormOptions, TurnstileClient } from '@effortlessmetrics/contact-core/client';
const env: ContactEnv = {};
const response: Promise<Response> = handleContactPost(new Request('https://example.test'), env);
const optionsResponse: Promise<Response> = handleContactOptions(new Request('https://example.test'), env);
const getResponse: Response = handleContactGet();
function mount(options: ContactFormOptions): () => void { return mountContactForm(options); }
function types(kv: KVStore, provider: TurnstileClient) { return [kv, provider]; }
void [response, optionsResponse, getResponse, mount, types];
`,
);
const exampleBlocks = [
  ...(await readFile("README.md", "utf8")).matchAll(/```ts\r?\n([\s\S]*?)```/g),
];
assert.equal(exampleBlocks.length, 2, "Keep native adapter/client README examples qualified");
await writeFile(
  resolve(root, "readme-examples.mts"),
  exampleBlocks.map((block) => block[1]).join("\n"),
);
for (const resolution of ["NodeNext", "Bundler"]) {
  execFileSync(
    process.execPath,
    [
      resolve("node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--lib",
      "ES2022,DOM",
      "--module",
      resolution === "NodeNext" ? "NodeNext" : "ESNext",
      "--moduleResolution",
      resolution,
      "consumer.mts",
      "readme-examples.mts",
    ],
    { cwd: root, stdio: "inherit" },
  );
}
const module = resolve(root, "node_modules/@effortlessmetrics/contact-core/dist/index.js");
const client = await readFile(
  resolve(root, "node_modules/@effortlessmetrics/contact-core/dist/client.js"),
  "utf8",
);
execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    "import { mountContactForm } from '@effortlessmetrics/contact-core/client'; if (typeof mountContactForm !== 'function') throw Error('Missing client export');",
  ],
  { cwd: root, stdio: "inherit" },
);
assert.ok(
  !/handleContactPost|MAILGUN_API_KEY|RESEND_API_KEY|TURNSTILE_SECRET_KEY/.test(client),
  "Client entry must not carry server machinery",
);
await writeFile(resolve(root, "index.html"), await readFile("tests/fixtures/client.html", "utf8"));
assert.ok(!(await readFile(module, "utf8")).includes("../src/"));
execFileSync(process.execPath, ["scripts/contact-tests.mjs"], {
  stdio: "inherit",
  env: { ...process.env, CONTACT_PACKED_MODULE: pathToFileURL(module).href },
});
execFileSync(process.execPath, ["scripts/message-contract-tests.mjs"], {
  stdio: "inherit",
  env: { ...process.env, CONTACT_PACKED_MODULE: pathToFileURL(module).href },
});
console.log(
  JSON.stringify({
    packedConsumer: true,
    archive: resolve(packDestination, packed.filename),
    integrity: packed.integrity,
    sourceAliases: false,
  }),
);
execFileSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], {
  stdio: "inherit",
  env: { ...process.env, CONTACT_CONSUMER_ROOT: root, CONTACT_EXPECT_MESSAGE_API: "true" },
});

await writeFile(
  resolve(".qualification/latest-candidate.json"),
  JSON.stringify(
    {
      ...packed,
      archive: resolve(packDestination, packed.filename),
      consumerRoot: root,
      node: process.version,
    },
    null,
    2,
  ) + "\n",
);
