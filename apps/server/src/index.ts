import cors from "cors";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { ChildProcess } from "child_process";
import * as pty from "node-pty";
import {
  EventEnvelopeSchema,
  validatePayload,
  type EventEnvelope,
  type AgentStatusPayload,
  type AgentMessagePayload,
  type AgentPositionPayload,
  type TaskAssignPayload
} from "../../../shared/src/schema";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.." );
const dataDir = path.join(rootDir, "data");
const agentsPath = path.join(dataDir, "agents.json");
const tasksPath = path.join(dataDir, "tasks.json");
const eventsPath = path.join(dataDir, "events.jsonl");

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  const raw = readFileSync(filePath, "utf-8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw) as T;
}

function writeJsonFile<T>(filePath: string, data: T) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const AgentRecordSchema = z.object({
  agentId: z.string(),
  name: z.string().optional(),
  desk: z.object({ x: z.number(), y: z.number() }).optional(),
  status: z.enum(["idle", "working", "blocked", "finished", "reviewed", "available", "thinking", "replied", "error"]).optional(),
  summary: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  cliType: z.enum(["claude-code", "copilot-cli"]).optional(),
  workingDirectory: z.string().optional(),
  messages: z
    .array(
      z.object({
        text: z.string(),
        channel: z.enum(["log", "reply", "task"]),
        timestamp: z.string(),
        collapsible: z.boolean().optional()
      })
    )
    .default([]),
  lastSeen: z.string().optional()
});

type AgentRecord = z.infer<typeof AgentRecordSchema>;

const TaskRecordSchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  title: z.string(),
  details: z.string().optional(),
  status: z.enum(["assigned", "done"]).default("assigned"),
  createdAt: z.string()
});

type TaskRecord = z.infer<typeof TaskRecordSchema>;

let agents = readJsonFile<AgentRecord[]>(agentsPath, []);
let tasks = readJsonFile<TaskRecord[]>(tasksPath, []);

function persistAgents() {
  writeJsonFile(agentsPath, agents);
}

function persistTasks() {
  writeJsonFile(tasksPath, tasks);
}

function appendEvent(event: EventEnvelope) {
  appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
}

function upsertAgent(agentId: string, update: Partial<AgentRecord>) {
  const existing = agents.find((a) => a.agentId === agentId);
  if (existing) {
    Object.assign(existing, update);
  } else {
    agents.push({ agentId, messages: [], ...update });
  }
  persistAgents();
}

function applyEvent(event: EventEnvelope) {
  const now = new Date().toISOString();
  const { agentId } = event;
  if (event.type === "agent.status") {
    const payload = validatePayload(event.type, event.payload) as AgentStatusPayload;
    upsertAgent(agentId, { status: payload.status, summary: payload.summary, lastSeen: now });
  }
  if (event.type === "agent.message") {
    const payload = validatePayload(event.type, event.payload) as AgentMessagePayload;
    const existing = agents.find((a) => a.agentId === agentId);
    const messages = existing?.messages ?? [];
    messages.push({
      text: payload.text,
      channel: payload.channel,
      timestamp: event.timestamp,
      collapsible: payload.collapsible
    });
    const trimmed = messages.slice(-20);
    upsertAgent(agentId, { messages: trimmed, lastSeen: now });
  }
  if (event.type === "agent.position") {
    const payload = validatePayload(event.type, event.payload) as AgentPositionPayload;
    upsertAgent(agentId, { position: payload, lastSeen: now });
  }
  if (event.type === "task.assign") {
    const payload = validatePayload(event.type, event.payload) as TaskAssignPayload;
    const existing = tasks.find((t) => t.taskId === payload.taskId);
    if (existing) {
      existing.title = payload.title;
      existing.details = payload.details;
      existing.status = "assigned";
    } else {
      tasks.push({
        taskId: payload.taskId,
        agentId,
        title: payload.title,
        details: payload.details,
        status: "assigned",
        createdAt: now
      });
    }
    persistTasks();
  }
}

// ============ Agent PTY tracking ============
// (declared early so register handler can call linkAgentToPty)

interface AgentPtySession {
  ptyProcess: pty.IPty;
  clients: Set<WebSocket>;   // terminal tab viewers
  scrollback: string[];      // buffered output so terminal tab can catch up
}

const agentPtys = new Map<string, AgentPtySession>();
const processIdToAgentId = new Map<string, string>();
const pendingPtys = new Map<string, pty.IPty>();
const spawnedProcesses = new Map<string, ChildProcess>();

function linkAgentToPty(agentId: string, agentName?: string) {
  if (agentPtys.has(agentId)) return;

  for (const [, ptyProc] of pendingPtys) {
    const spawnName = (ptyProc as any).__spawnName as string;
    const processId = (ptyProc as any).__processId as string;
    const scrollback = (ptyProc as any).__scrollback as string[];

    if (spawnName === agentName) {
      processIdToAgentId.set(processId, agentId);
      agentPtys.set(agentId, {
        ptyProcess: ptyProc,
        clients: new Set(),
        scrollback,
      });
      // eslint-disable-next-line no-console
      console.log(`[terminal] Linked agent "${agentName}" (${agentId}) to PTY (processId: ${processId})`);
      return;
    }
  }
}

const RegisterSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().optional(),
  desk: z.object({ x: z.number(), y: z.number() }).optional(),
  cliType: z.enum(["claude-code", "copilot-cli"]).optional(),
  workingDirectory: z.string().optional()
});

app.post("/agents/register", (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { agentId, name, desk, cliType, workingDirectory } = parsed.data;
  const existing = agents.find((a) => a.agentId === agentId);
  const next = {
    agentId,
    name: name ?? existing?.name,
    desk: desk ?? existing?.desk,
    status: existing?.status ?? "idle",
    summary: existing?.summary ?? "",
    position: existing?.position ?? desk ?? existing?.desk,
    cliType: cliType ?? existing?.cliType,
    workingDirectory: workingDirectory ?? existing?.workingDirectory,
    messages: existing?.messages ?? [],
    lastSeen: new Date().toISOString()
  } satisfies AgentRecord;
  upsertAgent(agentId, next);

  // Link this agent to its PTY (if spawned via /agents/spawn)
  linkAgentToPty(agentId, next.name);

  const snapshot: EventEnvelope = {
    type: "snapshot",
    agentId: "system",
    timestamp: new Date().toISOString(),
    payload: { agents, tasks }
  };
  broadcast(snapshot);
  res.json(next);
});

app.get("/agents", (_req, res) => {
  res.json(agents);
});

// Delete an agent
app.delete("/agents/:agentId", (req, res) => {
  const { agentId } = req.params;

  // Send delete command to agent via WebSocket
  const controlEvent: EventEnvelope = {
    type: "agent.control" as any,
    agentId,
    timestamp: new Date().toISOString(),
    payload: { command: "delete" }
  };
  broadcast(controlEvent);

  // Remove from agents list
  const index = agents.findIndex((a) => a.agentId === agentId);
  if (index !== -1) {
    agents.splice(index, 1);
    persistAgents();
  }

  // Kill spawned PTY process if we have it
  const ptySession = agentPtys.get(agentId);
  if (ptySession) {
    try { ptySession.ptyProcess.kill(); } catch {}
    agentPtys.delete(agentId);
  }

  // Also check legacy spawned processes
  const proc = spawnedProcesses.get(agentId);
  if (proc) {
    proc.kill("SIGTERM");
    spawnedProcesses.delete(agentId);
  }

  // Broadcast updated snapshot
  const snapshot: EventEnvelope = {
    type: "snapshot",
    agentId: "system",
    timestamp: new Date().toISOString(),
    payload: { agents, tasks }
  };
  broadcast(snapshot);

  res.json({ ok: true });
});

// Send control command to agent (reset, etc.)
app.post("/agents/:agentId/control", (req, res) => {
  const { agentId } = req.params;
  const { command } = req.body;

  if (!["reset", "delete"].includes(command)) {
    res.status(400).json({ error: "Invalid command" });
    return;
  }

  // If reset, also clear messages in server state
  if (command === "reset") {
    const agent = agents.find((a) => a.agentId === agentId);
    if (agent) {
      agent.messages = [];
      persistAgents();
    }
  }

  const controlEvent: EventEnvelope = {
    type: "agent.control" as any,
    agentId,
    timestamp: new Date().toISOString(),
    payload: { command }
  };
  broadcast(controlEvent);

  // Broadcast updated snapshot after reset
  if (command === "reset") {
    const snapshot: EventEnvelope = {
      type: "snapshot",
      agentId: "system",
      timestamp: new Date().toISOString(),
      payload: { agents, tasks }
    };
    broadcast(snapshot);
  }

  res.json({ ok: true });
});

const TaskCreateSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().min(1),
  details: z.string().optional()
});

app.post("/tasks", (req, res) => {
  const parsed = TaskCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { agentId, title, details } = parsed.data;
  const taskId = randomUUID();
  const event: EventEnvelope = {
    type: "task.assign",
    agentId,
    timestamp: new Date().toISOString(),
    payload: { taskId, title, details }
  };
  applyEvent(event);
  appendEvent(event);
  broadcast(event);
  res.json({ taskId });
});

app.get("/tasks", (_req, res) => {
  res.json(tasks);
});

app.post("/events", (req, res) => {
  const parsed = EventEnvelopeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const envelope = parsed.data;
  try {
    validatePayload(envelope.type, envelope.payload);
  } catch (error) {
    res.status(400).json({ error: String(error) });
    return;
  }
  applyEvent(envelope);
  appendEvent(envelope);
  broadcast(envelope);
  res.json({ ok: true });
});

// Random name generator for agents
const adjectives = ["Swift", "Clever", "Brave", "Calm", "Eager", "Fancy", "Jolly", "Lucky", "Noble", "Quick", "Sharp", "Witty", "Zen", "Bold", "Cool"];
const nouns = ["Fox", "Owl", "Bear", "Wolf", "Hawk", "Lion", "Tiger", "Panda", "Raven", "Falcon", "Phoenix", "Dragon", "Ninja", "Coder", "Dev"];
function randomAgentName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj} ${noun}`;
}

const MAX_SCROLLBACK = 5000; // lines of terminal output to buffer

const SpawnSchema = z.object({
  name: z.string().optional(),
  cliType: z.enum(["claude-code", "copilot-cli"]).default("claude-code"),
  workingDirectory: z.string().min(1),
  personality: z.string().optional()
});

app.post("/agents/spawn", (req, res) => {
  const parsed = SpawnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { cliType, workingDirectory, personality } = parsed.data;
  const name = parsed.data.name?.trim() || randomAgentName();

  // Build the command arguments
  const args: string[] = ["--name", name];
  if (cliType === "copilot-cli") {
    args.push("--cli", "copilot");
  }
  if (personality?.trim()) {
    args.push("--personality", personality.trim());
  }

  const officeagentPath = path.join(rootDir, "apps", "officeagent", "src", "index.ts");
  const fullCmd = `npx tsx ${officeagentPath} ${args.map(a => `"${a}"`).join(" ")}`;

  // Clean env: strip CLAUDECODE so nested claude sessions work
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;

  // Spawn the officeagent inside a PTY
  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(process.env.SHELL || "/bin/bash", ["-l", "-c", fullCmd], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: workingDirectory,
      env: cleanEnv as Record<string, string>,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[spawn:${name}] Failed to spawn PTY:`, err);
    res.status(500).json({ error: `Failed to spawn agent: ${err}` });
    return;
  }

  const processId = `spawn-${Date.now()}`;

  // eslint-disable-next-line no-console
  console.log(`[spawn:${name}] PTY spawned (pid: ${ptyProcess.pid}, processId: ${processId})`);

  // Store PTY as pending until the agent registers and we learn its agentId
  pendingPtys.set(processId, ptyProcess);

  // Buffer output + log to server console
  const scrollback: string[] = [];
  ptyProcess.onData((data: string) => {
    // Buffer for terminal tab
    scrollback.push(data);
    if (scrollback.length > MAX_SCROLLBACK) {
      scrollback.splice(0, scrollback.length - MAX_SCROLLBACK);
    }

    // Forward to any connected terminal viewers
    // We need to find the agentId for this processId
    const agentId = processIdToAgentId.get(processId);
    if (agentId) {
      const session = agentPtys.get(agentId);
      if (session) {
        const msg = JSON.stringify({ type: "output", data });
        for (const client of session.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
          }
        }
      }
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    // eslint-disable-next-line no-console
    console.log(`[spawn:${name}] PTY exited with code ${exitCode}`);
    const agentId = processIdToAgentId.get(processId);
    if (agentId) {
      const session = agentPtys.get(agentId);
      if (session) {
        const exitMsg = JSON.stringify({ type: "exit", code: exitCode });
        for (const client of session.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(exitMsg);
          }
        }
      }
      agentPtys.delete(agentId);
    }
    pendingPtys.delete(processId);
    processIdToAgentId.delete(processId);
  });

  // When the agent registers, we'll match it by name and link agentId → PTY
  // We store the name so the register handler can find this pending PTY
  (ptyProcess as any).__spawnName = name;
  (ptyProcess as any).__processId = processId;
  (ptyProcess as any).__scrollback = scrollback;

  res.json({ ok: true, processId, message: `Agent spawned in ${workingDirectory}` });
});

// ============ HTTP Server + WebSocket ============

const server = http.createServer(app);

// Use noServer mode so we can route upgrades
const wss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });

const clients = new Set<WebSocket>();

function broadcast(event: EventEnvelope) {
  const message = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  }
}

wss.on("connection", (socket) => {
  clients.add(socket);
  const snapshot: EventEnvelope = {
    type: "snapshot",
    agentId: "system",
    timestamp: new Date().toISOString(),
    payload: { agents, tasks }
  };
  socket.send(JSON.stringify(snapshot));

  socket.on("message", (data) => {
    try {
      const parsed = EventEnvelopeSchema.safeParse(JSON.parse(data.toString()));
      if (!parsed.success) {
        socket.send(JSON.stringify({ error: parsed.error.message }));
        return;
      }
      const envelope = parsed.data;
      validatePayload(envelope.type, envelope.payload);
      applyEvent(envelope);
      appendEvent(envelope);
      broadcast(envelope);
    } catch (error) {
      socket.send(JSON.stringify({ error: String(error) }));
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
});

// ============ Terminal WSS — spawns interactive CLI session ============

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")   // CSI sequences (colors, cursor, etc.)
    .replace(/\x1b\][^\x07]*\x07/g, "")        // OSC sequences (title, etc.)
    .replace(/\x1b[()][AB012]/g, "")            // Character set selection
    .replace(/\x1b[\x20-\x2f][\x30-\x7e]/g, "") // 2-byte escape sequences
    .replace(/\x1b[78]/g, "")                   // Save/restore cursor
    .replace(/\r/g, "")                         // Carriage returns
    .replace(/\x07/g, "");                      // Bell
}

interface TerminalSession {
  ptyProcess: pty.IPty;
  clients: Set<WebSocket>;
  killTimer: ReturnType<typeof setTimeout> | null;
  // Output bridging to chat
  outputBuffer: string;
  settleTimer: ReturnType<typeof setTimeout> | null;
  isStreaming: boolean;
}
const terminalSessions = new Map<string, TerminalSession>();

terminalWss.on("connection", (socket: WebSocket, req: http.IncomingMessage) => {
  const urlParts = req.url?.split("/") ?? [];
  const agentId = urlParts[urlParts.length - 1];

  if (!agentId) {
    socket.close(1008, "Missing agentId");
    return;
  }

  const agent = agents.find((a) => a.agentId === agentId);
  if (!agent) {
    socket.send(JSON.stringify({ type: "error", data: "Agent not found." }));
    socket.close(1008, "Agent not found");
    return;
  }

  // Reuse existing terminal session if one exists (e.g. user switched tabs and came back)
  let session = terminalSessions.get(agentId);

  if (session) {
    // Cancel any pending kill timer
    if (session.killTimer) {
      clearTimeout(session.killTimer);
      session.killTimer = null;
    }
    session.clients.add(socket);
    // eslint-disable-next-line no-console
    console.log(`[terminal:${agentId}] Client reconnected (${session.clients.size} clients)`);
  } else {
    // Spawn a new interactive CLI session in the agent's working directory
    const cwd = agent.workingDirectory || process.cwd();
    const cliType = agent.cliType;

    let shellCmd: string;
    if (cliType === "claude-code") {
      shellCmd = "claude --continue --dangerously-skip-permissions";
    } else if (cliType === "copilot-cli") {
      shellCmd = "copilot --continue";
    } else {
      shellCmd = process.env.SHELL || "/bin/bash";
    }

    // Clean env: strip CLAUDECODE so claude can launch
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(process.env.SHELL || "/bin/bash", ["-l", "-c", shellCmd], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd,
        env: cleanEnv as Record<string, string>,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[terminal:${agentId}] Failed to spawn:`, err);
      socket.send(JSON.stringify({ type: "error", data: `Failed to spawn terminal: ${err}` }));
      socket.close(1011, "PTY spawn failed");
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[terminal:${agentId}] Spawned interactive ${cliType || "shell"} (pid: ${ptyProcess.pid}) in ${cwd}`);

    session = { ptyProcess, clients: new Set([socket]), killTimer: null };
    terminalSessions.set(agentId, session);

    // Pipe PTY output to all connected clients
    ptyProcess.onData((data: string) => {
      const msg = JSON.stringify({ type: "output", data });
      for (const client of session!.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      // eslint-disable-next-line no-console
      console.log(`[terminal:${agentId}] PTY exited with code ${exitCode}`);
      const exitMsg = JSON.stringify({ type: "exit", code: exitCode });
      for (const client of session!.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(exitMsg);
        }
      }
      terminalSessions.delete(agentId);
    });
  }

  // Handle messages from this client
  const currentSession = session;
  socket.on("message", (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      if (msg.type === "input" && typeof msg.data === "string") {
        currentSession.ptyProcess.write(msg.data);
      } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        currentSession.ptyProcess.resize(msg.cols, msg.rows);
      }
    } catch {
      // Ignore
    }
  });

  socket.on("close", () => {
    currentSession.clients.delete(socket);
    // eslint-disable-next-line no-console
    console.log(`[terminal:${agentId}] Client disconnected (${currentSession.clients.size} remaining)`);

    // If no clients remain, start a kill timer
    if (currentSession.clients.size === 0) {
      currentSession.killTimer = setTimeout(() => {
        // eslint-disable-next-line no-console
        console.log(`[terminal:${agentId}] No clients for 10s, killing PTY`);
        try { currentSession.ptyProcess.kill(); } catch {}
        terminalSessions.delete(agentId);
      }, 10_000);
    }
  });
});

// ============ Upgrade routing ============

server.on("upgrade", (request, socket, head) => {
  const { url } = request;

  if (url === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else if (url?.startsWith("/ws/terminal/")) {
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

const PORT = Number(process.env.PORT ?? 3003);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${PORT}`);
});
