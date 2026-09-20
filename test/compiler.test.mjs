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

test("compile resolves campaignPanel file → layout and onCampaignLoad file ref", async () => {
  const dir = await makeRulesetDir({
    ...baseConfig,
    settings: {
      otherSettings: {
        onCampaignLoad: { file: "scripts/onCampaignLoad.js" },
        campaignPanel: {
          name: "Omen Dice",
          file: "layouts/campaignPanel.html",
          gmOnly: false,
          width: 420,
          height: 500,
        },
      },
    },
  });
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "scripts"), { recursive: true });
    await mkdir(join(dir, "layouts"), { recursive: true });
    await writeFile(
      join(dir, "scripts", "onCampaignLoad.js"),
      "api.setCampaignVariable('omen', 13);",
      "utf-8",
    );
    await writeFile(
      join(dir, "layouts", "campaignPanel.html"),
      "<div>panel</div>",
      "utf-8",
    );
    const payload = await compile(dir);
    assert.equal(
      payload.settings.otherSettings.onCampaignLoad,
      "api.setCampaignVariable('omen', 13);",
    );
    assert.deepEqual(payload.settings.otherSettings.campaignPanel, {
      name: "Omen Dice",
      gmOnly: false,
      width: 420,
      height: 500,
      layout: "<div>panel</div>",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compile resolves campaignPanel layout given as a file ref", async () => {
  const dir = await makeRulesetDir({
    ...baseConfig,
    settings: {
      otherSettings: {
        campaignPanel: {
          layout: { file: "layouts/campaignPanel.html" },
        },
      },
    },
  });
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "layouts"), { recursive: true });
    await writeFile(
      join(dir, "layouts", "campaignPanel.html"),
      "<div>panel</div>",
      "utf-8",
    );
    const payload = await compile(dir);
    assert.equal(
      payload.settings.otherSettings.campaignPanel.layout,
      "<div>panel</div>",
    );
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

test("compile preserves panel definitions and resolves their HTML files", async () => {
  const dir = await makeRulesetDir({
    ...baseConfig,
    records: [
      {
        ...baseConfig.records[0],
        tabs: [
          {
            name: "Main",
            layout:
              '<panel paneltype="attributes_panel" field="attributes"></panel>',
          },
        ],
      },
      {
        name: "Attributes Panel",
        type: "attributes_panel",
        isPanel: true,
        tabs: [{ name: "Main", file: "panels/attributes.html" }],
      },
    ],
  });
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "panels"), { recursive: true });
    await writeFile(
      join(dir, "panels", "attributes.html"),
      '<numberfield field="strength"></numberfield>',
      "utf-8",
    );

    const payload = await compile(dir);
    const panel = payload.records.find((record) => record.type === "attributes_panel");
    assert.equal(panel.isPanel, true);
    assert.equal(panel.hideFromCompendium, true);
    assert.equal(panel.minY, 60);
    assert.equal(
      panel.tabs[0].layout,
      '<numberfield field="strength"></numberfield>',
    );
    assert.equal(
      payload.records[0].tabs[0].layout,
      '<panel paneltype="attributes_panel" field="attributes"></panel>',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
