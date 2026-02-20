# Todo API

A simple REST API for managing todos. Built with Express and in-memory storage.

## Spec

Build a REST API with the following endpoints:

### `GET /todos`
Returns all todos as a JSON array.

```json
[
  { "id": 1, "title": "Buy groceries", "completed": false },
  { "id": 2, "title": "Walk the dog", "completed": true }
]
```

### `POST /todos`
Creates a new todo. Accepts JSON body with `title` (required).

```json
{ "title": "Buy groceries" }
```

Returns the created todo with `id` and `completed: false`.

### `PATCH /todos/:id`
Updates a todo. Accepts JSON body with optional `title` and/or `completed`.

```json
{ "completed": true }
```

Returns the updated todo. Returns 404 if not found.

### `DELETE /todos/:id`
Deletes a todo by ID. Returns 204 on success, 404 if not found.

## Requirements

- Express.js server on port 3001
- In-memory storage (no database)
- JSON request/response
- Proper HTTP status codes (200, 201, 204, 400, 404)
- Input validation: `title` must be a non-empty string

## Getting Started

```bash
npm init -y
npm install express
# Create index.js and implement the spec above
node index.js
```

## Testing

Test with curl:
```bash
curl http://localhost:3001/todos
curl -X POST http://localhost:3001/todos -H 'Content-Type: application/json' -d '{"title":"Test"}'
```
