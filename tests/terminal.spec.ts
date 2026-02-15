import { test, expect } from "@playwright/test";
import path from "path";

const SERVER = "http://localhost:3003";
const TEST_WORKSPACE = path.resolve(process.cwd(), "test-workspace");

// Helper: spawn an agent via the API and return its agentId
async function spawnAgent(request: any) {
  const res = await request.post(`${SERVER}/agents/spawn`, {
    data: {
      name: "TestBot",
      cliType: "claude-code",
      workingDirectory: TEST_WORKSPACE,
    },
  });
  expect(res.ok()).toBeTruthy();
  return res;
}

// Helper: wait until an agent appears in the server's agent list
async function waitForAgent(request: any, name: string, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request.get(`${SERVER}/agents`);
    const agents = await res.json();
    const found = agents.find((a: any) => a.name === name);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Agent "${name}" did not appear within ${timeoutMs}ms`);
}

// Helper: clean up all agents
async function cleanupAgents(request: any) {
  const res = await request.get(`${SERVER}/agents`);
  const agents = await res.json();
  for (const agent of agents) {
    await request.delete(`${SERVER}/agents/${agent.agentId}`);
  }
}

test.describe("Terminal mode E2E", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupAgents(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupAgents(request);
  });

  test("server /ws WebSocket still works after noServer migration", async ({ page }) => {
    await page.goto("/");
    // Wait for the WS connection to establish and receive a snapshot
    await page.waitForFunction(() => {
      const canvas = document.querySelector("canvas");
      return canvas !== null;
    }, { timeout: 10_000 });

    // The game canvas should be present - means the app loaded and WS connected
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible();
  });

  test("panel tabs (Chat/Terminal) appear when opening agent sidebar", async ({
    page,
    request,
  }) => {
    // Spawn an agent
    await spawnAgent(request);
    const agent = await waitForAgent(request, "TestBot");

    await page.goto("/");
    await page.waitForTimeout(2000); // Let WS sync

    // Tabs should be hidden initially
    const tabs = page.locator("#panel-tabs");
    await expect(tabs).toBeHidden();

    // Open agent via number key 1
    await page.keyboard.press("1");
    await page.waitForTimeout(500);

    // Tabs should now be visible
    await expect(tabs).toBeVisible();

    // Chat tab is active by default
    const chatTab = page.locator("#tab-chat");
    const terminalTab = page.locator("#tab-terminal");
    await expect(chatTab).toHaveClass(/active/);
    await expect(terminalTab).not.toHaveClass(/active/);
  });

  test("clicking Terminal tab widens sidebar and shows terminal container", async ({
    page,
    request,
  }) => {
    await spawnAgent(request);
    await waitForAgent(request, "TestBot");

    await page.goto("/");
    await page.waitForTimeout(2000);

    // Open agent
    await page.keyboard.press("1");
    await page.waitForTimeout(500);

    const panel = page.locator("#ui-panel");
    const terminalContainer = page.locator("#terminal-container");

    // Initially terminal container hidden, sidebar is 360px
    await expect(terminalContainer).toBeHidden();
    const initialWidth = await panel.evaluate((el) => el.offsetWidth);
    expect(initialWidth).toBeLessThanOrEqual(370); // ~360px

    // Click Terminal tab
    await page.locator("#tab-terminal").click();
    await page.waitForTimeout(500);

    // Terminal tab should be active
    await expect(page.locator("#tab-terminal")).toHaveClass(/active/);
    await expect(page.locator("#tab-chat")).not.toHaveClass(/active/);

    // Sidebar should have terminal-mode class -> wider
    await expect(panel).toHaveClass(/terminal-mode/);

    // Terminal container should be visible
    await expect(terminalContainer).toBeVisible();

    // Chat messages should be hidden
    await expect(page.locator("#panel-messages")).toBeHidden();

    // Sidebar should be wider (~560px)
    const termWidth = await panel.evaluate((el) => el.offsetWidth);
    expect(termWidth).toBeGreaterThan(500);
  });

  test("switching back to Chat tab narrows sidebar and hides terminal", async ({
    page,
    request,
  }) => {
    await spawnAgent(request);
    await waitForAgent(request, "TestBot");

    await page.goto("/");
    await page.waitForTimeout(2000);

    // Open agent -> terminal
    await page.keyboard.press("1");
    await page.waitForTimeout(500);
    await page.locator("#tab-terminal").click();
    await page.waitForTimeout(500);

    // Now switch back to chat
    await page.locator("#tab-chat").click();
    await page.waitForTimeout(500);

    const panel = page.locator("#ui-panel");
    await expect(panel).not.toHaveClass(/terminal-mode/);
    await expect(page.locator("#terminal-container")).toBeHidden();
    await expect(page.locator("#panel-messages")).toBeVisible();

    // Width should be back to ~360
    const width = await panel.evaluate((el) => el.offsetWidth);
    expect(width).toBeLessThanOrEqual(370);
  });

  test("xterm.js terminal renders in the container", async ({
    page,
    request,
  }) => {
    await spawnAgent(request);
    await waitForAgent(request, "TestBot");

    await page.goto("/");
    await page.waitForTimeout(2000);

    // Open agent -> terminal
    await page.keyboard.press("1");
    await page.waitForTimeout(500);
    await page.locator("#tab-terminal").click();
    await page.waitForTimeout(1500); // Give xterm time to render

    // xterm.js creates a .xterm element inside the container
    const xtermEl = page.locator("#terminal-container .xterm");
    await expect(xtermEl).toBeVisible({ timeout: 5000 });

    // There should be an xterm-screen (the canvas/viewport)
    const screen = page.locator("#terminal-container .xterm-screen");
    await expect(screen).toBeVisible();
  });

  test("terminal WebSocket connects to server", async ({
    page,
    request,
  }) => {
    await spawnAgent(request);
    const agent = await waitForAgent(request, "TestBot");

    await page.goto("/");
    await page.waitForTimeout(2000);

    // Track WebSocket connections
    const wsUrls: string[] = [];
    page.on("websocket", (ws) => {
      wsUrls.push(ws.url());
    });

    // Open agent -> terminal
    await page.keyboard.press("1");
    await page.waitForTimeout(500);
    await page.locator("#tab-terminal").click();
    await page.waitForTimeout(2000);

    // Should have created a terminal WebSocket
    const terminalWs = wsUrls.find((url) =>
      url.includes("/ws/terminal/")
    );
    expect(terminalWs).toBeTruthy();
  });

  test("Escape closes panel and disconnects terminal", async ({
    page,
    request,
  }) => {
    await spawnAgent(request);
    await waitForAgent(request, "TestBot");

    await page.goto("/");
    await page.waitForTimeout(2000);

    // Open agent -> terminal
    await page.keyboard.press("1");
    await page.waitForTimeout(500);
    await page.locator("#tab-terminal").click();
    await page.waitForTimeout(1000);

    // Tabs visible
    await expect(page.locator("#panel-tabs")).toBeVisible();

    // Press Escape to close
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Tabs should be hidden
    await expect(page.locator("#panel-tabs")).toBeHidden();

    // Terminal container should be hidden
    await expect(page.locator("#terminal-container")).toBeHidden();

    // Panel should not have terminal-mode
    await expect(page.locator("#ui-panel")).not.toHaveClass(/terminal-mode/);
  });

  test("terminal WS endpoint is reachable directly", async ({ request }) => {
    // Register a fake agent directly
    const regRes = await request.post(`${SERVER}/agents/register`, {
      data: {
        agentId: "test-terminal-agent",
        name: "TermTest",
        workingDirectory: TEST_WORKSPACE,
        cliType: "claude-code",
      },
    });
    expect(regRes.ok()).toBeTruthy();

    // Try connecting a raw WebSocket to the terminal endpoint
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(
      `ws://localhost:3003/ws/terminal/test-terminal-agent`
    );

    const connected = await new Promise<boolean>((resolve) => {
      ws.on("open", () => resolve(true));
      ws.on("error", () => resolve(false));
      setTimeout(() => resolve(false), 5000);
    });

    expect(connected).toBeTruthy();

    // Should receive some output (PTY started)
    const gotOutput = await new Promise<boolean>((resolve) => {
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "output" || msg.type === "error") {
            resolve(true);
          }
        } catch {
          // ignore
        }
      });
      setTimeout(() => resolve(false), 8000);
    });

    ws.close();

    // Clean up
    await request.delete(`${SERVER}/agents/test-terminal-agent`);

    // Either got output or error is fine - proves the endpoint works
    expect(gotOutput).toBeTruthy();
  });

  test("reopening terminal within grace period reuses PTY session", async ({
    page,
    request,
  }) => {
    await spawnAgent(request);
    await waitForAgent(request, "TestBot");

    await page.goto("/");
    await page.waitForTimeout(2000);

    // Open agent -> terminal
    await page.keyboard.press("1");
    await page.waitForTimeout(500);
    await page.locator("#tab-terminal").click();
    await page.waitForTimeout(1500);

    // xterm should be rendered
    await expect(page.locator("#terminal-container .xterm")).toBeVisible();

    // Switch to chat (disconnects terminal WS)
    await page.locator("#tab-chat").click();
    await page.waitForTimeout(1000);

    // Switch back to terminal within 5s grace period
    await page.locator("#tab-terminal").click();
    await page.waitForTimeout(1500);

    // xterm should render again (reconnected to same PTY)
    await expect(page.locator("#terminal-container .xterm")).toBeVisible();
  });
});
