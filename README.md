# Publer MCP Server

An open-source [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the [Publer](https://publer.com) social media management API.

Schedule posts, upload media, pull analytics, and manage accounts across 15+ social networks — all from your AI assistant.

Created by [Kess Media](https://kess.media)

## Features

- **14 tools** covering the full Publer API
- Create, schedule, publish, update, and delete posts
- Upload media via URL (perfect for Dropbox/cloud storage integration)
- Browse and search media library
- Analytics: charts, post insights, hashtag analysis, best times to post
- Multi-account posting across Facebook, Instagram, X, LinkedIn, TikTok, YouTube, Bluesky, and more
- Async job polling for post creation and media uploads

## Requirements

- Node.js 18+
- Publer Business plan (API access is Business-only)
- Publer API key ([Settings → Access & Login → API Keys](https://publer.com/help/en/article/how-to-access-the-publer-api-1w08edo/))

## Quick Start

### Claude Desktop App / Claude Code Desktop (Mac)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "publer": {
      "command": "npx",
      "args": ["-y", "publer-mcp-server"],
      "env": {
        "PUBLER_API_KEY": "your-api-key-here",
        "PUBLER_WORKSPACE_ID": "your-workspace-id-here"
      }
    }
  }
}
```

Restart the app — Publer will appear under **Connectors → Desktop**.

### Claude Code (CLI)

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "publer": {
      "command": "npx",
      "args": ["-y", "publer-mcp-server"],
      "env": {
        "PUBLER_API_KEY": "your-api-key-here",
        "PUBLER_WORKSPACE_ID": "your-workspace-id-here"
      }
    }
  }
}
```

Or via the CLI:

```bash
claude mcp add publer -- npx -y publer-mcp-server \
  --env PUBLER_API_KEY=your-key \
  --env PUBLER_WORKSPACE_ID=your-workspace-id
```

### Cloudflare Worker (Remote — No Local Install)

Deploy as a Cloudflare Worker and connect from any Claude interface without installing anything locally. One deployment, multiple users.

**Deploy:**

```bash
git clone https://github.com/alexkess/publer-mcp-server.git
cd publer-mcp-server/worker
npm install
npx wrangler deploy
npx wrangler secret put PUBLER_API_KEY
npx wrangler secret put PUBLER_WORKSPACE_ID
```

Your server is now live at `https://publer-mcp.<your-subdomain>.workers.dev/mcp`.

**Connect from Claude Code (`~/.claude/mcp.json`):**

```json
{
  "mcpServers": {
    "publer": {
      "type": "http",
      "url": "https://publer-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

**Connect from Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):**

The Desktop app's Connectors UI doesn't support custom HTTP MCP servers directly. Use the Claude Code config above, or add the URL via the custom connector flow in **Settings → Connectors → +**.

**Security note:** The Worker URL acts as your access credential — keep it private. Each user deploys their own Worker with their own Publer API key, so there's no shared access risk.

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "publer": {
      "command": "npx",
      "args": ["-y", "publer-mcp-server"],
      "env": {
        "PUBLER_API_KEY": "your-api-key-here",
        "PUBLER_WORKSPACE_ID": "your-workspace-id-here"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PUBLER_API_KEY` | Yes | Your Publer API key |
| `PUBLER_WORKSPACE_ID` | Yes | Your Publer workspace ID |

### Finding Your Workspace ID

1. Log in to [Publer](https://app.publer.com)
2. Go to Settings → Workspace
3. Copy the workspace ID from the URL or settings page

## Available Tools

### Account Management

| Tool | Description |
|---|---|
| `publer_get_me` | Get current authenticated user profile |
| `publer_list_workspaces` | List all workspaces |
| `publer_list_accounts` | List all connected social accounts |

### Posts

| Tool | Description |
|---|---|
| `publer_list_posts` | List and filter posts by state, date, type, account, or search |
| `publer_create_post` | Create and schedule a post (text, photo, video, carousel, etc.) |
| `publer_publish_post_now` | Publish a post immediately |
| `publer_update_post` | Update an existing post |
| `publer_delete_post` | Delete a post |

### Media

| Tool | Description |
|---|---|
| `publer_upload_media_from_url` | Import media from a URL (Dropbox, cloud storage, etc.) |
| `publer_list_media` | Browse and search the media library |

### Jobs

| Tool | Description |
|---|---|
| `publer_get_job_status` | Poll async job status (post creation, media upload) |

### Analytics

| Tool | Description |
|---|---|
| `publer_get_analytics` | Get analytics charts (followers, reach, engagement) |
| `publer_get_post_insights` | Get per-post performance metrics |
| `publer_get_hashtag_analysis` | Analyse hashtag performance |
| `publer_get_best_times` | Get best times to post heatmap |

## Example Workflows

### Schedule a photo post

```
"Upload this image from my Dropbox to Publer, then schedule it 
to my Alex Kess Bluesky account for Thursday at 10am AEST 
with the caption 'Cronulla from above.'"
```

The AI assistant will:
1. Call `publer_upload_media_from_url` with the Dropbox link
2. Poll `publer_get_job_status` until the upload completes
3. Call `publer_create_post` with the media ID, caption, account ID, and scheduled time

### Check post performance

```
"How did my posts perform last week on Instagram?"
```

The AI assistant will:
1. Call `publer_list_accounts` to find the Instagram account ID
2. Call `publer_get_post_insights` with the date range
3. Present the results

## Development

```bash
git clone https://github.com/alexkess/publer-mcp-server.git
cd publer-mcp-server
npm install
npm run build
```

### Run locally

```bash
PUBLER_API_KEY=your-key PUBLER_WORKSPACE_ID=your-id npm start
```

## Supported Networks

Facebook, Instagram, X (Twitter), LinkedIn, Pinterest, YouTube, TikTok, Google Business Profile, WordPress, Telegram, Mastodon, Threads, Bluesky.

## License

MIT — see [LICENSE](LICENSE)

## Contributing

PRs welcome! This is an open-source project by [Kess Media](https://kess.media).
