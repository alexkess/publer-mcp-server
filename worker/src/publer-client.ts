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
    return this.request("GET", "/me");
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

  async getCharts(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.request("GET", `/analytics/${accountId}/charts${qs ? `?${qs}` : ""}`);
  }

  async getPostInsights(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.request("GET", `/analytics/${accountId}/posts${qs ? `?${qs}` : ""}`);
  }

  async getHashtagAnalysis(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.request("GET", `/analytics/${accountId}/hashtags${qs ? `?${qs}` : ""}`);
  }

  async getBestTimes(accountId: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString();
    return this.request("GET", `/analytics/${accountId}/best_times${qs ? `?${qs}` : ""}`);
  }
}
