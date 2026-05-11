const DEFAULT_BASE_URL = "https://utilities.realmvtt.com";

export class RulesetAPIClient {
  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = null;
  }

  /**
   * Set the auth token directly (e.g. from --token flag).
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * Authenticate with email and password.
   * POST /authentication { strategy: "local", email, password }
   */
  async login(email, password) {
    const res = await fetch(`${this.baseUrl}/authentication`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategy: "local", email, password }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Login failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    this.token = data.accessToken;
    return this.token;
  }

  /**
   * Get headers with auth token.
   */
  _headers() {
    const headers = { "Content-Type": "application/json" };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Fetch owned rulesets.
   * GET /owned-rulesets
   */
  async listOwnedRulesets() {
    const res = await fetch(`${this.baseUrl}/owned-rulesets`, {
      headers: this._headers(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to list rulesets (${res.status}): ${body}`);
    }

    return res.json();
  }

  /**
   * Create a new ruleset.
   * POST /rulesets
   */
  async createRuleset(payload) {
    const res = await fetch(`${this.baseUrl}/rulesets`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to create ruleset (${res.status}): ${body}`);
    }

    return res.json();
  }

  /**
   * Update an existing ruleset.
   * PATCH /rulesets/:id
   */
  async updateRuleset(id, payload) {
    const res = await fetch(`${this.baseUrl}/rulesets/${id}`, {
      method: "PATCH",
      headers: this._headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to update ruleset (${res.status}): ${body}`);
    }

    return res.json();
  }

  /**
   * Create a new record. Routes NPCs to /npcs and tables to /tables —
   * those endpoints want the payload without `recordType` in the body.
   * Everything else goes to /records with `recordType` in the body.
   */
  async createRecord(payload) {
    let path = "/records";
    let body = payload;

    if (payload.recordType === "npcs" || payload.recordType === "tables") {
      path = `/${payload.recordType}`;
      const { recordType, ...rest } = payload;
      body = rest;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create record (${res.status}): ${text}`);
    }

    return res.json();
  }
}
