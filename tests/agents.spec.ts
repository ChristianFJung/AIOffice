import { test, expect } from "@playwright/test";
import path from "path";

const SERVER = "http://localhost:3003";
const TEST_DIR = path.resolve(process.cwd(), "test-workspace");

// Longer timeouts for CLI startup + AI response
test.setTimeout(120_000);

// ── helpers ──────────────────────────────────────────────────────────

async function cleanupAgents(request: any) {
  const res = await request.get(`${SERVER}/agents`);
  const agents = await res.json();
  for (const agent of agents) {
    await request.delete(`${SERVER}/agents/${agent.agentId}`);
  }
}

async function spawnAgent(
  request: any,
  opts: { name: string; cliType: string; dir?: string }
) {
  const res = await request.post(`${SERVER}/agents/spawn`, {
    data: {
      name: opts.name,
      cliType: opts.cliType,
      workingDirectory: opts.dir ?? path.join(TEST_DIR, opts.name.toLowerCase().replace(/\s/g, "-")),
      personality: "Test agent — keep replies very short.",
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.agentId as string;
}

async function getAgent(request: any, agentId: string) {
  const res = await request.get(`${SERVER}/agents`);
  const agents = await res.json();
  return agents.find((a: any) => a.agentId === agentId);
}

/** Poll until predicate returns true or timeout */
async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 60_000,
  intervalMs = 2_000
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function waitForStatus(
  request: any,
  agentId: string,
  status: string | string[],
  timeoutMs = 60_000
) {
  const statuses = Array.isArray(status) ? status : [status];
  let last = "";
  await waitFor(async () => {
    const agent = await getAgent(request, agentId);
    last = agent?.status ?? "missing";
    return statuses.includes(last);
  }, timeoutMs);
  return last;
}

async function waitForMessages(
  request: any,
  agentId: string,
  minCount: number,
  timeoutMs = 60_000
) {
  let count = 0;
  await waitFor(async () => {
    const agent = await getAgent(request, agentId);
    count = agent?.messages?.length ?? 0;
    return count >= minCount;
  }, timeoutMs);
  return count;
}

async function sendChat(request: any, agentId: string, text: string) {
  const res = await request.post(`${SERVER}/events`, {
    data: {
      type: "agent.message",
      agentId,
      timestamp: new Date().toISOString(),
      payload: { text, channel: "task" },
    },
  });
  expect(res.ok()).toBeTruthy();
}

async function resetAgent(request: any, agentId: string) {
  const res = await request.post(`${SERVER}/agents/${agentId}/control`, {
    data: { command: "reset" },
  });
  expect(res.ok()).toBeTruthy();
}

// ── setup / teardown ─────────────────────────────────────────────────

// Unique dirs per test run to avoid JSONL accumulation
const RUN_ID = Date.now().toString(36);
const CLAUDE_DIR = path.join(TEST_DIR, `claude-${RUN_ID}`);
const COPILOT_DIR = path.join(TEST_DIR, `copilot-${RUN_ID}`);

test.describe("Agent lifecycle", () => {
  test.beforeAll(async ({ request }) => {
    const { mkdirSync } = await import("fs");
    mkdirSync(CLAUDE_DIR, { recursive: true });
    mkdirSync(COPILOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ request }) => {
    await cleanupAgents(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupAgents(request);
  });

  // ── Spawn ────────────────────────────────────────────────────────

  test("spawn claude-code agent", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Claude Test",
      cliType: "claude-code",
      dir: CLAUDE_DIR,
    });
    expect(id).toBeTruthy();

    const agent = await getAgent(request, id);
    expect(agent).toBeTruthy();
    expect(agent.name).toBe("Claude Test");
    expect(agent.cliType).toBe("claude-code");
  });

  test("spawn copilot-cli agent", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Copilot Test",
      cliType: "copilot-cli",
      dir: COPILOT_DIR,
    });
    expect(id).toBeTruthy();

    const agent = await getAgent(request, id);
    expect(agent).toBeTruthy();
    expect(agent.name).toBe("Copilot Test");
    expect(agent.cliType).toBe("copilot-cli");
  });

  test("spawn multiple agents at once", async ({ request }) => {
    const id1 = await spawnAgent(request, {
      name: "Agent A",
      cliType: "claude-code",
      dir: CLAUDE_DIR,
    });
    const id2 = await spawnAgent(request, {
      name: "Agent B",
      cliType: "copilot-cli",
      dir: COPILOT_DIR,
    });

    expect(id1).not.toBe(id2);

    const res = await request.get(`${SERVER}/agents`);
    const agents = await res.json();
    expect(agents.length).toBe(2);
  });

  // ── Auto-intro ───────────────────────────────────────────────────

  test("claude-code agent receives auto-intro and replies", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Claude Intro",
      cliType: "claude-code",
      dir: CLAUDE_DIR,
    });

    // Should get at least 1 message (the assistant reply)
    await waitForMessages(request, id, 1, 90_000);

    const agent = await getAgent(request, id);
    expect(agent.messages.length).toBeGreaterThanOrEqual(1);
    // Should have reached "replied" at some point
    expect(["thinking", "replied", "available"]).toContain(agent.status);
  });

  test("copilot-cli agent receives auto-intro and replies", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Copilot Intro",
      cliType: "copilot-cli",
      dir: COPILOT_DIR,
    });

    await waitForMessages(request, id, 1, 90_000);

    const agent = await getAgent(request, id);
    expect(agent.messages.length).toBeGreaterThanOrEqual(1);
    expect(["thinking", "replied", "available"]).toContain(agent.status);
  });

  // ── Chat round-trip ──────────────────────────────────────────────

  test("claude-code chat round-trip", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Claude Chat",
      cliType: "claude-code",
      dir: CLAUDE_DIR,
    });

    // Wait for intro reply
    await waitForMessages(request, id, 1, 90_000);
    // Wait for agent to be idle
    await waitForStatus(request, id, ["replied", "available"], 90_000);
    const introMsgCount = (await getAgent(request, id)).messages.length;

    // Send a follow-up message
    await sendChat(request, id, "Say hello back in one sentence.");
    await waitForMessages(request, id, introMsgCount + 1, 90_000);

    const agent = await getAgent(request, id);
    expect(agent.messages.length).toBeGreaterThan(introMsgCount);
  });

  test("copilot-cli chat round-trip", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Copilot Chat",
      cliType: "copilot-cli",
      dir: COPILOT_DIR,
    });

    // Wait for intro reply (Copilot can be slow to start)
    await waitForMessages(request, id, 1, 90_000);
    // Give it a moment to settle
    await new Promise((r) => setTimeout(r, 3000));
    const introMsgCount = (await getAgent(request, id)).messages.length;

    await sendChat(request, id, "Say hello back in one sentence.");
    await waitForMessages(request, id, introMsgCount + 1, 90_000);

    const agent = await getAgent(request, id);
    expect(agent.messages.length).toBeGreaterThan(introMsgCount);
  });

  // ── Reset ────────────────────────────────────────────────────────

  test("reset claude-code agent starts fresh conversation", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Claude Reset",
      cliType: "claude-code",
      dir: CLAUDE_DIR,
    });

    // Wait for intro messages
    await waitForMessages(request, id, 1, 90_000);
    const beforeReset = await getAgent(request, id);
    expect(beforeReset.messages.length).toBeGreaterThanOrEqual(1);

    // Reset
    await resetAgent(request, id);

    // Messages should be cleared immediately
    const afterReset = await getAgent(request, id);
    expect(afterReset.messages.length).toBe(0);
    expect(afterReset.status).toBe("available");

    // Should get a new intro reply
    await waitForMessages(request, id, 1, 90_000);
    const recovered = await getAgent(request, id);
    expect(recovered.messages.length).toBeGreaterThanOrEqual(1);
  });

  test("reset copilot-cli agent starts fresh conversation", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Copilot Reset",
      cliType: "copilot-cli",
      dir: COPILOT_DIR,
    });

    await waitForMessages(request, id, 1, 90_000);
    const beforeReset = await getAgent(request, id);
    expect(beforeReset.messages.length).toBeGreaterThanOrEqual(1);

    await resetAgent(request, id);

    const afterReset = await getAgent(request, id);
    expect(afterReset.messages.length).toBe(0);
    expect(afterReset.status).toBe("available");

    await waitForMessages(request, id, 1, 90_000);
    const recovered = await getAgent(request, id);
    expect(recovered.messages.length).toBeGreaterThanOrEqual(1);
  });

  // ── Delete ───────────────────────────────────────────────────────

  test("delete removes agent completely", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Delete Me",
      cliType: "claude-code",
      dir: CLAUDE_DIR,
    });

    const before = await request.get(`${SERVER}/agents`);
    expect((await before.json()).length).toBe(1);

    const delRes = await request.delete(`${SERVER}/agents/${id}`);
    expect(delRes.ok()).toBeTruthy();

    const after = await request.get(`${SERVER}/agents`);
    expect((await after.json()).length).toBe(0);
  });

  // ── Terminal WebSocket ───────────────────────────────────────────

  test("terminal WS connects for claude-code agent", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Claude WS",
      cliType: "claude-code",
      dir: CLAUDE_DIR,
    });

    // Give PTY time to start
    await new Promise((r) => setTimeout(r, 3000));

    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://localhost:3003/ws/terminal/${id}`);

    const connected = await new Promise<boolean>((resolve) => {
      ws.on("open", () => resolve(true));
      ws.on("error", () => resolve(false));
      setTimeout(() => resolve(false), 5000);
    });
    expect(connected).toBeTruthy();

    // Should receive scrollback or output
    const gotData = await new Promise<boolean>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "output" || msg.type === "scrollback") resolve(true);
      });
      setTimeout(() => resolve(false), 10000);
    });
    expect(gotData).toBeTruthy();

    ws.close();
  });

  test("terminal WS connects for copilot-cli agent", async ({ request }) => {
    const id = await spawnAgent(request, {
      name: "Copilot WS",
      cliType: "copilot-cli",
      dir: COPILOT_DIR,
    });

    await new Promise((r) => setTimeout(r, 3000));

    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(`ws://localhost:3003/ws/terminal/${id}`);

    const connected = await new Promise<boolean>((resolve) => {
      ws.on("open", () => resolve(true));
      ws.on("error", () => resolve(false));
      setTimeout(() => resolve(false), 5000);
    });
    expect(connected).toBeTruthy();

    const gotData = await new Promise<boolean>((resolve) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "output" || msg.type === "scrollback") resolve(true);
      });
      setTimeout(() => resolve(false), 10000);
    });
    expect(gotData).toBeTruthy();

    ws.close();
  });

  // ── Edge cases ───────────────────────────────────────────────────

  test("spawn rejects invalid cliType", async ({ request }) => {
    const res = await request.post(`${SERVER}/agents/spawn`, {
      data: {
        name: "Bad Agent",
        cliType: "invalid-cli",
        workingDirectory: TEST_DIR,
      },
    });
    expect(res.status()).toBe(400);
  });

  test("spawn rejects missing workingDirectory", async ({ request }) => {
    const res = await request.post(`${SERVER}/agents/spawn`, {
      data: {
        name: "No Dir",
        cliType: "claude-code",
      },
    });
    expect(res.status()).toBe(400);
  });

  test("reset non-existent agent returns ok", async ({ request }) => {
    const res = await request.post(`${SERVER}/agents/fake-id/control`, {
      data: { command: "reset" },
    });
    // Should not crash — just returns ok (no-op)
    expect(res.ok()).toBeTruthy();
  });

  test("delete non-existent agent returns ok gracefully", async ({ request }) => {
    const res = await request.delete(`${SERVER}/agents/fake-id`);
    // Server handles gracefully (no crash)
    expect(res.ok()).toBeTruthy();
  });
});
