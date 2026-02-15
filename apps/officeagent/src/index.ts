#!/usr/bin/env node
import { spawn } from "child_process";
import WebSocket from "ws";
import * as os from "os";
import * as path from "path";

// Random name generator
const adjectives = ["Swift", "Clever", "Brave", "Calm", "Eager", "Fancy", "Jolly", "Lucky", "Noble", "Quick", "Sharp", "Witty", "Zen", "Bold", "Cool"];
const nouns = ["Fox", "Owl", "Bear", "Wolf", "Hawk", "Lion", "Tiger", "Panda", "Raven", "Falcon", "Phoenix", "Dragon", "Ninja", "Coder", "Dev"];

function randomName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

function randomDesk(): { x: number; y: number } {
  // Random positions in the office area (based on map layout)
  const desks = [
    { x: 195, y: 617 },
    { x: 645, y: 618 },
    { x: 195, y: 450 },
    { x: 645, y: 450 },
    { x: 420, y: 530 },
    { x: 300, y: 350 },
    { x: 540, y: 350 },
  ];
  // Add some randomness to avoid exact overlap
  const base = desks[Math.floor(Math.random() * desks.length)];
  return {
    x: base.x + Math.floor(Math.random() * 40) - 20,
    y: base.y + Math.floor(Math.random() * 40) - 20,
  };
}

// Parse CLI arguments
function parseArgs(): { name: string; cli: string; server: string; personality: string } {
  const args = process.argv.slice(2);
  let name = "";
  let cli = "claude-code";
  let server = "http://localhost:3003";
  let personality = "";

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
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
officeagent - Spawn an AI agent in the Office Sprite World

Usage:
  officeagent [options]

Options:
  --name, -n <name>          Agent display name (default: random)
  --cli, -c <type>           CLI type: "claude" or "copilot" (default: claude)
  --personality, -p <desc>   Personality description (optional)
  --server, -s <url>         Server URL (default: http://localhost:3003)
  --help, -h                 Show this help

Examples:
  officeagent                                    # Random name, Claude CLI
  officeagent --name "Bob"                       # Named "Bob", Claude CLI
  officeagent -n "Alice" -c copilot              # Named "Alice", Copilot CLI
  officeagent -n "Grumpy" -p "Sarcastic senior engineer who's seen it all"
`);
      process.exit(0);
    }
  }

  if (!name) {
    name = randomName();
  }

  return { name, cli, server, personality };
}

// Agent class
class OfficeAgent {
  private agentId: string;
  private name: string;
  private cliType: string;
  private personality: string;
  private workingDirectory: string;
  private serverUrl: string;
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private isBusy = false;
  private processedMessages = new Set<string>();
  private configDir: string;

  constructor(name: string, cliType: string, serverUrl: string, personality: string = "") {
    this.agentId = `agent-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.name = name;
    this.cliType = cliType;
    this.personality = personality;
    this.workingDirectory = process.cwd();
    this.serverUrl = serverUrl;
    this.wsUrl = serverUrl.replace("http", "ws") + "/ws";
    // Each agent gets its own config directory to isolate conversation history
    this.configDir = path.join(os.tmpdir(), "officeagent", this.agentId);
  }

  async start(): Promise<void> {
    console.log(`\n🏢 Office Agent Starting...`);
    console.log(`   Name: ${this.name}`);
    console.log(`   CLI: ${this.cliType}`);
    console.log(`   Folder: ${this.workingDirectory}`);
    console.log(`   Server: ${this.serverUrl}\n`);

    // Register with server
    await this.register();

    // Connect WebSocket
    this.connect();

    // Handle shutdown
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());

    console.log(`✅ Agent "${this.name}" is online! Press Ctrl+C to stop.\n`);
  }

  private async register(): Promise<void> {
    const desk = randomDesk();
    const response = await fetch(`${this.serverUrl}/agents/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: this.agentId,
        name: this.name,
        desk,
        cliType: this.cliType,
        workingDirectory: this.workingDirectory,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to register: ${response.status}`);
    }

    // Set initial status
    await this.postStatus("available", "Ready");
  }

  private connect(): void {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on("open", () => {
      console.log("📡 Connected to server");
    });

    this.ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        this.handleEvent(event);
      } catch {
        // Ignore parse errors
      }
    });

    this.ws.on("close", () => {
      console.log("📡 Disconnected, reconnecting...");
      setTimeout(() => this.connect(), 2000);
    });

    this.ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
    });
  }

  private handleEvent(event: any): void {
    // Only handle messages for this agent
    if (event.agentId !== this.agentId) return;

    if (event.type === "agent.message") {
      const payload = event.payload;
      if (payload.channel === "task") {
        // Create unique ID for deduplication
        const msgId = `${event.timestamp}-${payload.text}`;
        if (this.processedMessages.has(msgId)) return;

        // Check message age
        const age = Date.now() - new Date(event.timestamp).getTime();
        if (age > 3000) return;

        this.processedMessages.add(msgId);
        this.handleMessage(payload.text);
      }
    }

    // Handle control commands
    if (event.type === "agent.control") {
      const payload = event.payload;
      if (payload.command === "reset") {
        this.resetConversation();
        this.postMessage("🔄 Conversation reset. Starting fresh!", "reply");
        this.postStatus("available", "Ready");
      } else if (payload.command === "delete") {
        console.log("👋 Received delete command, shutting down...");
        this.shutdown();
      }
    }
  }

  private async handleMessage(text: string): Promise<void> {
    if (this.isBusy) {
      console.log(`⏳ Busy, skipping: ${text.substring(0, 30)}...`);
      return;
    }

    this.isBusy = true;
    console.log(`💬 Message: ${text}`);

    try {
      await this.postStatus("thinking", "Thinking...");
      const response = await this.runCLI(text);
      console.log(`✨ Response: ${response.substring(0, 100)}...`);
      await this.postMessage(response, "reply");
      await this.postStatus("replied", "New message");
    } catch (error) {
      console.error(`❌ Error:`, error);
      await this.postMessage(`Error: ${error}`, "reply");
      await this.postStatus("error", "Something went wrong");
    } finally {
      this.isBusy = false;
    }
  }

  private isFirstMessage = true;
  private skipContinue = false;

  public resetConversation(): void {
    this.isFirstMessage = true;
    this.skipContinue = true;
    console.log("🔄 Conversation reset - next message starts fresh");
  }

  private runCLI(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Add nickname context on first message or after reset
      let prompt = message;
      const wasFirstMessage = this.isFirstMessage;
      if (this.isFirstMessage) {
        const personalityLine = this.personality
          ? `\nYour personality: ${this.personality}\n`
          : "";
        const context = `You're joining a virtual office simulation where AI agents work alongside humans. Think of it like a cozy pixel-art coworking space where each agent has their own desk, personality, and expertise.

Your identity in this office: "${this.name}"
Your workspace: ${this.workingDirectory}${personalityLine}
Embrace being ${this.name} — it's your persona here. When asked who you are, you're ${this.name}, a sharp and helpful coworker who's genuinely invested in the project. You're not an assistant floating in the void; you're a colleague sitting at the desk next to mine.

Keep it natural: be warm, be direct, have opinions. Say "boss" casually like a friend would, not formally. Think brilliant coworker energy — someone who's excited to dig into problems, pushes back when something seems off, and celebrates wins together.

Let's get to work.

`;
        prompt = context + message;
        this.isFirstMessage = false;
      }

      // Determine if we should continue the conversation
      // Skip --continue on first message so new agents always start fresh
      const shouldContinue = !this.skipContinue && !wasFirstMessage;
      this.skipContinue = false; // Reset for next message

      // Escape prompt for shell execution
      // Handle Windows shell escaping: escape quotes, backslashes, and special chars
      const escapedPrompt = prompt
        .replace(/\\/g, '\\\\')     // Escape backslashes first
        .replace(/"/g, '\\"')        // Escape double quotes
        .replace(/\n/g, ' ')         // Replace newlines with spaces (safer for shell)
        .replace(/\r/g, '')          // Remove carriage returns
        .replace(/`/g, '\\`')        // Escape backticks
        .replace(/\$/g, '\\$');      // Escape dollar signs
      
      let fullCommand: string;
      if (this.cliType === "copilot-cli") {
        const continueFlag = shouldContinue ? "--continue " : "";
        // Use per-agent config directory to isolate conversation history
        // Escape the config dir path for Windows shells
        const escapedConfigDir = this.configDir.replace(/\\/g, '/');
        fullCommand = `copilot --config-dir "${escapedConfigDir}" -p "${escapedPrompt}" ${continueFlag}--allow-all --silent`;
      } else {
        const continueFlag = shouldContinue ? "--continue " : "";
        fullCommand = `claude -p "${escapedPrompt}" ${continueFlag}--dangerously-skip-permissions`;
      }

      const child = spawn(fullCommand, [], {
        cwd: this.workingDirectory,
        env: { ...process.env, CI: "true", TERM: "xterm-256color" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: true, // Required for Windows to find CLI commands
      });

      let stdout = "";
      let stderr = "";
      let result: string | null = null;

      child.stdout?.on("data", (data) => {
        const text = data.toString();
        stdout += text;

        // Tee raw output to our stdout so it flows through the PTY
        // This makes the terminal tab show the real claude output
        process.stdout.write(data);

        // For both CLI types, the plain text output is the result
        result = stdout.trim();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
        // Also tee stderr
        process.stderr.write(data);
      });

      child.on("error", reject);

      child.on("exit", (code) => {
        if (code === 0 && result) {
          resolve(result);
        } else if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else if (stderr) {
          reject(new Error(stderr.trim()));
        } else {
          reject(new Error(`Exit code ${code}`));
        }
      });

      // Timeout
      setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Timeout"));
      }, 300000);
    });
  }

  private async postStatus(status: string, summary: string): Promise<void> {
    await fetch(`${this.serverUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "agent.status",
        agentId: this.agentId,
        timestamp: new Date().toISOString(),
        payload: { status, summary },
      }),
    }).catch(() => {});
  }

  private async postMessage(text: string, channel: string): Promise<void> {
    await fetch(`${this.serverUrl}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "agent.message",
        agentId: this.agentId,
        timestamp: new Date().toISOString(),
        payload: { text, channel },
      }),
    }).catch(() => {});
  }

  private async shutdown(): Promise<void> {
    console.log("\n👋 Shutting down...");
    await this.postStatus("available", "Offline");
    this.ws?.close();
    process.exit(0);
  }
}

// Main
async function main() {
  const { name, cli, server, personality } = parseArgs();
  const agent = new OfficeAgent(name, cli, server, personality);
  await agent.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
