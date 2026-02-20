import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";

const SERVER = "http://localhost:3003";
const ROOT = path.resolve(process.cwd());
const CLI = `npx tsx ${path.join(ROOT, "apps/officeagent/src/index.ts")}`;
const TEST_DIR = path.join(ROOT, "test-workspace/cli-test");

test.setTimeout(30_000);

async function cleanupAgents(request: any) {
  const res = await request.get(`${SERVER}/agents`);
  const agents = await res.json();
  for (const agent of agents) {
    await request.delete(`${SERVER}/agents/${agent.agentId}`);
  }
}

test.describe("officeagent CLI", () => {
  test.beforeEach(async ({ request }) => {
    execSync(`mkdir -p ${TEST_DIR}`);
    await cleanupAgents(request);
  });

  test.afterEach(async ({ request }) => {
    await cleanupAgents(request);
  });

  test("--help shows usage", () => {
    const output = execSync(`${CLI} --help`, { encoding: "utf-8" });
    expect(output).toContain("officeagent");
    expect(output).toContain("start");
    expect(output).toContain("spawn");
  });

  test("spawn --help shows spawn options", () => {
    const output = execSync(`${CLI} spawn --help`, { encoding: "utf-8" });
    expect(output).toContain("--name");
    expect(output).toContain("--cli");
    expect(output).toContain("--dir");
  });

  test("start --help shows start options", () => {
    const output = execSync(`${CLI} start --help`, { encoding: "utf-8" });
    expect(output).toContain("--server-only");
    expect(output).toContain("--web-only");
  });

  test("spawn creates agent via server API", async ({ request }) => {
    const output = execSync(
      `${CLI} spawn --name "CLI Bot" --dir "${TEST_DIR}"`,
      { encoding: "utf-8" }
    );
    expect(output).toContain("Agent spawned");
    expect(output).toContain("CLI Bot");

    const res = await request.get(`${SERVER}/agents`);
    const agents = await res.json();
    const agent = agents.find((a: any) => a.name === "CLI Bot");
    expect(agent).toBeTruthy();
    expect(agent.cliType).toBe("claude-code");
  });

  test("spawn with copilot flag", async ({ request }) => {
    const output = execSync(
      `${CLI} spawn --name "Copilot Bot" -c copilot --dir "${TEST_DIR}"`,
      { encoding: "utf-8" }
    );
    expect(output).toContain("Agent spawned");

    const res = await request.get(`${SERVER}/agents`);
    const agents = await res.json();
    const agent = agents.find((a: any) => a.name === "Copilot Bot");
    expect(agent).toBeTruthy();
    expect(agent.cliType).toBe("copilot-cli");
  });

  test("spawn with random name when none provided", async ({ request }) => {
    const output = execSync(
      `${CLI} spawn --dir "${TEST_DIR}"`,
      { encoding: "utf-8" }
    );
    expect(output).toContain("Agent spawned");

    const res = await request.get(`${SERVER}/agents`);
    const agents = await res.json();
    expect(agents.length).toBe(1);
    // Name should be non-empty (server assigns random name)
    expect(agents[0].name.length).toBeGreaterThan(0);
  });
});
