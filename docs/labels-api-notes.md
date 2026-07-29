# Publer Labels API — Implementation Notes

## Verified behaviour

### Creating / scheduling posts with labels

Publer's schedule and publish endpoints accept a `bulk` wrapper. Based on the documented
`PostDetail` shape and community examples, labels are passed as a string array on each
account object inside `bulk.posts[].accounts[]`:

```json
{
  "bulk": {
    "state": "scheduled",
    "posts": [
      {
        "accounts": [
          { "id": "acc_123", "scheduled_at": "2025-09-01T10:00:00Z", "labels": ["campaign-q3"] }
        ],
        "networks": { ... }
      }
    ]
  }
}
```

### Updating labels on an existing post

`PUT /posts/{id}` wraps update fields inside a top-level `post` object. Publer documents
`post.text` and optional `post.title` for this endpoint. The docs also say labels can be
updated in Publer's database after publishing for some networks, but they do not document
the label request field.

The MCP tries this shape for existing post label updates:

```json
PUT /posts/{id}
{ "post": { "labels": ["campaign-q3", "evergreen"] } }
```

If Publer returns success but the response still has different labels, the client raises
an error instead of reporting a silent success. Live API tests against a disposable draft
confirmed that multiple label update payload shapes return `200` but do not persist labels.
Set draft labels when creating the draft with `publer_create_post`.

### Existing draft relabel workaround

The only practical workaround is recreate-and-delete: fetch the draft, create a replacement
draft with the same user-visible content and desired labels, then delete the original with
`publer_delete_post`. This changes the post ID and may not preserve every internal Publer
field, so tools and agents must get explicit user confirmation before doing it.

### Reading labels

`GET /posts/{id}` returns a `PostDetail` object. The `labels` field is expected to be
either a `string[]` (label IDs or names) or an array of objects `{ id: string; name: string }`.
`publer_list_workspace_labels` handles both shapes when extracting labels from list pages.

### publer_list_workspace_labels behaviour

This tool is best-effort: it scans up to `max_pages` pages of `GET /posts` and extracts
unique labels by ID from the documented `posts` array. It preserves `name` and `color`
when Publer returns label objects. It does not call a dedicated labels index endpoint (none is documented).
If the workspace has more posts than the scan covers, `truncated: true` is returned and
the caller should increase `max_pages` or filter by `state`.
