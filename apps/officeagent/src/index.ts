#!/usr/bin/env node

/**
 * officeagent — CLI for AIOffice
 *
 * Commands:
 *   start   — Launch the server and web app
 *   spawn   — Spawn an AI agent into the world
 */

import { spawn as nodeSpawn, execSync } from "child_process";
import * as path from "path";

const ROOT = path.resolve(import.meta.dirname ?? __dirname, "../../..");

// ── start command ────────────────────────────────────────────────────

function startWorld(args: string[]) {
  let serverOnly = false;
  let webOnly = false;

  for (const arg of args) {
    if (arg === "--server-only") serverOnly = true;
    if (arg === "--web-only") webOnly = true;
    if (arg === "--help" || arg === "-h") {
      console.log(`
officeagent start — Launch AIOffice

Usage:
  officeagent start [options]

Options:
  --server-only   Only start the server (port 3003)
  --web-only      Only start the web app (port 3000)
  --help, -h      Show this help

With no flags, starts both the server and web app.
`);
      process.exit(0);
    }
  }

  console.log("🏢 Starting AIOffice...\n");

  const procs: ReturnType<typeof nodeSpawn>[] = [];

  if (!webOnly) {
    console.log("  🖥  Server → http://localhost:3003");
    const server = nodeSpawn("npm", ["run", "dev:server"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
    procs.push(server);
  }

  if (!serverOnly) {
    console.log("  🌐 Web    → http://localhost:3000");
    const web = nodeSpawn("npm", ["run", "dev:web"], {
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
    procs.push(web);
  }

  console.log("\n  Press Ctrl+C to stop.\n");

  const shutdown = () => {
    console.log("\n👋 Shutting down...");
    for (const p of procs) {
      try { p.kill("SIGTERM"); } catch {}
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ── spawn command ────────────────────────────────────────────────────

async function spawnAgent(args: string[]) {
  let name = "";
  let cli = "claude-code";
  let server = "http://localhost:3003";
  let personality = "";
  let dir = process.cwd();
  let continueConversation = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" || args[i] === "-n") {
      name = args[++i] || "";
    } else if (args[i] === "--cli" || args[i] === "-c") {
      const val = args[++i];
      if (val === "copilot" || val === "copilot-cli") {
        cli = "copilot-cli";
      }
    } else if (args[i] === "--server" || args[i] === "-s") {
      server = args[++i] || server;
    } else if (args[i] === "--personality" || args[i] === "-p") {
      personality = args[++i] || "";
    } else if (args[i] === "--dir" || args[i] === "-d") {
      dir = args[++i] || dir;
    } else if (args[i] === "--continue") {
      continueConversation = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
officeagent spawn — Spawn an AI agent into the world

Usage:
  officeagent spawn [options]

Options:
  --name, -n <name>          Agent display name (default: random)
  --cli, -c <type>           CLI type: "claude" or "copilot" (default: claude)
  --personality, -p <desc>   Personality description
  --dir, -d <path>           Working directory (default: cwd)
  --continue                 Resume previous conversation
  --server, -s <url>         Server URL (default: http://localhost:3003)
  --help, -h                 Show this help

Examples:
  officeagent spawn                                         # Random name, Claude
  officeagent spawn --name "Bob" --dir ~/projects/myapp
  officeagent spawn -n "Alice" -c copilot
  officeagent spawn -n "Grumpy" -p "Sarcastic senior dev"
`);
      process.exit(0);
    }
  }

  console.log(`\n🏢 Spawning agent via ${server}...`);

  const res = await fetch(`${server}/agents/spawn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: name || undefined,
      cliType: cli,
      workingDirectory: dir,
      personality: personality || undefined,
      continueConversation,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(`❌ Failed to spawn: ${res.status}`, body.error || "");
    process.exit(1);
  }

  const body = await res.json();
  console.log(`✅ Agent spawned!`);
  console.log(`   ID:   ${body.agentId}`);
  console.log(`   Name: ${name || "(random)"}`);
  console.log(`   CLI:  ${cli}`);
  console.log(`   Dir:  ${dir}`);
  console.log(`\n   ${body.message}\n`);
}

// ── demo command ─────────────────────────────────────────────────────

function detectCLIs(): { hasClaude: boolean; hasCopilot: boolean } {
  let hasClaude = false;
  let hasCopilot = false;
  const cmd = process.platform === "win32" ? "where" : "which";
  try { execSync(`${cmd} claude`, { stdio: "ignore" }); hasClaude = true; } catch {}
  try { execSync(`${cmd} copilot`, { stdio: "ignore" }); hasCopilot = true; } catch {}
  return { hasClaude, hasCopilot };
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/agents`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function runDemo(args: string[]) {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      console.log(`
officeagent demo — Launch a full demo with auto-detected AI agents

Usage:
  officeagent demo [options]

Options:
  --help, -h   Show this help

Detects which AI CLIs are installed (claude, copilot) and spawns agents
into two demo projects: a todo-api spec and a partially-built world-clock app.

  Both installed → one Claude + one Copilot agent
  Only Claude    → two Claude agents
  Only Copilot   → two Copilot agents
`);
      process.exit(0);
    }
  }

  const { hasClaude, hasCopilot } = detectCLIs();

  if (!hasClaude && !hasCopilot) {
    console.error(`
❌ No supported AI CLI found.

Install at least one:
  • Claude Code:  https://docs.anthropic.com/en/docs/claude-code
  • GitHub Copilot CLI:  https://githubnext.com/projects/copilot-cli
`);
    process.exit(1);
  }

  console.log("\n🏢 AIOffice — Demo Mode\n");
  console.log("  Detected CLIs:");
  if (hasClaude) console.log("    ✅ Claude Code");
  else console.log("    ⬜ Claude Code (not found)");
  if (hasCopilot) console.log("    ✅ GitHub Copilot CLI");
  else console.log("    ⬜ GitHub Copilot CLI (not found)");
  console.log();

  // Start the world
  const procs: ReturnType<typeof nodeSpawn>[] = [];

  console.log("  🖥  Server → http://localhost:3003");
  const server = nodeSpawn("npm", ["run", "dev:server"], {
    cwd: ROOT,
    stdio: "ignore",
    shell: true,
  });
  procs.push(server);

  console.log("  🌐 Web    → http://localhost:3000");
  const web = nodeSpawn("npm", ["run", "dev:web"], {
    cwd: ROOT,
    stdio: "ignore",
    shell: true,
  });
  procs.push(web);

  const shutdown = () => {
    console.log("\n👋 Shutting down...");
    for (const p of procs) {
      try { p.kill("SIGTERM"); } catch {}
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("\n  ⏳ Waiting for server...");
  const ready = await waitForServer("http://localhost:3003");
  if (!ready) {
    console.error("  ❌ Server didn't start in time.");
    shutdown();
    return;
  }
  console.log("  ✅ Server ready!\n");

  // Determine agent assignments
  const demoDir1 = path.join(ROOT, "demo", "todo-api");
  const demoDir2 = path.join(ROOT, "demo", "world-clock");

  type AgentDef = { name: string; cli: string; dir: string };
  const agents: AgentDef[] = [];

  if (hasClaude && hasCopilot) {
    agents.push({ name: "Sarah (Lead)", cli: "claude-code", dir: demoDir1 });
    agents.push({ name: "Jake (Intern)", cli: "copilot-cli", dir: demoDir2 });
  } else if (hasClaude) {
    agents.push({ name: "Sarah (Lead)", cli: "claude-code", dir: demoDir1 });
    agents.push({ name: "Priya (Dev)", cli: "claude-code", dir: demoDir2 });
  } else {
    agents.push({ name: "Sarah (Lead)", cli: "copilot-cli", dir: demoDir1 });
    agents.push({ name: "Jake (Intern)", cli: "copilot-cli", dir: demoDir2 });
  }

  // Spawn agents with dramatic pacing
  for (const agent of agents) {
    await new Promise((r) => setTimeout(r, 300));
    console.log(`  🤖 Spawning ${agent.name} → ${agent.cli} → ${path.basename(agent.dir)}/`);
    try {
      const res = await fetch("http://localhost:3003/agents/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: agent.name,
          cliType: agent.cli,
          workingDirectory: agent.dir,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`     ❌ Failed: ${body.error || res.status}`);
      } else {
        console.log(`     ✅ Online`);
      }
    } catch (e: any) {
      console.error(`     ❌ ${e.message}`);
    }
  }

  console.log(`
  🌐 Office ready → http://localhost:3000

  👔 You're the boss. Go manage your team.
     Walk up to an agent and press E to chat.
     Press Ctrl+C to stop.
`);
}

// ── main ─────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
officeagent — CLI for AIOffice

Usage:
  officeagent <command> [options]

Commands:
  start    Launch the server and web app
  spawn    Spawn an AI agent into the world
  demo     Launch a full demo with auto-detected agents

Run "officeagent <command> --help" for command-specific options.
`);
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "start":
    startWorld(rest);
    break;
  case "spawn":
    spawnAgent(rest).catch((e) => {
      console.error("Fatal:", e.message || e);
      process.exit(1);
    });
    break;
  case "demo":
    runDemo(rest).catch((e) => {
      console.error("Fatal:", e.message || e);
      process.exit(1);
    });
    break;
  case "--help":
  case "-h":
  case undefined:
    showHelp();
    break;
  default:
    // Backwards compat: if no command, treat all args as spawn
    spawnAgent(process.argv.slice(2)).catch((e) => {
      console.error("Fatal:", e.message || e);
      process.exit(1);
    });
}

