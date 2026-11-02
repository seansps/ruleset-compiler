// Token deploys for CI: push a compiled ruleset with a per-ruleset deploy
// token (REALM_DEPLOY_TOKEN) instead of an account login.
//
// Contract: PUT /rulesets/:id/deploy
//   Authorization: Bearer rvtt_deploy_...
//   X-Deploy-Ref: <git sha, optional, <= 200 chars>
//   200 → { _id, name, deployId, previousDeployId, ignoredFields }
//   errors → { message } with 401 / 403 / 413 / 422 / 429 (Retry-After)
//
// Never print the token.
import { execFile } from "node:child_process";

export const DEPLOY_TOKEN_ENV = "REALM_DEPLOY_TOKEN";
const DEPLOY_TOKEN_PATTERN = /^rvtt_deploy_[A-Za-z0-9_-]{43}$/;
const MAX_REF_LENGTH = 200;

export function isDeployTokenFormat(value) {
  return typeof value === "string" && DEPLOY_TOKEN_PATTERN.test(value);
}

function gitHead(cwd) {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "HEAD"], { cwd }, (err, stdout) => {
      resolve(err ? null : stdout.trim() || null);
    });
  });
}

/**
 * The deploy ref sent as X-Deploy-Ref: --ref, else the CI commit SHA, else the
 * ruleset directory's git HEAD, else none.
 */
export async function resolveDeployRef(
  { ref, directory } = {},
  env = process.env,
  getHead = gitHead
) {
  const value =
    ref ||
    env.CIRCLE_SHA1 ||
    env.GITHUB_SHA ||
    env.CI_COMMIT_SHA ||
    (await getHead(directory)) ||
    null;
  return value ? String(value).slice(0, MAX_REF_LENGTH) : null;
}

/**
 * Turn a non-200 deploy response into a message a CI log can act on.
 */
export function deployErrorMessage(status, message, retryAfter) {
  const detail = message ? `: ${message}` : "";
  switch (status) {
    case 401:
      return `Deploy token rejected (401)${detail}. It may be wrong, revoked, or expired. Generate a new one in the ruleset editor under Deploy.`;
    case 403:
      return `Deploy token does not belong to this ruleset (403)${detail}. Check --id.`;
    case 413:
      return `Ruleset payload is too large (413)${detail}.`;
    case 422:
      return `Ruleset failed validation (422)${detail}.`;
    case 429:
      return `Too many deploys with this token (429)${detail}.${retryAfter ? ` Retry after ${retryAfter} seconds.` : ""}`;
    default:
      return `Deploy failed (${status})${detail}.`;
  }
}

/**
 * PUT the compiled payload to /rulesets/:id/deploy. Throws with a readable
 * message on any non-200 response.
 */
export async function deployRuleset({ baseUrl, token, rulesetId, payload, ref }) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (ref) headers["X-Deploy-Ref"] = ref;

  const res = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/rulesets/${encodeURIComponent(rulesetId)}/deploy`,
    { method: "PUT", headers, body: JSON.stringify(payload) }
  );

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (res.status !== 200) {
    const message = body?.message || (body ? "" : text.slice(0, 500));
    throw new Error(deployErrorMessage(res.status, message, res.headers.get("retry-after")));
  }
  return body;
}

/**
 * The token-deploy path of `rulesets`: non-interactive, needs --id, never logs
 * in, never prompts. Returns the deploy response.
 */
export async function runTokenDeploy(payload, opts, { env = process.env, log = console.error } = {}) {
  const token = env[DEPLOY_TOKEN_ENV];

  if (opts.new) {
    throw new Error(`${DEPLOY_TOKEN_ENV} can only update an existing ruleset. Remove --new.`);
  }
  if (!opts.id) {
    throw new Error(`${DEPLOY_TOKEN_ENV} is set, so --id <rulesetId> is required.`);
  }
  if (opts.email || opts.password || opts.token) {
    throw new Error(
      `${DEPLOY_TOKEN_ENV} is set. Don't also pass --email, --password, or --token.`
    );
  }
  if (!isDeployTokenFormat(token)) {
    throw new Error(
      `${DEPLOY_TOKEN_ENV} does not look like a deploy token (expected rvtt_deploy_...).`
    );
  }

  const ref = await resolveDeployRef({ ref: opts.ref, directory: opts.directory }, env);

  if (opts.dryRun) {
    log(`[dry-run] Would DEPLOY to ruleset ${opts.id} with a deploy token${ref ? ` (ref ${ref})` : ""}`);
    return null;
  }

  log(`Deploying to ruleset ${opts.id}${ref ? ` (ref ${ref})` : ""}...`);
  const result = await deployRuleset({
    baseUrl: opts.url,
    token,
    rulesetId: opts.id,
    payload,
    ref,
  });

  log(`Deployed! ID: ${result._id}`);
  log(`Name: ${result.name}`);
  log(`Deploy ID: ${result.deployId}`);
  if (result.ignoredFields?.length) {
    log(`Warning: the server ignored these fields: ${result.ignoredFields.join(", ")}`);
  }
  return result;
}
