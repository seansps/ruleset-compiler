import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { compile } from "../src/compiler.js";

// Write a minimal ruleset directory and return its path.
async function makeRulesetDir(config) {
  const dir = await mkdtemp(join(tmpdir(), "ruleset-compiler-test-"));
  await writeFile(
    join(dir, "ruleset.config.json"),
    JSON.stringify(config),
    "utf-8",
  );
  return dir;
}

const baseConfig = {
  name: "Test Ruleset",
  description: "For tests",
  records: [
    {
      name: "Heritage",
      type: "heritage",
      tabs: [{ name: "Main", layout: "<x></x>" }],
    },
  ],
};

test("compile passes compatibility through verbatim when present", async () => {
  const compatibility = [
    {
      rulesetId: "66e37156b49c73d33593dbfd",
      name: "D&D 5e (2024)",
      typeMap: { species: "heritage", subclass: "archetypes" },
    },
  ];
  const dir = await makeRulesetDir({ ...baseConfig, compatibility });
  try {
    const payload = await compile(dir);
    assert.deepEqual(payload.compatibility, compatibility);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compile omits compatibility when absent from config", async () => {
  const dir = await makeRulesetDir(baseConfig);
  try {
    const payload = await compile(dir);
    assert.equal(payload.compatibility, undefined);
    assert.ok(!("compatibility" in payload));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
