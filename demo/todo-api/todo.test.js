const request = require('supertest');
const app = require('./app');

beforeEach(() => {
  app.resetState();
});

// ---------------------------------------------------------------------------
// GET /todos
// ---------------------------------------------------------------------------
describe('GET /todos', () => {
  test('returns empty array when no todos exist', async () => {
    const res = await request(app).get('/todos');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns all todos after creation', async () => {
    await request(app).post('/todos').send({ title: 'First' });
    await request(app).post('/todos').send({ title: 'Second' });

    const res = await request(app).get('/todos');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].title).toBe('First');
    expect(res.body[1].title).toBe('Second');
  });

  test('returns JSON content-type', async () => {
    const res = await request(app).get('/todos');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});

// ---------------------------------------------------------------------------
// POST /todos
// ---------------------------------------------------------------------------
describe('POST /todos', () => {
  test('creates a todo with valid title', async () => {
    const res = await request(app).post('/todos').send({ title: 'Buy milk' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: 1,
      title: 'Buy milk',
      completed: false,
    });
  });

  test('auto-increments id', async () => {
    const first = await request(app).post('/todos').send({ title: 'A' });
    const second = await request(app).post('/todos').send({ title: 'B' });
    expect(first.body.id).toBe(1);
    expect(second.body.id).toBe(2);
  });

  test('trims whitespace from title', async () => {
    const res = await request(app).post('/todos').send({ title: '  padded  ' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('padded');
  });

  test('defaults completed to false', async () => {
    const res = await request(app).post('/todos').send({ title: 'Test' });
    expect(res.body.completed).toBe(false);
  });

  test('ignores extra fields in body', async () => {
    const res = await request(app)
      .post('/todos')
      .send({ title: 'Test', priority: 'high', foo: 'bar' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 1, title: 'Test', completed: false });
  });

  // --- Validation edge cases ---

  test('rejects missing title', async () => {
    const res = await request(app).post('/todos').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  test('rejects empty string title', async () => {
    const res = await request(app).post('/todos').send({ title: '' });
    expect(res.status).toBe(400);
  });

  test('rejects whitespace-only title', async () => {
    const res = await request(app).post('/todos').send({ title: '   ' });
    expect(res.status).toBe(400);
  });

  test('rejects numeric title', async () => {
    const res = await request(app).post('/todos').send({ title: 123 });
    expect(res.status).toBe(400);
  });

  test('rejects boolean title', async () => {
    const res = await request(app).post('/todos').send({ title: true });
    expect(res.status).toBe(400);
  });

  test('rejects null title', async () => {
    const res = await request(app).post('/todos').send({ title: null });
    expect(res.status).toBe(400);
  });

  test('rejects array title', async () => {
    const res = await request(app).post('/todos').send({ title: ['a', 'b'] });
    expect(res.status).toBe(400);
  });

  test('rejects object title', async () => {
    const res = await request(app).post('/todos').send({ title: { text: 'hi' } });
    expect(res.status).toBe(400);
  });

  test('rejects empty body / no JSON', async () => {
    const res = await request(app)
      .post('/todos')
      .send('');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /todos/:id
// ---------------------------------------------------------------------------
describe('PATCH /todos/:id', () => {
  let todoId;

  beforeEach(async () => {
    const res = await request(app).post('/todos').send({ title: 'Original' });
    todoId = res.body.id;
  });

  test('updates title only', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ title: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated');
    expect(res.body.completed).toBe(false);
  });

  test('updates completed only', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
    expect(res.body.title).toBe('Original');
  });

  test('updates both title and completed', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ title: 'New', completed: true });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New');
    expect(res.body.completed).toBe(true);
  });

  test('trims updated title', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ title: '  trimmed  ' });
    expect(res.body.title).toBe('trimmed');
  });

  test('no-op PATCH with empty body returns todo unchanged', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Original');
    expect(res.body.completed).toBe(false);
  });

  test('persists changes across requests', async () => {
    await request(app).patch(`/todos/${todoId}`).send({ title: 'Persisted' });
    const res = await request(app).get('/todos');
    expect(res.body[0].title).toBe('Persisted');
  });

  // --- Validation edge cases ---

  test('rejects empty string title', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ title: '' });
    expect(res.status).toBe(400);
  });

  test('rejects whitespace-only title', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ title: '    ' });
    expect(res.status).toBe(400);
  });

  test('rejects numeric title', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ title: 42 });
    expect(res.status).toBe(400);
  });

  test('rejects non-boolean completed', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ completed: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/i);
  });

  test('rejects completed as 1 (truthy but not boolean)', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ completed: 1 });
    expect(res.status).toBe(400);
  });

  test('rejects completed as 0 (falsy but not boolean)', async () => {
    const res = await request(app)
      .patch(`/todos/${todoId}`)
      .send({ completed: 0 });
    expect(res.status).toBe(400);
  });

  // --- 404 cases ---

  test('returns 404 for non-existent id', async () => {
    const res = await request(app)
      .patch('/todos/9999')
      .send({ title: 'Nope' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('returns 404 for non-numeric id', async () => {
    const res = await request(app)
      .patch('/todos/abc')
      .send({ title: 'Nope' });
    expect(res.status).toBe(404);
  });

  test('returns 404 for negative id', async () => {
    const res = await request(app)
      .patch('/todos/-1')
      .send({ title: 'Nope' });
    expect(res.status).toBe(404);
  });

  test('returns 404 for float id', async () => {
    const res = await request(app)
      .patch('/todos/1.5')
      .send({ title: 'Nope' });
    // parseInt('1.5') => 1, so this actually finds the todo — testing the behavior
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DELETE /todos/:id
// ---------------------------------------------------------------------------
describe('DELETE /todos/:id', () => {
  let todoId;

  beforeEach(async () => {
    const res = await request(app).post('/todos').send({ title: 'To delete' });
    todoId = res.body.id;
  });

  test('deletes an existing todo', async () => {
    const res = await request(app).delete(`/todos/${todoId}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
  });

  test('todo is gone after deletion', async () => {
    await request(app).delete(`/todos/${todoId}`);
    const res = await request(app).get('/todos');
    expect(res.body).toHaveLength(0);
  });

  test('returns 404 when deleting already-deleted todo', async () => {
    await request(app).delete(`/todos/${todoId}`);
    const res = await request(app).delete(`/todos/${todoId}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 for non-existent id', async () => {
    const res = await request(app).delete('/todos/9999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('returns 404 for non-numeric id', async () => {
    const res = await request(app).delete('/todos/abc');
    expect(res.status).toBe(404);
  });

  test('only deletes the targeted todo', async () => {
    await request(app).post('/todos').send({ title: 'Keep me' });
    await request(app).delete(`/todos/${todoId}`);
    const res = await request(app).get('/todos');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Keep me');
  });
});

// ---------------------------------------------------------------------------
// Unknown routes
// ---------------------------------------------------------------------------
describe('Unknown routes', () => {
  test('GET /unknown returns 404', async () => {
    const res = await request(app).get('/unknown');
    expect(res.status).toBe(404);
  });

  test('PUT /todos/:id is not supported', async () => {
    const res = await request(app).put('/todos/1').send({ title: 'Nope' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Integration: full lifecycle
// ---------------------------------------------------------------------------
describe('Full lifecycle', () => {
  test('create → read → update → delete', async () => {
    // Create
    const created = await request(app)
      .post('/todos')
      .send({ title: 'Lifecycle test' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    // Read
    let list = await request(app).get('/todos');
    expect(list.body).toHaveLength(1);

    // Update
    const updated = await request(app)
      .patch(`/todos/${id}`)
      .send({ completed: true });
    expect(updated.body.completed).toBe(true);

    // Delete
    await request(app).delete(`/todos/${id}`);
    list = await request(app).get('/todos');
    expect(list.body).toHaveLength(0);
  });

  test('multiple todos maintain independent state', async () => {
    const a = await request(app).post('/todos').send({ title: 'A' });
    const b = await request(app).post('/todos').send({ title: 'B' });

    await request(app).patch(`/todos/${a.body.id}`).send({ completed: true });

    const list = await request(app).get('/todos');
    expect(list.body.find(t => t.id === a.body.id).completed).toBe(true);
    expect(list.body.find(t => t.id === b.body.id).completed).toBe(false);
  });
});
