/**
 * Publer API Client
 * Wraps the Publer REST API v1 — uses only Web Fetch API (Worker-compatible)
 */

const BASE_URL = "https://app.publer.com/api/v1";

export interface PublerConfig {
  apiKey: string;
  workspaceId: string;
}

export class PublerClient {
  private apiKey: string;
  private workspaceId: string;

  constructor(config: PublerConfig) {
    this.apiKey = config.apiKey;
    this.workspaceId = config.workspaceId;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer-API ${this.apiKey}`,
      "Publer-Workspace-Id": this.workspaceId,
    };
    if (body) headers["Content-Type"] = "application/json";

    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Publer API ${resp.status}: ${text}`);
    }

    return resp.json();
  }

  async getMe(): Promise<unknown> {
    // Publer's router has no /me — the user endpoint lives at /users/me.
    return this.request("GET", "/users/me");
  }

  async listWorkspaces(): Promise<unknown> {
    return this.request("GET", "/workspaces");
  }

  async listAccounts(): Promise<unknown> {
    return this.request("GET", "/accounts");
  }

  async listPosts(params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.request("GET", `/posts${qs ? `?${qs}` : ""}`);
  }

  async schedulePost(body: unknown): Promise<unknown> {
    return this.request("POST", "/posts/schedule", body);
  }

  async publishPost(body: unknown): Promise<unknown> {
    return this.request("POST", "/posts/schedule/publish", body);
  }

  async updatePost(postId: string, body: unknown): Promise<unknown> {
    return this.request("PUT", `/posts/${postId}`, body);
  }

  async deletePost(postId: string): Promise<unknown> {
    return this.request("DELETE", `/posts/${postId}`);
  }

  async listMedia(params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.request("GET", `/media${qs ? `?${qs}` : ""}`);
  }

  async uploadMediaFromUrl(body: {
    media: Array<{ url: string; name: string; caption?: string }>;
    type?: string;
    direct_upload?: boolean;
    in_library?: boolean;
  }): Promise<unknown> {
    return this.request("POST", "/media/from-url", body);
  }

  async getJobStatus(jobId: string): Promise<unknown> {
    return this.request("GET", `/job_status/${jobId}`);
  }

  // Publer's analytics endpoints need a from/to range in YYYY-MM-DD. Without it,
  // post_insights 500s and best_times returns []. Default to the last 90 days and
  // normalize any supplied dates to YYYY-MM-DD.
  private analyticsDates(params: Record<string, string>): Record<string, string> {
    const DAY = 86400000;
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const parse = (s?: string) => {
      if (!s) return null;
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };
    const out: Record<string, string> = { ...params };
    const toD = parse(out.to) ?? new Date();
    const fromD = parse(out.from) ?? new Date(toD.getTime() - 90 * DAY);
    out.from = fmt(fromD);
    out.to = fmt(toD);
    return out;
  }

  // FIX: Publer API requires /chart_data with chart_ids[] query param, not /charts.
  // Auto-fetch available chart definitions from /analytics/charts then request
  // chart_data for all of them so the tool returns a complete report in one call.
  async getCharts(accountId: string, params: Record<string, string>): Promise<unknown> {
    const chartList = (await this.request("GET", "/analytics/charts")) as Array<{ id: string }>;
    const chartIds = Array.isArray(chartList) ? chartList.map((c) => c.id) : [];
    const qp = new URLSearchParams(this.analyticsDates(params));
    for (const id of chartIds) qp.append("chart_ids[]", id);
    return this.request("GET", `/analytics/${accountId}/chart_data?${qp.toString()}`);
  }

  // FIX: path is /post_insights, not /posts. Requires a from/to range.
  async getPostInsights(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(this.analyticsDates(params)).toString();
    return this.request("GET", `/analytics/${accountId}/post_insights?${qs}`);
  }

  // FIX: path is /hashtag_insights, not /hashtags
  async getHashtagAnalysis(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(this.analyticsDates(params)).toString();
    return this.request("GET", `/analytics/${accountId}/hashtag_insights?${qs}`);
  }

  // best_times returns [] without a date range, so default one too.
  async getBestTimes(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(this.analyticsDates(params)).toString();
    return this.request("GET", `/analytics/${accountId}/best_times?${qs}`);
  }
}
