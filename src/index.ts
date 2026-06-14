#!/usr/bin/env node

/**
 * Publer MCP Server
 * 
 * An open-source Model Context Protocol server for the Publer social media
 * management API. Schedule posts, upload media, pull analytics, and manage
 * accounts across 15+ social networks — all from your AI assistant.
 * 
 * Created by Kess Media (https://kess.media)
 * License: MIT
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { basename, extname } from "path";
import { PublerClient } from "./publer-client.js";

// ── Config ──
const API_KEY = process.env.PUBLER_API_KEY;
const WORKSPACE_ID = process.env.PUBLER_WORKSPACE_ID;

if (!API_KEY) {
  console.error("Error: PUBLER_API_KEY environment variable is required");
  console.error("Get your API key from: Publer → Settings → Access & Login → API Keys");
  process.exit(1);
}

if (!WORKSPACE_ID) {
  console.error("Error: PUBLER_WORKSPACE_ID environment variable is required");
  console.error("Get your workspace ID from: Publer → Settings → Workspace");
  process.exit(1);
}

const client = new PublerClient({ apiKey: API_KEY, workspaceId: WORKSPACE_ID });

// ── Server ──
const server = new McpServer({
  name: "publer-mcp-server",
  version: "1.0.0",
});

// ── Helpers ──

/** Shape of the relevant fields from GET /accounts. */
type PublerAccount = {
  id: string;
  provider: string;
  board?: string | number | null;
  default_board?: string | number | null;
  albums?: Array<{ id: string | number; name: string }>;
};

/** Post types whose attached media should be tagged as video rather than image. */
const VIDEO_TYPES = new Set(["video", "reel", "story", "short"]);

function mediaItemType(postType?: string): "video" | "image" {
  return postType && VIDEO_TYPES.has(postType) ? "video" : "image";
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
};

function mimeForFile(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Resolve which Pinterest board (album_id) a post should pin to.
 * Order: explicit board_id → board_name match in the account's albums →
 * the account's configured board / default_board (from publer_list_accounts).
 * Returned as a STRING: Pinterest board ids exceed JS's safe-integer range
 * (2^53), so coercing to a number would silently corrupt them.
 */
function resolvePinterestBoard(
  acct: PublerAccount,
  boardId?: string,
  boardName?: string
): string | undefined {
  if (boardId) return String(boardId);
  if (boardName && acct.albums) {
    const match = acct.albums.find(
      (b) => String(b.name).trim().toLowerCase() === boardName.trim().toLowerCase()
    );
    if (match) return String(match.id);
  }
  if (acct.board != null) return String(acct.board);
  if (acct.default_board != null) return String(acct.default_board);
  return undefined;
}

/** Recursively pull media ids out of a completed upload job payload. */
function extractMediaIds(job: unknown): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const looksLikeMedia = (o: Record<string, unknown>) =>
    o.id != null && ("path" in o || "url" in o || "thumbnail" in o);
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const o = node as Record<string, unknown>;
    if (looksLikeMedia(o)) {
      const id = String(o.id);
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    for (const key of Object.keys(o)) visit(o[key]);
  };
  visit((job as Record<string, unknown>)?.payload ?? job);
  return ids;
}

/** Pull a job id out of an async response. Only an explicit job_id (or job.id) — NOT a bare
 *  `id`, which on a direct media upload is the media id, not a job. */
function extractJobId(resp: unknown): string | undefined {
  const o = resp as Record<string, unknown> | null;
  if (!o) return undefined;
  const job = o.job as Record<string, unknown> | undefined;
  const id = o.job_id ?? job?.id;
  return id != null ? String(id) : undefined;
}

/** Resolve media ids from an upload response. Direct uploads (POST /media) return the media
 *  object(s) directly (id + path); URL uploads (POST /media/from-url) return an async job to poll. */
async function resolveUploadMediaIds(upload: unknown): Promise<{ media_ids: string[]; job?: unknown }> {
  const direct = extractMediaIds(upload);
  if (direct.length) return { media_ids: direct };
  const jobId = extractJobId(upload);
  if (jobId) {
    const job = await client.pollJob(jobId);
    return { media_ids: extractMediaIds(job), job };
  }
  return { media_ids: [] };
}

type BuildPostParams = {
  account_ids: string[];
  text: string;
  type?: string;
  media_ids?: string[];
  url?: string;
  scheduled_at?: string;
  board_id?: string;
  board_name?: string;
  pin_title?: string;
};

/**
 * Build the `posts[]` entry (accounts + networks) for the bulk schedule/publish API.
 * Centralizes the per-platform logic so create + publish behave identically, and adds
 * the Pinterest-specific fields the API requires (board album_id, pin title, default
 * network mirror) that the original generic builder omitted.
 */
function buildPost(
  params: BuildPostParams,
  accounts: PublerAccount[]
): { post: Record<string, unknown>; warnings: string[] } {
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const warnings: string[] = [];

  // Default to a photo post when media is attached (the API drops media on "status" posts).
  const effectiveType = params.type ?? (params.media_ids?.length ? "photo" : "status");
  const mItemType = mediaItemType(effectiveType);

  // networks: one entry per provider, content shared across same-provider accounts.
  const networks: Record<string, Record<string, unknown>> = {};
  for (const accountId of params.account_ids) {
    const acct = acctById.get(accountId);
    if (!acct) {
      warnings.push(`account ${accountId} is not connected to this workspace — skipped`);
      continue;
    }
    if (!networks[acct.provider]) {
      const nc: Record<string, unknown> = { type: effectiveType, text: params.text };
      if (params.media_ids?.length) {
        nc.media = params.media_ids.map((id) => ({ id, type: mItemType }));
      }
      if (params.url) nc.url = params.url;
      networks[acct.provider] = nc;
    }
  }

  if (Object.keys(networks).length === 0) {
    throw new Error(
      `No valid accounts to post to — none of the provided account_ids matched a connected account. ${warnings.join("; ")}`
    );
  }

  const accountObjects = params.account_ids
    .filter((id) => acctById.has(id))
    .map((id) => {
      const acc: Record<string, unknown> = { id };
      if (params.scheduled_at) acc.scheduled_at = params.scheduled_at;
      return acc;
    });

  // ── Pinterest-specific handling ──
  if (networks.pinterest) {
    const pin = networks.pinterest;
    if (!pin.type || pin.type === "status") pin.type = "photo";
    if (params.pin_title) pin.title = params.pin_title;
    // Publer's bulk API expects a "default" network alongside pinterest.
    networks.default = { type: pin.type, text: params.text };

    for (const acc of accountObjects) {
      const acct = acctById.get(acc.id as string);
      if (acct?.provider === "pinterest") {
        const board = resolvePinterestBoard(acct, params.board_id, params.board_name);
        if (!board) {
          throw new Error(
            `Pinterest account ${acct.id} has no board to pin to. Pass board_id or board_name ` +
              `(see the "albums" list in publer_list_accounts).`
          );
        }
        acc.album_id = board; // string — board ids exceed JS safe-integer range
      }
    }
  }

  return { post: { accounts: accountObjects, networks }, warnings };
}

/** Convert a fetched post object (GET /posts/{id}) into params for buildPost, so it can be recreated. */
function postToSpec(post: Record<string, unknown>): BuildPostParams {
  const media = Array.isArray(post.media) ? (post.media as Array<{ id: unknown }>) : [];
  return {
    account_ids: post.account_id ? [String(post.account_id)] : [],
    text: typeof post.text === "string" ? post.text : "",
    type: typeof post.type === "string" ? post.type : undefined,
    media_ids: media.length ? media.map((m) => String(m.id)) : undefined,
    url: typeof post.url === "string" ? post.url : undefined,
    board_id: post.album_id != null ? String(post.album_id) : undefined,
    pin_title: typeof post.title === "string" ? post.title : undefined,
  };
}

/** True if a polled job ended in failure (terminal error status, or a non-empty failures map). */
function jobFailed(job: Record<string, unknown> | null): boolean {
  if (!job) return false;
  const status = String(job.status ?? "").toLowerCase();
  if (status.includes("fail") || status.includes("error")) return true;
  const payload = job.payload as Record<string, unknown> | undefined;
  const failures = payload?.failures as Record<string, unknown> | undefined;
  return !!failures && typeof failures === "object" && Object.keys(failures).length > 0;
}

function jobIdOf(resp: unknown): string | undefined {
  const o = resp as Record<string, unknown> | null;
  if (!o) return undefined;
  const job = o.job as Record<string, unknown> | undefined;
  const id = o.job_id ?? job?.id;
  return id != null ? String(id) : undefined;
}

// ── Tool: Get Current User ──
server.tool("publer_get_me", "Get the current authenticated Publer user profile", {}, async () => {
  try {
    const result = await client.getMe();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e: unknown) {
    return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
  }
});

// ── Tool: List Workspaces ──
server.tool("publer_list_workspaces", "List all workspaces in the Publer account", {}, async () => {
  try {
    const result = await client.listWorkspaces();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e: unknown) {
    return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
  }
});

// ── Tool: List Accounts ──
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

// ── Tool: List Posts ──
server.tool(
  "publer_list_posts",
  "List and filter social media posts. Filter by state (scheduled, published, draft, failed), date range, account, post type (photo, video, carousel, reel, story), or search by content text.",
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
    account_ids: z.array(z.string()).optional().describe("Filter by account IDs"),
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
      // account_ids need special handling for array params
      const result = await client.listPosts(queryParams);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// ── Tool: Create Post (Schedule) ──
server.tool(
  "publer_create_post",
  "Create and schedule a social media post. Supports text, photo, video, link, carousel, reel, story, and more. Posts are created asynchronously — returns a job_id to poll for status. Media must be pre-uploaded using upload_media or upload_media_from_url first.",
  {
    account_ids: z.array(z.string()).describe("Array of account IDs to post to"),
    text: z.string().describe("Post caption/text content"),
    state: z
      .enum(["scheduled", "draft", "draft_private", "draft_public"])
      .describe("How to handle the post: schedule it, or save as draft"),
    scheduled_at: z
      .string()
      .optional()
      .describe("ISO 8601 datetime for scheduled posts (e.g. 2025-06-01T10:00:00+10:00)"),
    type: z
      .enum(["status", "photo", "video", "link", "carousel", "pdf"])
      .optional()
      .describe("Content type. Defaults to 'photo' when media is attached, otherwise 'status'."),
    media_ids: z
      .array(z.string())
      .optional()
      .describe("Array of pre-uploaded media IDs (from publer_upload_media / publer_upload_media_from_url)"),
    url: z.string().optional().describe("URL for link posts"),
    board_id: z
      .string()
      .optional()
      .describe("Pinterest only: board (album) ID to pin to. Defaults to the account's default board."),
    board_name: z
      .string()
      .optional()
      .describe("Pinterest only: board name to pin to, matched against the account's albums. Alternative to board_id."),
    pin_title: z.string().optional().describe("Pinterest only: title shown on the pin"),
    auto_schedule: z.boolean().optional().describe("Use AI-powered auto-scheduling"),
    auto_schedule_start: z.string().optional().describe("Auto-schedule range start date"),
    auto_schedule_end: z.string().optional().describe("Auto-schedule range end date"),
  },
  async (params) => {
    try {
      const accounts = (await client.listAccounts()) as PublerAccount[];
      const { post, warnings } = buildPost(params, accounts);

      const body: Record<string, unknown> = {
        bulk: {
          state: params.state,
          posts: [post],
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
      const content: Array<{ type: "text"; text: string }> = [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ];
      if (warnings.length) content.push({ type: "text", text: `Warnings: ${warnings.join("; ")}` });
      return { content };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// ── Tool: Publish Post Immediately ──
server.tool(
  "publer_publish_post_now",
  "Publish a post immediately across selected accounts. Returns a job_id.",
  {
    account_ids: z.array(z.string()).describe("Array of account IDs to post to"),
    text: z.string().describe("Post caption/text content"),
    type: z
      .enum(["status", "photo", "video", "link", "carousel", "pdf"])
      .optional()
      .describe("Content type. Defaults to 'photo' when media is attached, otherwise 'status'."),
    media_ids: z.array(z.string()).optional().describe("Array of pre-uploaded media IDs"),
    url: z.string().optional().describe("URL for link posts"),
    board_id: z
      .string()
      .optional()
      .describe("Pinterest only: board (album) ID to pin to. Defaults to the account's default board."),
    board_name: z
      .string()
      .optional()
      .describe("Pinterest only: board name to pin to, matched against the account's albums. Alternative to board_id."),
    pin_title: z.string().optional().describe("Pinterest only: title shown on the pin"),
  },
  async (params) => {
    try {
      const accounts = (await client.listAccounts()) as PublerAccount[];
      const { post, warnings } = buildPost(params, accounts);

      const result = await client.publishPost({ bulk: { state: "scheduled", posts: [post] } });
      const content: Array<{ type: "text"; text: string }> = [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ];
      if (warnings.length) content.push({ type: "text", text: `Warnings: ${warnings.join("; ")}` });
      return { content };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// ── Tool: Create Posts in Bulk ──
server.tool(
  "publer_create_posts",
  "Create or schedule MANY posts in ONE call (native Publer bulk, up to 500). Every post in the batch shares one state (all 'scheduled' or all 'draft'). For scheduled batches, give each post its own scheduled_at. Each entry becomes a separate post.",
  {
    state: z
      .enum(["scheduled", "draft", "draft_private", "draft_public"])
      .describe("State applied to ALL posts in this batch"),
    posts: z
      .array(
        z.object({
          account_ids: z.array(z.string()).describe("Account IDs this post targets"),
          text: z.string().describe("Caption/text content"),
          type: z
            .enum(["status", "photo", "video", "link", "carousel", "pdf"])
            .optional()
            .describe("Defaults to 'photo' when media is attached, otherwise 'status'"),
          media_ids: z.array(z.string()).optional().describe("Pre-uploaded media IDs"),
          url: z.string().optional().describe("URL for link posts"),
          scheduled_at: z
            .string()
            .optional()
            .describe("ISO 8601 with timezone; required per post when state is 'scheduled'"),
          board_id: z.string().optional().describe("Pinterest only: board (album) ID"),
          board_name: z.string().optional().describe("Pinterest only: board name (matched against the account's albums)"),
          pin_title: z.string().optional().describe("Pinterest only: pin title"),
        })
      )
      .min(1)
      .max(500)
      .describe("Posts to create (1–500)"),
  },
  async (params) => {
    try {
      const accounts = (await client.listAccounts()) as PublerAccount[];
      const builtPosts: Record<string, unknown>[] = [];
      const warnings: string[] = [];
      params.posts.forEach((spec, i) => {
        try {
          const { post, warnings: w } = buildPost(spec, accounts);
          builtPosts.push(post);
          w.forEach((x) => warnings.push(`post[${i}]: ${x}`));
        } catch (err) {
          throw new Error(`post[${i}] ("${(spec.text || "").slice(0, 30)}…"): ${(err as Error).message}`);
        }
      });
      const result = await client.schedulePost({ bulk: { state: params.state, posts: builtPosts } });
      const content: Array<{ type: "text"; text: string }> = [
        { type: "text", text: JSON.stringify({ submitted: builtPosts.length, result }, null, 2) },
      ];
      if (warnings.length) content.push({ type: "text", text: `Warnings: ${warnings.join("; ")}` });
      return { content };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// ── Tool: Reschedule Post ──
server.tool(
  "publer_reschedule_post",
  "Reschedule an existing post to a new time. Publer has no native reschedule endpoint, so this recreates the post at the new time and deletes the original — the post gets a NEW id. The original is only deleted after the new one is confirmed.",
  {
    post_id: z.string().describe("ID of the post to reschedule"),
    scheduled_at: z.string().describe("New time, ISO 8601 with timezone (e.g. 2026-07-01T09:00:00-05:00)"),
  },
  async (params) => {
    try {
      const post = (await client.getPost(params.post_id)) as Record<string, unknown>;
      if (!post || !post.account_id) {
        return { content: [{ type: "text", text: `Error: post ${params.post_id} not found or has no account.` }], isError: true };
      }
      const accounts = (await client.listAccounts()) as PublerAccount[];
      const spec = postToSpec(post);
      spec.scheduled_at = params.scheduled_at;
      const { post: newPost, warnings } = buildPost(spec, accounts);

      const result = await client.schedulePost({ bulk: { state: "scheduled", posts: [newPost] } });
      const jobId = jobIdOf(result);
      const job = jobId ? await client.pollJob(jobId) : null;
      if (jobFailed(job)) {
        return {
          content: [{ type: "text", text: `Error: reschedule failed; original post kept. Job: ${JSON.stringify(job).slice(0, 400)}` }],
          isError: true,
        };
      }
      const deleted = await client.deletePost(params.post_id);
      const content: Array<{ type: "text"; text: string }> = [
        { type: "text", text: JSON.stringify({ rescheduled_to: params.scheduled_at, new_post: job ?? result, deleted_original: deleted }, null, 2) },
      ];
      if (warnings.length) content.push({ type: "text", text: `Warnings: ${warnings.join("; ")}` });
      return { content };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// ── Tool: Publish / Schedule an Existing Draft ──
server.tool(
  "publer_publish_draft",
  "Turn an existing DRAFT into a scheduled or published post. Publer can't transition a draft by id, so this recreates it (scheduled at the given time, or published immediately) and deletes the original draft — the post gets a NEW id. WARNING: mode 'publish_now' posts LIVE to the connected accounts immediately. The draft is only deleted after the new post is confirmed.",
  {
    post_id: z.string().describe("ID of the draft to publish or schedule"),
    mode: z
      .enum(["schedule", "publish_now"])
      .describe("'schedule' = future post (requires scheduled_at); 'publish_now' = post immediately (LIVE)"),
    scheduled_at: z.string().optional().describe("Required when mode='schedule'. ISO 8601 with timezone."),
  },
  async (params) => {
    try {
      if (params.mode === "schedule" && !params.scheduled_at) {
        return { content: [{ type: "text", text: "Error: scheduled_at is required when mode='schedule'." }], isError: true };
      }
      const post = (await client.getPost(params.post_id)) as Record<string, unknown>;
      if (!post || !post.account_id) {
        return { content: [{ type: "text", text: `Error: post ${params.post_id} not found or has no account.` }], isError: true };
      }
      const accounts = (await client.listAccounts()) as PublerAccount[];
      const spec = postToSpec(post);
      if (params.mode === "schedule") spec.scheduled_at = params.scheduled_at;
      const { post: newPost, warnings } = buildPost(spec, accounts);

      const result =
        params.mode === "publish_now"
          ? await client.publishPost({ bulk: { state: "scheduled", posts: [newPost] } })
          : await client.schedulePost({ bulk: { state: "scheduled", posts: [newPost] } });
      const jobId = jobIdOf(result);
      const job = jobId ? await client.pollJob(jobId) : null;
      if (jobFailed(job)) {
        return {
          content: [{ type: "text", text: `Error: new post failed; original draft kept. Job: ${JSON.stringify(job).slice(0, 400)}` }],
          isError: true,
        };
      }
      const deleted = await client.deletePost(params.post_id);
      const content: Array<{ type: "text"; text: string }> = [
        { type: "text", text: JSON.stringify({ mode: params.mode, new_post: job ?? result, deleted_draft: deleted }, null, 2) },
      ];
      if (warnings.length) content.push({ type: "text", text: `Warnings: ${warnings.join("; ")}` });
      return { content };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// ── Tool: Update Post ──
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

// ── Tool: Delete Post ──
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

// ── Tool: Upload Local Media File ──
server.tool(
  "publer_upload_media",
  "Upload a LOCAL media file (image or video) from a path on this machine to Publer. By default waits for processing and returns ready-to-use media_ids for publer_create_post. Use this for local files; use publer_upload_media_from_url for public URLs.",
  {
    file_path: z.string().describe("Absolute path to the local image/video file"),
    name: z.string().optional().describe("Filename to store in Publer (defaults to the file's own name)"),
    in_library: z.boolean().optional().default(true).describe("Save to the media library"),
    wait: z
      .boolean()
      .optional()
      .default(true)
      .describe("Wait for processing and return media_ids (recommended). If false, returns the raw job."),
  },
  async (params) => {
    try {
      const buffer = readFileSync(params.file_path);
      const name = params.name || basename(params.file_path);
      const upload = await client.uploadMediaDirect(
        buffer,
        name,
        mimeForFile(params.file_path),
        params.in_library
      );
      if (!params.wait) {
        return { content: [{ type: "text", text: JSON.stringify(upload, null, 2) }] };
      }
      const { media_ids, job } = await resolveUploadMediaIds(upload);
      return { content: [{ type: "text", text: JSON.stringify({ media_ids, details: job ?? upload }, null, 2) }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// ── Tool: Upload Media from URL ──
server.tool(
  "publer_upload_media_from_url",
  "Upload media to Publer from a public URL (e.g. a Dropbox shared link, public image URL). By default waits for processing and returns ready-to-use media_ids for publer_create_post. Set wait=false to return just the job_id.",
  {
    url: z.string().describe("Public URL of the media file to import"),
    name: z.string().describe("Filename for the media"),
    caption: z.string().optional().describe("Caption for the media"),
    in_library: z.boolean().optional().default(true).describe("Save to media library"),
    wait: z
      .boolean()
      .optional()
      .default(true)
      .describe("Wait for processing and return media_ids (recommended). If false, returns the raw job_id."),
  },
  async (params) => {
    try {
      const upload = await client.uploadMediaFromUrl({
        media: [{ url: params.url, name: params.name, caption: params.caption }],
        type: "single",
        in_library: params.in_library,
        direct_upload: true,
      });
      if (!params.wait) {
        return { content: [{ type: "text", text: JSON.stringify(upload, null, 2) }] };
      }
      const { media_ids, job } = await resolveUploadMediaIds(upload);
      return { content: [{ type: "text", text: JSON.stringify({ media_ids, details: job ?? upload }, null, 2) }] };
    } catch (e: unknown) {
      return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
    }
  }
);

// ── Tool: List Media Library ──
server.tool(
  "publer_list_media",
  "Browse the Publer media library. Filter by type (photo, video, gif), usage status, source, or search by name.",
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
      const queryParams: Record<string, string | string[]> = {
        "types[]": params.types,
        "used[]": ["true", "false"],
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

// ── Tool: Get Job Status ──
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

// ── Tool: Get Analytics Charts ──
server.tool(
  "publer_get_analytics",
  "Get analytics charts for a social account (followers, reach, engagement over time).",
  {
    account_id: z.string().describe("Account ID to get analytics for"),
    from: z.string().optional().describe("Start date, YYYY-MM-DD (optional; defaults to 90 days ago)"),
    to: z.string().optional().describe("End date, YYYY-MM-DD (optional; defaults to today)"),
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

// ── Tool: Get Post Insights ──
server.tool(
  "publer_get_post_insights",
  "Get per-post performance metrics (reach, engagement, clicks) for a social account.",
  {
    account_id: z.string().describe("Account ID"),
    from: z.string().optional().describe("Start date, YYYY-MM-DD (optional; defaults to 90 days ago)"),
    to: z.string().optional().describe("End date, YYYY-MM-DD (optional; defaults to today)"),
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

// ── Tool: Get Hashtag Analysis ──
server.tool(
  "publer_get_hashtag_analysis",
  "Get hashtag performance analysis — which hashtags drive the most engagement.",
  {
    account_id: z.string().describe("Account ID"),
    from: z.string().optional().describe("Start date, YYYY-MM-DD (optional; defaults to 90 days ago)"),
    to: z.string().optional().describe("End date, YYYY-MM-DD (optional; defaults to today)"),
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

// ── Tool: Get Best Times to Post ──
server.tool(
  "publer_get_best_times",
  "Get the best times to post for maximum engagement — returns a day/hour heatmap.",
  {
    account_id: z.string().describe("Account ID"),
    from: z.string().optional().describe("Start date, YYYY-MM-DD (optional; defaults to 90 days ago)"),
    to: z.string().optional().describe("End date, YYYY-MM-DD (optional; defaults to today)"),
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

// ── Start ──
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Publer MCP Server running on stdio");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
