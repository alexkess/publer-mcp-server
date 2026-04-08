/**
 * Publer MCP Worker
 *
 * Cloudflare Worker serving the Publer MCP server over HTTP (Streamable HTTP transport).
 * Endpoint: /mcp
 *
 * Created by Kess Media (https://kess.media)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { PublerClient } from "./publer-client.js";

interface Env {
  PUBLER_API_KEY: string;
  PUBLER_WORKSPACE_ID: string;
}

function createServer(env: Env): McpServer {
  const client = new PublerClient({
    apiKey: env.PUBLER_API_KEY,
    workspaceId: env.PUBLER_WORKSPACE_ID,
  });

  const server = new McpServer({ name: "publer-mcp-server", version: "1.0.0" });

  // ── Get Current User ──
  server.tool("publer_get_me", "Get the current authenticated Publer user profile", {}, async () => {
    try {
      const result = await client.getMe();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  // ── List Workspaces ──
  server.tool("publer_list_workspaces", "List all workspaces in the Publer account", {}, async () => {
    try {
      const result = await client.listWorkspaces();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  });

  // ── List Accounts ──
  server.tool(
    "publer_list_accounts",
    "List all connected social media accounts (Facebook, Instagram, X, LinkedIn, TikTok, YouTube, Bluesky, etc.)",
    {},
    async () => {
      try {
        const result = await client.listAccounts();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── List Posts ──
  server.tool(
    "publer_list_posts",
    "List and filter social media posts. Filter by state, date range, account, post type, or search by content.",
    {
      state: z
        .enum([
          "all", "scheduled", "scheduled_approved", "scheduled_pending",
          "published", "published_posted", "draft", "draft_dated",
          "draft_undated", "failed", "recycling", "recurring",
        ])
        .optional()
        .describe("Post state filter"),
      from: z.string().optional().describe("ISO date: include posts on/after this date"),
      to: z.string().optional().describe("ISO date: include posts on/before this date"),
      page: z.number().optional().describe("Page number (0-based)"),
      query: z.string().optional().describe("Search keyword in post content"),
      postType: z
        .enum(["status", "link", "photo", "gif", "video", "reel", "story", "short", "poll", "document", "carousel", "article"])
        .optional()
        .describe("Filter by post type"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.state) queryParams.state = params.state;
        if (params.from) queryParams.from = params.from;
        if (params.to) queryParams.to = params.to;
        if (params.page !== undefined) queryParams.page = String(params.page);
        if (params.query) queryParams.query = params.query;
        if (params.postType) queryParams.postType = params.postType;
        const result = await client.listPosts(queryParams);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Create Post ──
  server.tool(
    "publer_create_post",
    "Create and schedule a social media post. Supports text, photo, video, link, carousel, and more. Posts are created asynchronously — returns a job_id to poll for status. Media must be pre-uploaded using publer_upload_media_from_url first.",
    {
      account_ids: z.array(z.string()).describe("Array of account IDs to post to"),
      text: z.string().describe("Post caption/text content"),
      state: z
        .enum(["scheduled", "draft", "draft_private", "draft_public"])
        .describe("How to handle the post: schedule it, or save as draft"),
      scheduled_at: z.string().optional().describe("ISO 8601 datetime for scheduled posts (e.g. 2025-06-01T10:00:00+10:00)"),
      type: z
        .enum(["status", "photo", "video", "link", "carousel", "pdf"])
        .optional()
        .default("status")
        .describe("Content type"),
      media_ids: z.array(z.string()).optional().describe("Array of pre-uploaded media IDs"),
      url: z.string().optional().describe("URL for link posts"),
      auto_schedule: z.boolean().optional().describe("Use AI-powered auto-scheduling"),
      auto_schedule_start: z.string().optional().describe("Auto-schedule range start date"),
      auto_schedule_end: z.string().optional().describe("Auto-schedule range end date"),
    },
    async (params) => {
      try {
        const allAccounts = await client.listAccounts() as Array<{ id: string; provider: string }>;
        const providerById = new Map(allAccounts.map((a) => [a.id, a.provider]));

        const networks: Record<string, unknown> = {};
        for (const accountId of params.account_ids) {
          const provider = providerById.get(accountId);
          if (provider && !networks[provider]) {
            const networkContent: Record<string, unknown> = {
              type: params.type || "status",
              text: params.text,
            };
            if (params.media_ids?.length) {
              networkContent.media = params.media_ids.map((id) => ({ id }));
            }
            if (params.url) networkContent.url = params.url;
            networks[provider] = networkContent;
          }
        }

        const accountObjects = params.account_ids.map((accountId) => {
          const acc: Record<string, unknown> = { id: accountId };
          if (params.scheduled_at) acc.scheduled_at = params.scheduled_at;
          return acc;
        });

        const body: Record<string, unknown> = {
          bulk: {
            state: params.state,
            posts: [{ accounts: accountObjects, networks }],
          },
        };

        if (params.auto_schedule) {
          (body.bulk as Record<string, unknown>).auto = true;
          if (params.auto_schedule_start || params.auto_schedule_end) {
            (body.bulk as Record<string, unknown>).range = {
              start_date: params.auto_schedule_start,
              end_date: params.auto_schedule_end,
            };
          }
        }

        const result = await client.schedulePost(body);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Publish Post Immediately ──
  server.tool(
    "publer_publish_post_now",
    "Publish a post immediately across selected accounts. Returns a job_id.",
    {
      account_ids: z.array(z.string()).describe("Array of account IDs to post to"),
      text: z.string().describe("Post caption/text content"),
      type: z
        .enum(["status", "photo", "video", "link", "carousel", "pdf"])
        .optional()
        .default("status")
        .describe("Content type"),
      media_ids: z.array(z.string()).optional().describe("Array of pre-uploaded media IDs"),
      url: z.string().optional().describe("URL for link posts"),
    },
    async (params) => {
      try {
        const allAccounts = await client.listAccounts() as Array<{ id: string; provider: string }>;
        const providerById = new Map(allAccounts.map((a) => [a.id, a.provider]));

        const networks: Record<string, unknown> = {};
        for (const accountId of params.account_ids) {
          const provider = providerById.get(accountId);
          if (provider && !networks[provider]) {
            const networkContent: Record<string, unknown> = {
              type: params.type || "status",
              text: params.text,
            };
            if (params.media_ids?.length) {
              networkContent.media = params.media_ids.map((id) => ({ id }));
            }
            if (params.url) networkContent.url = params.url;
            networks[provider] = networkContent;
          }
        }

        const result = await client.publishPost({
          bulk: {
            state: "scheduled",
            posts: [{ accounts: params.account_ids.map((id) => ({ id })), networks }],
          },
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Update Post ──
  server.tool(
    "publer_update_post",
    "Update an existing post's text, media, or scheduling.",
    {
      post_id: z.string().describe("ID of the post to update"),
      text: z.string().optional().describe("Updated text content"),
      scheduled_at: z.string().optional().describe("Updated schedule time (ISO 8601)"),
      media_ids: z.array(z.string()).optional().describe("Updated media IDs"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.text) body.text = params.text;
        if (params.scheduled_at) body.scheduled_at = params.scheduled_at;
        if (params.media_ids) body.media = params.media_ids.map((id) => ({ id }));
        const result = await client.updatePost(params.post_id, body);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Delete Post ──
  server.tool(
    "publer_delete_post",
    "Delete a post by its ID.",
    { post_id: z.string().describe("ID of the post to delete") },
    async (params) => {
      try {
        const result = await client.deletePost(params.post_id);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Upload Media from URL ──
  server.tool(
    "publer_upload_media_from_url",
    "Upload media to Publer from a URL (e.g. a Dropbox shared link, public image URL). Returns a job_id for async processing. Poll with publer_get_job_status to get the media ID for use in posts.",
    {
      url: z.string().describe("Public URL of the media file to import"),
      name: z.string().describe("Filename for the media"),
      caption: z.string().optional().describe("Caption for the media"),
      in_library: z.boolean().optional().default(true).describe("Save to media library"),
    },
    async (params) => {
      try {
        const result = await client.uploadMediaFromUrl({
          media: [{ url: params.url, name: params.name, caption: params.caption }],
          type: "single",
          in_library: params.in_library,
          direct_upload: true,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── List Media ──
  server.tool(
    "publer_list_media",
    "Browse the Publer media library. Filter by type (photo, video, gif) or search by name.",
    {
      types: z
        .array(z.enum(["photo", "video", "gif"]))
        .default(["photo", "video", "gif"])
        .describe("Media types to include"),
      page: z.number().optional().default(0).describe("Page number (0-based)"),
      search: z.string().optional().describe("Search term for name or caption"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {
          "types[]": params.types.join(","),
          "used[]": "true,false",
          page: String(params.page || 0),
        };
        if (params.search) queryParams.search = params.search;
        const result = await client.listMedia(queryParams);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Get Job Status ──
  server.tool(
    "publer_get_job_status",
    "Poll the status of an async Publer job (post creation, media upload). Returns working, complete, or failed.",
    { job_id: z.string().describe("Job ID from a previous async operation") },
    async (params) => {
      try {
        const result = await client.getJobStatus(params.job_id);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Get Analytics ──
  server.tool(
    "publer_get_analytics",
    "Get analytics charts for a social account (followers, reach, engagement over time).",
    {
      account_id: z.string().describe("Account ID to get analytics for"),
      from: z.string().optional().describe("Start date (ISO)"),
      to: z.string().optional().describe("End date (ISO)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.from) queryParams.from = params.from;
        if (params.to) queryParams.to = params.to;
        const result = await client.getCharts(params.account_id, queryParams);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Get Post Insights ──
  server.tool(
    "publer_get_post_insights",
    "Get per-post performance metrics (reach, engagement, clicks) for a social account.",
    {
      account_id: z.string().describe("Account ID"),
      from: z.string().optional().describe("Start date (ISO)"),
      to: z.string().optional().describe("End date (ISO)"),
      page: z.number().optional().describe("Page number"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.from) queryParams.from = params.from;
        if (params.to) queryParams.to = params.to;
        if (params.page !== undefined) queryParams.page = String(params.page);
        const result = await client.getPostInsights(params.account_id, queryParams);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Get Hashtag Analysis ──
  server.tool(
    "publer_get_hashtag_analysis",
    "Get hashtag performance analysis — which hashtags drive the most engagement.",
    {
      account_id: z.string().describe("Account ID"),
      from: z.string().optional().describe("Start date (ISO)"),
      to: z.string().optional().describe("End date (ISO)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.from) queryParams.from = params.from;
        if (params.to) queryParams.to = params.to;
        const result = await client.getHashtagAnalysis(params.account_id, queryParams);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  // ── Get Best Times ──
  server.tool(
    "publer_get_best_times",
    "Get the best times to post for maximum engagement — returns a day/hour heatmap.",
    {
      account_id: z.string().describe("Account ID"),
      from: z.string().optional().describe("Start date (ISO)"),
      to: z.string().optional().describe("End date (ISO)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.from) queryParams.from = params.from;
        if (params.to) queryParams.to = params.to;
        const result = await client.getBestTimes(params.account_id, queryParams);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: unknown) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/mcp") {
      return new Response("Publer MCP Server — send requests to /mcp", { status: 404 });
    }

    // Stateless: each request gets a fresh server + transport instance
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const server = createServer(env);
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
