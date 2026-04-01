import { RulesetAPIClient } from "./api-client.js";
import { prompt, promptPassword } from "./prompts.js";

/**
 * Create an authenticated API client from CLI options.
 * Supports --token (direct JWT) or email/password login.
 */
export async function createAuthenticatedClient(opts) {
  const client = new RulesetAPIClient(opts.url);

  if (opts.token) {
    client.setToken(opts.token);
    if (opts.verbose) console.error("Using provided token.");
  } else {
    const email = opts.email || (await prompt("Email: "));
    const password = opts.password || (await promptPassword("Password: "));
    if (opts.verbose) console.error("Logging in...");
    await client.login(email, password);
    console.error("Logged in successfully.");
  }

  return client;
}
