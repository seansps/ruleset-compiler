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
   * Resolve a campaign ID from its invite code.
   * GET /campaigns?inviteCode=...
   */
  async getCampaignByInviteCode(inviteCode) {
    const res = await fetch(
      `${this.baseUrl}/campaigns?inviteCode=${encodeURIComponent(inviteCode)}`,
      { headers: this._headers() }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to look up campaign (${res.status}): ${body}`);
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : data.data || [];
    if (items.length === 0) {
      throw new Error(`No campaign found for invite code: ${inviteCode}`);
    }
    return items[0]._id;
  }

  /**
   * Resolve the API endpoint + request body for a record payload.
   * NPCs route to /npcs and tables to /tables — those endpoints want the
   * payload without `recordType` in the body. Everything else goes to
   * /records with `recordType` in the body.
   */
  _recordEndpoint(payload) {
    if (payload.recordType === "npcs" || payload.recordType === "tables") {
      const { recordType, ...rest } = payload;
      return { path: `/${payload.recordType}`, body: rest };
    }
    return { path: "/records", body: payload };
  }

  /**
   * Find an existing record by name within a campaign.
   * Returns the matching record object, or null if none found.
   */
  async findRecord(payload) {
    const { path } = this._recordEndpoint(payload);
    const params = new URLSearchParams({
      campaignId: payload.campaignId,
      name: payload.name,
      $limit: "1",
    });
    if (path === "/records" && payload.recordType) {
      params.set("recordType", payload.recordType);
    }

    const res = await fetch(`${this.baseUrl}${path}?${params}`, {
      headers: this._headers(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to query records (${res.status}): ${text}`);
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : data.data || [];
    return items.find((r) => r.name === payload.name) || null;
  }

  /**
   * Create a new record.
   */
  async createRecord(payload) {
    const { path, body } = this._recordEndpoint(payload);

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

  /**
   * Update an existing record by _id.
   * PATCH /records/:id (or /npcs/:id, /tables/:id).
   *
   * The PATCH body omits lookup / immutable fields — `name`, `campaignId`
   * and `recordType`. The record was already matched by name within its
   * campaign, and those fields cannot change on update.
   */
  async updateRecord(id, payload) {
    const { path } = this._recordEndpoint(payload);
    const { name, campaignId, recordType, ...body } = payload;

    const res = await fetch(`${this.baseUrl}${path}/${id}`, {
      method: "PATCH",
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to update record (${res.status}): ${text}`);
    }

    return res.json();
  }

  /**
   * Find an existing effect by name within a campaign.
   * GET /effects?campaignId=...&name=...
   * Returns the matching effect object, or null if none found.
   */
  async findEffect(campaignId, name) {
    const params = new URLSearchParams({
      campaignId,
      name,
      $limit: "1",
    });

    const res = await fetch(`${this.baseUrl}/effects?${params}`, {
      headers: this._headers(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to query effects (${res.status}): ${text}`);
    }

    const data = await res.json();
    const items = Array.isArray(data) ? data : data.data || [];
    return items.find((e) => e.name === name) || null;
  }

  /**
   * Create a new effect.
   * POST /effects
   */
  async createEffect(payload) {
    const res = await fetch(`${this.baseUrl}/effects`, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create effect (${res.status}): ${text}`);
    }

    return res.json();
  }

  /**
   * Update an existing effect by _id.
   * PATCH /effects/:id
   *
   * The PATCH body omits `name` (the upsert lookup key) and `campaignId`
   * (the effect was already matched within its campaign) so they aren't
   * re-sent on update.
   */
  async updateEffect(id, payload) {
    const { name, campaignId, ...body } = payload;

    const res = await fetch(`${this.baseUrl}/effects/${id}`, {
      method: "PATCH",
      headers: this._headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to update effect (${res.status}): ${text}`);
    }

    return res.json();
  }
}
