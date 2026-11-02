import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  deployErrorMessage,
  deployRuleset,
  isDeployTokenFormat,
  resolveDeployRef,
  runTokenDeploy,
} from "../src/deploy.js";

const TOKEN = `rvtt_deploy_${"A".repeat(43)}`;
const RULESET_ID = "64b000000000000000000001";
const payload = { name: "Test Ruleset", records: [], published: true };

let realFetch;
let requests;
let nextResponse;

beforeEach(() => {
  realFetch = globalThis.fetch;
  requests = [];
  nextResponse = {
    status: 200,
    body: {
      _id: RULESET_ID,
      name: "Test Ruleset",
      deployId: "d1",
      previousDeployId: null,
      ignoredFields: [],
    },
    headers: {},
  };
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(nextResponse.body), {
      status: nextResponse.status,
      headers: nextResponse.headers,
    });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const env = (extra = {}) => ({ REALM_DEPLOY_TOKEN: TOKEN, ...extra });
const opts = (extra = {}) => ({
  url: "https://utilities.realmvtt.com/",
  id: RULESET_ID,
  ref: "abc123",
  ...extra,
});
const quiet = () => {};

test("isDeployTokenFormat accepts only rvtt_deploy_ + 43 base64url chars", () => {
  assert.equal(isDeployTokenFormat(TOKEN), true);
  assert.equal(isDeployTokenFormat("rvtt_deploy_short"), false);
  assert.equal(isDeployTokenFormat("eyJhbGciOiJIUzI1NiJ9.x.y"), false);
});

test("deployRuleset PUTs the payload to /rulesets/:id/deploy with the token and ref", async () => {
  const result = await deployRuleset({
    baseUrl: "https://utilities.realmvtt.com/",
    token: TOKEN,
    rulesetId: RULESET_ID,
    payload,
    ref: "abc123",
  });
  assert.equal(result.deployId, "d1");
  assert.equal(requests.length, 1);
  const { url, init } = requests[0];
  assert.equal(url, `https://utilities.realmvtt.com/rulesets/${RULESET_ID}/deploy`);
  assert.equal(init.method, "PUT");
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.headers["X-Deploy-Ref"], "abc123");
  assert.deepEqual(JSON.parse(init.body), payload);
});

test("deployRuleset omits X-Deploy-Ref when there is no ref", async () => {
  await deployRuleset({ baseUrl: "http://x", token: TOKEN, rulesetId: RULESET_ID, payload, ref: null });
  assert.equal(requests[0].init.headers["X-Deploy-Ref"], undefined);
});

test("deployRuleset turns error responses into readable messages", async () => {
  const cases = [
    [401, /rejected \(401\).*revoked/],
    [403, /does not belong to this ruleset \(403\)/],
    [413, /too large \(413\)/],
    [422, /failed validation \(422\): bad records/],
  ];
  for (const [status, pattern] of cases) {
    nextResponse = { status, body: { message: "bad records" }, headers: {} };
    await assert.rejects(
      deployRuleset({ baseUrl: "http://x", token: TOKEN, rulesetId: RULESET_ID, payload }),
      pattern
    );
  }
});

test("deployRuleset reports Retry-After on 429", async () => {
  nextResponse = { status: 429, body: { message: "slow down" }, headers: { "Retry-After": "120" } };
  await assert.rejects(
    deployRuleset({ baseUrl: "http://x", token: TOKEN, rulesetId: RULESET_ID, payload }),
    /Retry after 120 seconds/
  );
});

test("errors never include the token", async () => {
  nextResponse = { status: 401, body: { message: "Deploy token is missing or not valid" }, headers: {} };
  await assert.rejects(
    deployRuleset({ baseUrl: "http://x", token: TOKEN, rulesetId: RULESET_ID, payload }),
    (err) => !err.message.includes(TOKEN)
  );
  assert.ok(!deployErrorMessage(500, "boom").includes(TOKEN));
});

test("resolveDeployRef prefers --ref, then CI SHAs, then git HEAD", async () => {
  const head = async () => "headsha";
  assert.equal(await resolveDeployRef({ ref: "flag" }, { CIRCLE_SHA1: "circle" }, head), "flag");
  assert.equal(await resolveDeployRef({}, { CIRCLE_SHA1: "circle", GITHUB_SHA: "gh" }, head), "circle");
  assert.equal(await resolveDeployRef({}, { GITHUB_SHA: "gh" }, head), "gh");
  assert.equal(await resolveDeployRef({}, {}, head), "headsha");
  assert.equal(await resolveDeployRef({}, {}, async () => null), null);
  assert.equal((await resolveDeployRef({ ref: "x".repeat(300) }, {}, head)).length, 200);
});

test("runTokenDeploy deploys and warns about ignored fields", async () => {
  nextResponse.body.ignoredFields = ["published"];
  const lines = [];
  const result = await runTokenDeploy(payload, opts(), { env: env(), log: (l) => lines.push(l) });
  assert.equal(result.deployId, "d1");
  assert.ok(lines.some((l) => l.includes("ignored these fields: published")));
  assert.ok(!lines.join("\n").includes(TOKEN));
});

test("runTokenDeploy requires --id and refuses --new and login flags", async () => {
  await assert.rejects(runTokenDeploy(payload, opts({ id: undefined }), { env: env(), log: quiet }), /--id/);
  await assert.rejects(runTokenDeploy(payload, opts({ new: true }), { env: env(), log: quiet }), /--new/);
  await assert.rejects(runTokenDeploy(payload, opts({ email: "a@b.c" }), { env: env(), log: quiet }), /--email/);
  await assert.rejects(runTokenDeploy(payload, opts({ token: "jwt" }), { env: env(), log: quiet }), /--token/);
  assert.equal(requests.length, 0);
});

test("runTokenDeploy rejects a malformed token without echoing it", async () => {
  await assert.rejects(
    runTokenDeploy(payload, opts(), { env: env({ REALM_DEPLOY_TOKEN: "oops-secret" }), log: quiet }),
    (err) => /does not look like a deploy token/.test(err.message) && !err.message.includes("oops-secret")
  );
  assert.equal(requests.length, 0);
});

test("runTokenDeploy dry run makes no request", async () => {
  const lines = [];
  const result = await runTokenDeploy(payload, opts({ dryRun: true }), { env: env(), log: (l) => lines.push(l) });
  assert.equal(result, null);
  assert.equal(requests.length, 0);
  assert.match(lines[0], /\[dry-run\] Would DEPLOY to ruleset/);
});
