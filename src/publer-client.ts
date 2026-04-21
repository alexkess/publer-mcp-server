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

  async updatePost(postId: string, body: unknown): Promise<unknown> {
    return this.request("PUT", `/posts/${postId}`, body);
  }

  async deletePost(postId: string): Promise<unknown> {
    return this.request("DELETE", `/posts/${postId}`);
  }

  // ── Media ──
  async listMedia(params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
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

  // ── Analytics ──
  // FIX: Publer API requires /chart_data with chart_ids[] query param, not /charts.
  // We auto-fetch available chart definitions from /analytics/charts then request
  // chart_data for all of them so the tool gives a complete report in one call.
  async getCharts(accountId: string, params: Record<string, string>): Promise<unknown> {
    const chartList = (await this.request("GET", "/analytics/charts")) as Array<{ id: string }>;
    const chartIds = Array.isArray(chartList) ? chartList.map((c) => c.id) : [];
    const qp = new URLSearchParams(params);
    for (const id of chartIds) qp.append("chart_ids[]", id);
    return this.request("GET", `/analytics/${accountId}/chart_data?${qp.toString()}`);
  }

  // FIX: path is /post_insights, not /posts
  async getPostInsights(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.request("GET", `/analytics/${accountId}/post_insights${qs ? `?${qs}` : ""}`);
  }

  // FIX: path is /hashtag_insights, not /hashtags
  async getHashtagAnalysis(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.request("GET", `/analytics/${accountId}/hashtag_insights${qs ? `?${qs}` : ""}`);
  }

  async getBestTimes(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.request("GET", `/analytics/${accountId}/best_times${qs ? `?${qs}` : ""}`);
  }
}
