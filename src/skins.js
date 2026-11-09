// Ruleset skins: UI skin packages kept in the ruleset repo as
//   skins/<slug>/skin.json      the manifest
//   skins/<slug>/...            textures and fonts it points at
// They are uploaded after the ruleset itself:
//   deploy token  PUT  /rulesets/:id/skins/:slug   { name, manifest, files }
//   login/JWT     POST /ruleset-skins              { rulesetId, slug, name, manifest, files }
// The server checks shape, size and file types; the client fully validates a
// manifest before it applies it.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export const SKIN_SLUG = /^[a-z0-9-]{1,40}$/;
export const SKIN_FILE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "avif", "woff2", "woff", "ttf", "otf"];
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** Every `src` string in a manifest (textures and fonts). */
export function manifestFileRefs(manifest) {
  const found = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "src" && typeof child === "string") found.add(child);
        else visit(child);
      }
    }
  };
  visit(manifest);
  return [...found];
}

/**
 * Read every skin under <rulesetDir>/skins. Throws with every problem found,
 * so a broken skin fails the build before anything is uploaded.
 */
export async function collectSkins(rulesetDir, { verbose = false, log = console.error } = {}) {
  const skinsDir = join(rulesetDir, "skins");
  try {
    if (!(await stat(skinsDir)).isDirectory()) return [];
  } catch {
    return [];
  }

  const skins = [];
  const errors = [];
  for (const entry of await readdir(skinsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const slug = entry.name;
    const dir = join(skinsDir, slug);
    const problem = (msg) => errors.push(`skins/${slug}: ${msg}`);
    if (!SKIN_SLUG.test(slug)) {
      problem("folder name must be 1-40 lowercase letters, digits or dashes");
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(dir, "skin.json"), "utf-8"));
    } catch (err) {
      problem(err.code === "ENOENT" ? "no skin.json" : `skin.json is not valid JSON (${err.message})`);
      continue;
    }
    if (typeof manifest?.name !== "string" || !manifest.name.trim()) problem("skin.json needs a name");
    if (manifest?.colorScheme !== "light" && manifest?.colorScheme !== "dark")
      problem('skin.json colorScheme must be "light" or "dark"');

    const files = [];
    const skipped = [];
    let total = 0;
    for (const full of await walk(dir)) {
      const path = relative(dir, full).split(sep).join("/");
      if (path === "skin.json") continue;
      const ext = path.split(".").pop().toLowerCase();
      if (!SKIN_FILE_EXTENSIONS.includes(ext)) {
        skipped.push(path);
        continue;
      }
      const bytes = await readFile(full);
      if (bytes.length > MAX_FILE_BYTES) problem(`${path} is larger than 4 MB`);
      total += bytes.length;
      files.push({ path, data: bytes.toString("base64") });
    }
    if (total > MAX_TOTAL_BYTES) problem("files total more than 16 MB");
    const uploaded = new Set(files.map((f) => f.path));
    for (const ref of manifestFileRefs(manifest)) {
      if (!uploaded.has(ref)) problem(`skin.json points at ${ref}, which is not in the folder`);
    }

    if (verbose) {
      log(`  Skin ${slug}: ${files.length} files, ${Math.round(total / 1024)} KB`);
      if (skipped.length) log(`    skipped (not an image or font): ${skipped.join(", ")}`);
    }
    skins.push({ slug, name: (manifest?.name || slug).trim(), manifest, files, size: total });
  }

  if (errors.length) throw new Error(`Skins are not valid:\n  ${errors.join("\n  ")}`);
  return skins;
}

/**
 * Warn when settings.skin names a skin the repo does not have. A full ref
 * ("<rulesetId>:<slug>") points at another ruleset's skin and is left alone.
 */
export function checkDefaultSkin(payload, skins, log = console.error) {
  const slug = payload?.settings?.skin;
  if (slug && !slug.includes(":") && !skins.some((s) => s.slug === slug)) {
    log(`Warning: settings.skin is "${slug}", but there is no skins/${slug} folder in this ruleset.`);
  }
}

async function readBody(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

/** Upload one skin with a deploy token. */
export async function uploadSkinWithToken({ baseUrl, token, rulesetId, skin }) {
  const res = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/rulesets/${encodeURIComponent(rulesetId)}/skins/${skin.slug}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: skin.name, manifest: skin.manifest, files: skin.files }),
    }
  );
  const body = await readBody(res);
  if (res.status !== 200) {
    throw new Error(`Skin ${skin.slug} upload failed (${res.status})${body?.message ? `: ${body.message}` : ""}`);
  }
  return body;
}

/** Upload every skin, one at a time, logging each. */
export async function uploadSkins(skins, upload, log = console.error) {
  const results = [];
  for (const skin of skins) {
    log(`Uploading skin ${skin.slug}...`);
    const result = await upload(skin);
    log(`  ${result?.ref || skin.slug} is now version ${result?.version ?? "?"}`);
    results.push(result);
  }
  return results;
}
