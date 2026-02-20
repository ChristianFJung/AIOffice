# Feature: Persistence

Replace in-memory storage with SQLite so data survives server restarts.

## Why

Right now every restart wipes all todos. That's fine for demos but useless for anything real. SQLite gives us a real database with zero infrastructure — just a file on disk.

## Dependencies

- `better-sqlite3` — synchronous SQLite bindings for Node.js. No async complexity, no connection pools. Perfect for a single-server API.

## Schema

```sql
CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todo_tags (
  todo_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (todo_id, tag),
  FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
);
```

Notes:
- SQLite has no native boolean — use `0`/`1` for `completed`, convert to `true`/`false` in API responses
- Timestamps are ISO 8601 strings stored as TEXT (`"2026-02-20T14:30:00Z"`)
- `todo_tags` uses a composite primary key to prevent duplicate tags on the same todo
- `ON DELETE CASCADE` ensures tags are cleaned up when a todo is deleted

## Database File

- Default location: `./data/todos.db`
- Created automatically on first run if it doesn't exist
- Configurable via `DB_PATH` environment variable
- The `data/` directory should be gitignored

## Data Model Changes

Todos gain two new fields:

```json
{
  "id": 1,
  "title": "Buy groceries",
  "completed": false,
  "tags": ["errands", "personal"],
  "created_at": "2026-02-20T14:30:00Z",
  "updated_at": "2026-02-20T15:45:00Z"
}
```

- `created_at` — set once at creation, never changes
- `updated_at` — updated on every PATCH that modifies the todo

## Module Structure

Create a `db.js` module that owns all database access:

```
db.js          — init, queries, and helpers
app.js         — routes (calls db.js instead of manipulating arrays)
index.js       — server entry point (unchanged)
```

### `db.js` Exports

```js
init()                        // Create tables, enable WAL mode, enable foreign keys
getAllTodos({ tag, tags })     // SELECT with optional tag filtering
getTodoById(id)               // Single todo by ID, null if not found
createTodo({ title, tags })   // INSERT + tag rows, returns full todo
updateTodo(id, { title, completed, tags })  // UPDATE + replace tags, returns full todo
deleteTodo(id)                // DELETE, returns true/false
getAllTags()                   // Aggregate tag counts
resetState()                  // Drop and recreate tables (for testing)
close()                       // Close DB connection
```

Each function handles the SQLite ↔ API translation internally (e.g., `0`/`1` to `true`/`false`, joining tags from `todo_tags`).

## Endpoint Changes

No new endpoints. No URL or status code changes. The API contract stays identical — this is a pure backend swap.

### `GET /todos`

Before: `return res.json(todos)`
After: `return res.json(db.getAllTodos(req.query))`

Tag filtering (`?tag=` and `?tags=`) moves from array filtering to SQL WHERE clauses.

### `POST /todos`

Before: push to array, assign `nextId++`
After: `db.createTodo({ title, tags })` — SQLite handles ID generation via AUTOINCREMENT

Response now includes `created_at` and `updated_at`.

### `PATCH /todos/:id`

Before: mutate object in array
After: `db.updateTodo(id, fields)` — also sets `updated_at` to current time

Response now includes updated `updated_at`.

### `DELETE /todos/:id`

Before: splice from array
After: `db.deleteTodo(id)` — cascade deletes associated tags

### `GET /tags`

Before: scan todos array and count
After: `SELECT tag, COUNT(*) FROM todo_tags GROUP BY tag ORDER BY tag`

## Testing

### Test Isolation

Each test run should use a fresh database. Two options:

1. **In-memory database** — pass `":memory:"` as the DB path during tests. Fast, no cleanup needed.
2. **`resetState()`** — drop and recreate tables between tests, same as the current `app.resetState()`.

Recommend option 1 for speed, with `resetState()` kept as a fallback.

### What to Verify

- All existing tests pass with no changes to test code (API contract unchanged)
- Todos persist across `app` reimports (but not across DB resets)
- `created_at` is set on creation and doesn't change on update
- `updated_at` changes on every PATCH
- Timestamps are valid ISO 8601 strings
- Deleting a todo removes its tags from `GET /tags` counts
- `DB_PATH` env var is respected
- Concurrent reads don't block (WAL mode)

## Migration Path

1. Install `better-sqlite3`
2. Create `db.js` with schema init and query functions
3. Refactor `app.js` routes to call `db.js` — remove `let todos = []` and `let nextId`
4. Update `resetState()` to use `db.resetState()`
5. Run existing test suite — everything should still pass
6. Add new tests for timestamps and persistence

## Configuration

```bash
# Default — file in project directory
node index.js

# Custom path
DB_PATH=/var/data/todos.db node index.js

# In-memory (useful for testing or ephemeral instances)
DB_PATH=:memory: node index.js
```

## What This Doesn't Include

- Migrations framework — overkill for two tables. Schema changes can be handled manually for now.
- Connection pooling — `better-sqlite3` is synchronous and single-connection. Not needed until we outgrow SQLite.
- Backup strategy — out of scope. The DB file can be copied while the server is running (WAL mode makes this safe).
