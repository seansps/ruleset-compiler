import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkDefaultSkin,
  collectSkins,
  manifestFileRefs,
  uploadSkins,
  uploadSkinWithToken,
} from "../src/skins.js";

let dir;
const manifest = {
  name: "Crimson",
  colorScheme: "light",
  frames: { window: { texture: { src: "frames/paper.png" } } },
};

const writeSkin = async (slug, files) => {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, "skins", slug, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "skins-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("no skins folder means no skins", async () => {
  assert.deepEqual(await collectSkins(dir), []);
});

test("reads a skin, its images and fonts, and skips other files", async () => {
  await writeSkin("crimson", {
    "skin.json": JSON.stringify(manifest),
    "frames/paper.png": "png",
    "fonts/OFL.txt": "license",
    ".DS_Store": "junk",
  });
  const [skin] = await collectSkins(dir);
  assert.equal(skin.slug, "crimson");
  assert.equal(skin.name, "Crimson");
  assert.deepEqual(skin.files, [{ path: "frames/paper.png", data: Buffer.from("png").toString("base64") }]);
});

test("fails the build on a broken skin", async () => {
  await writeSkin("Bad Name", { "skin.json": "{}" });
  await writeSkin("missing", { "skin.json": JSON.stringify(manifest) });
  await assert.rejects(collectSkins(dir), (err) => {
    assert.match(err.message, /Bad Name: folder name/);
    assert.match(err.message, /missing: skin.json points at frames\/paper.png/);
    return true;
  });
});

test("finds every src in a manifest", () => {
  assert.deepEqual(manifestFileRefs({ fonts: [{ src: "a.woff2" }], x: { texture: { src: "b.png" } } }).sort(), [
    "a.woff2",
    "b.png",
  ]);
});

test("warns when settings.skin has no folder", () => {
  const logs = [];
  checkDefaultSkin({ settings: { skin: "nope" } }, [{ slug: "crimson" }], (m) => logs.push(m));
  assert.match(logs[0], /no skins\/nope folder/);
});

test("does not warn when settings.skin is another ruleset's skin", () => {
  const logs = [];
  checkDefaultSkin({ settings: { skin: "66e37156b49c73d33593dbfd:grimoire" } }, [], (m) => logs.push(m));
  assert.equal(logs.length, 0);
});

test("uploads each skin with the deploy token", async () => {
  const realFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ ref: "r:crimson", version: 2 }), { status: 200 });
  };
  try {
    const skin = { slug: "crimson", name: "Crimson", manifest, files: [] };
    await uploadSkins(
      [skin],
      (s) => uploadSkinWithToken({ baseUrl: "http://api/", token: "t", rulesetId: "r1", skin: s }),
      () => {}
    );
    assert.equal(requests[0].url, "http://api/rulesets/r1/skins/crimson");
    assert.equal(requests[0].init.method, "PUT");
    assert.equal(requests[0].init.headers.Authorization, "Bearer t");
    assert.deepEqual(JSON.parse(requests[0].init.body).manifest, manifest);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("surfaces the server's reason when an upload fails", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "bad file" }), { status: 422 });
  try {
    await assert.rejects(
      uploadSkinWithToken({ baseUrl: "http://api", token: "t", rulesetId: "r1", skin: { slug: "x", files: [] } }),
      /Skin x upload failed \(422\): bad file/
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
