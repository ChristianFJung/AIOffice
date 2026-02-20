# Feature: Tags

Add tagging support to todos so users can organize and filter them.

## Data Model Changes

Each todo gains an optional `tags` field — an array of lowercase strings.

```json
{ "id": 1, "title": "Buy groceries", "completed": false, "tags": ["errands", "personal"] }
```

- Todos created without `tags` default to `[]`
- Tags are stored as lowercase, trimmed, and deduplicated
- Max 10 tags per todo
- Each tag: 1-30 characters, alphanumeric and hyphens only (`/^[a-z0-9-]+$/`)

## Endpoint Changes

### `POST /todos`

Accepts optional `tags` array in the request body.

```json
{ "title": "Buy groceries", "tags": ["errands", "Personal"] }
```

Returns the created todo with tags normalized to lowercase.

```json
{ "id": 1, "title": "Buy groceries", "completed": false, "tags": ["errands", "personal"] }
```

Validation:
- Invalid tag format returns `400` with message
- More than 10 tags returns `400`
- Duplicate tags are silently deduplicated (not an error)

### `PATCH /todos/:id`

Accepts optional `tags` array. Replaces the entire tags list (not a merge).

```json
{ "tags": ["urgent", "work"] }
```

Same validation rules as POST.

### `GET /todos`

Add query parameter filtering:

**`tag`** — filter by a single tag. Returns todos that include this tag.

```
GET /todos?tag=errands
```

**`tags`** — filter by multiple tags (comma-separated). Returns todos matching ALL listed tags.

```
GET /todos?tags=errands,personal
```

Both parameters are case-insensitive. Unknown tags return an empty array (not an error).

### `GET /tags`

New endpoint. Returns all tags currently in use, with counts.

```json
[
  { "name": "errands", "count": 3 },
  { "name": "work", "count": 7 },
  { "name": "personal", "count": 2 }
]
```

Sorted alphabetically by name. Only includes tags with `count >= 1`.

### `DELETE /todos/:id`

No changes — deleting a todo naturally removes its tags from the system. The `GET /tags` counts update accordingly.

## Error Responses

All validation errors return `400` with a JSON body:

```json
{ "error": "Tag \"!!!\" is invalid. Tags must be 1-30 characters, alphanumeric and hyphens only." }
```

```json
{ "error": "Too many tags. Maximum is 10 per todo." }
```

## Testing

```bash
# Create with tags
curl -X POST http://localhost:3001/todos \
  -H 'Content-Type: application/json' \
  -d '{"title":"Buy milk","tags":["errands","grocery"]}'

# Filter by tag
curl http://localhost:3001/todos?tag=errands

# Filter by multiple tags
curl http://localhost:3001/todos?tags=errands,personal

# Get all tags
curl http://localhost:3001/tags

# Update tags
curl -X PATCH http://localhost:3001/todos/1 \
  -H 'Content-Type: application/json' \
  -d '{"tags":["urgent"]}'
```
