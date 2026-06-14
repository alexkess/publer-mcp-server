/**
 * Publer API Client
 * Wraps the Publer REST API v1
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

  private async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<unknown> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer-API ${this.apiKey}`,
      "Publer-Workspace-Id": this.workspaceId,
      ...extraHeaders,
    };

    if (body && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    const resp = await fetch(url, {
      method,
      headers,
      body: body
        ? body instanceof FormData
          ? (body as BodyInit)
          : JSON.stringify(body)
        : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Publer API ${resp.status}: ${text}`);
    }

    return resp.json();
  }

  // ── Users ──
  async getMe(): Promise<unknown> {
    return this.request("GET", "/me");
  }

  // ── Workspaces ──
  async listWorkspaces(): Promise<unknown> {
    return this.request("GET", "/workspaces");
  }

  // ── Accounts ──
  async listAccounts(): Promise<unknown> {
    return this.request("GET", "/accounts");
  }

  // ── Posts ──
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

  async updatePost(postId: string, body: Record<string, unknown>): Promise<unknown> {
    // Publer expects update fields wrapped under a "post" key.
    const payload = "post" in body ? body : { post: body };
    return this.request("PUT", `/posts/${postId}`, payload);
  }

  async deletePost(postId: string | string[]): Promise<unknown> {
    // Publer deletes via DELETE /posts?post_ids[]=... (bulk, query param) and returns
    // { deleted_ids: [...] }. The old /posts/{id} route returned a 404.
    const ids = Array.isArray(postId) ? postId : [postId];
    const qp = new URLSearchParams();
    for (const id of ids) qp.append("post_ids[]", id);
    return this.request("DELETE", `/posts?${qp.toString()}`);
  }

  async getPost(postId: string): Promise<unknown> {
    return this.request("GET", `/posts/${postId}`);
  }

  // ── Media ──
  async listMedia(params: Record<string, string | string[]>): Promise<unknown> {
    // Build repeated array params (types[]=photo&types[]=video&...). Publer ignores
    // comma-joined values, which made list_media always return an empty library.
    const qp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) qp.append(key, item);
      } else {
        qp.append(key, value);
      }
    }
    const qs = qp.toString();
    return this.request("GET", `/media${qs ? `?${qs}` : ""}`);
  }

  async uploadMediaFromUrl(body: {
    media: Array<{ url: string; name: string; caption?: string; source?: string }>;
    type?: string;
    direct_upload?: boolean;
    in_library?: boolean;
  }): Promise<unknown> {
    return this.request("POST", "/media/from-url", body);
  }

  async uploadMediaDirect(
    fileBuffer: Buffer,
    filename: string,
    mimeType: string,
    inLibrary: boolean = false
  ): Promise<unknown> {
    // Use multipart form data via fetch
    const boundary = `----PublerMCP${Date.now()}`;
    const parts: string[] = [];

    // File part
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="file"; filename="${filename}"`);
    parts.push(`Content-Type: ${mimeType}`);
    parts.push("");

    // in_library part
    const epilogue = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="in_library"`,
      "",
      String(inLibrary),
      `--${boundary}--`,
    ].join("\r\n");

    // Build the body manually
    const preamble = parts.join("\r\n") + "\r\n";
    const preambleBuf = Buffer.from(preamble, "utf-8");
    const epilogueBuf = Buffer.from("\r\n" + epilogue, "utf-8");
    const body = Buffer.concat([preambleBuf, fileBuffer, epilogueBuf]);

    const url = `${BASE_URL}/media`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer-API ${this.apiKey}`,
        "Publer-Workspace-Id": this.workspaceId,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Publer API ${resp.status}: ${text}`);
    }

    return resp.json();
  }

  // ── Jobs ──
  async getJobStatus(jobId: string): Promise<unknown> {
    return this.request("GET", `/job_status/${jobId}`);
  }

  /**
   * Poll an async Publer job until it reaches a terminal state.
   * Publer's job_status returns { status: "working" | "complete" | "failed", payload?: ... }.
   * Defaults mirror Publer's own clients (3s interval, up to ~2 minutes).
   */
  async pollJob(
    jobId: string,
    opts: { intervalMs?: number; maxAttempts?: number } = {}
  ): Promise<Record<string, unknown>> {
    const intervalMs = opts.intervalMs ?? 3000;
    const maxAttempts = opts.maxAttempts ?? 40;
    let last: Record<string, unknown> = {};
    for (let i = 0; i < maxAttempts; i++) {
      last = (await this.getJobStatus(jobId)) as Record<string, unknown>;
      const status = String(last?.status ?? "").toLowerCase();
      if (["complete", "completed", "failed", "failure", "error"].includes(status)) {
        return last;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return last;
  }

  // ── Analytics ──
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

  // FIX (upstream PR #1): the charts endpoint is /analytics/{id}/chart_data with a
  // chart_ids[] query param, not /charts. Auto-fetch the available chart definitions
  // from /analytics/charts, then request chart_data for all of them in one call.
  async getCharts(accountId: string, params: Record<string, string>): Promise<unknown> {
    const chartList = (await this.request("GET", "/analytics/charts")) as Array<{ id: string }>;
    const chartIds = Array.isArray(chartList) ? chartList.map((c) => c.id) : [];
    const qp = new URLSearchParams(this.analyticsDates(params));
    for (const id of chartIds) qp.append("chart_ids[]", id);
    return this.request("GET", `/analytics/${accountId}/chart_data?${qp.toString()}`);
  }

  // FIX (upstream PR #1): path is /post_insights, not /posts. Requires a from/to range.
  async getPostInsights(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(this.analyticsDates(params)).toString();
    return this.request("GET", `/analytics/${accountId}/post_insights?${qs}`);
  }

  // FIX (upstream PR #1): path is /hashtag_insights, not /hashtags.
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
