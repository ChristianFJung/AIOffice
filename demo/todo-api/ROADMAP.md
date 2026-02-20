# Todo API — Product Roadmap

## Phase 1: Core CRUD ✅ (Complete)

The foundation. A clean REST API that handles the basics.

- [x] `GET /todos` — list all todos
- [x] `POST /todos` — create a todo with title validation
- [x] `PATCH /todos/:id` — update title and completed status
- [x] `DELETE /todos/:id` — remove a todo
- [x] In-memory storage
- [x] Proper HTTP status codes (200, 201, 204, 400, 404)
- [x] Input validation on title

## Phase 2: Tags & Organization (Up Next)

Specced and ready to build. See `SPEC-tags.md` for full details.

- [ ] Add `tags` field to todos (optional, defaults to `[]`)
- [ ] Tag validation: lowercase, alphanumeric + hyphens, 1-30 chars, max 10 per todo
- [ ] Auto-normalize tags (lowercase, trim, deduplicate)
- [ ] `GET /todos?tag=errands` — filter by single tag
- [ ] `GET /todos?tags=errands,personal` — filter by multiple tags (AND logic)
- [ ] `GET /tags` — list all tags with usage counts
- [ ] Tag-aware error responses with clear messages

## Phase 3: Persistence

Move off in-memory storage so data survives restarts.

- [ ] Add SQLite via `better-sqlite3` (zero-config, file-based)
- [ ] Schema: `todos` table + `todo_tags` join table
- [ ] Migrate existing endpoints to use DB queries
- [ ] Add `created_at` and `updated_at` timestamps to todos

## Phase 4: Search & Filtering

Make finding todos actually useful at scale.

- [ ] `GET /todos?completed=true` — filter by completion status
- [ ] `GET /todos?q=groceries` — full-text search on title
- [ ] `GET /todos?sort=created_at&order=desc` — sorting
- [ ] `GET /todos?limit=20&offset=0` — pagination
- [ ] Combine filters: `GET /todos?tag=work&completed=false&sort=created_at`

## Phase 5: Due Dates & Priority

Turn todos into something you can actually plan around.

- [ ] Add `due_date` field (ISO 8601, optional)
- [ ] Add `priority` field (`low`, `medium`, `high`, default `medium`)
- [ ] `GET /todos?overdue=true` — find overdue items
- [ ] `GET /todos?sort=due_date` — sort by deadline
- [ ] `GET /todos?priority=high` — filter by priority

## Phase 6: Bulk Operations

Quality-of-life improvements for power users and frontend clients.

- [ ] `POST /todos/bulk` — create multiple todos in one request
- [ ] `PATCH /todos/bulk` — update multiple todos (e.g., mark all as completed)
- [ ] `DELETE /todos/bulk` — delete multiple by ID list
- [ ] `DELETE /todos?completed=true` — clear all completed todos

---

**Current status:** Phase 1 complete. Phase 2 specced and ready for development.
