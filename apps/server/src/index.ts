import cors from "cors";
import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import * as os from "os";
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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  realpathSync
} from "fs";
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

interface AgentPtySession {
  ptyProcess: pty.IPty;
  clients: Set<WebSocket>;
  scrollback: string[];
  workingDirectory: string;
  cliType: string;
  personality: string;
  isFirstMessage: boolean;
  jsonlWatcher: ReturnType<typeof setInterval> | null;
  jsonlPath: string | null;
  lastJsonlSize: number;
  isBusy: boolean;
  settleTimer: ReturnType<typeof setTimeout> | null;
  pendingText: string;
  pendingInput: string;
  lastChatMessage: string;
}

const agentPtys = new Map<string, AgentPtySession>();

// ============ JSONL Watcher ============

function getClaudeProjectDir(workDir: string): string {
  // Use realpathSync to follow symlinks (e.g. /tmp → /private/tmp on macOS)
  let resolved: string;
  try {
    resolved = realpathSync(workDir);
  } catch {
    resolved = path.resolve(workDir);
  }
  // Claude CLI replaces both slashes and spaces with dashes
  const encoded = resolved.replace(/\//g, "-").replace(/ /g, "-");
  return path.join(os.homedir(), ".claude", "projects", encoded);
}

function findActiveJsonl(projectDir: string): string | null {
  if (!existsSync(projectDir)) return null;
  try {
    const files = readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        name: f,
        mtime: statSync(path.join(projectDir, f)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? path.join(projectDir, files[0].name) : null;
  } catch {
    return null;
  }
}

function startJsonlWatcher(agentId: string) {
  const session = agentPtys.get(agentId);
  if (!session) return;

  const projectDir = getClaudeProjectDir(session.workingDirectory);
  // eslint-disable-next-line no-console
  console.log(`[jsonl:${agentId}] Watching project dir: ${projectDir}`);

  // Snapshot existing files AND their sizes so we detect both new files
  // and existing files that Claude appends to (happens after reset)
  const existingFileSizes = new Map<string, number>();
  if (existsSync(projectDir)) {
    try {
      readdirSync(projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .forEach((f) => {
          try {
            existingFileSizes.set(f, statSync(path.join(projectDir, f)).size);
          } catch {}
        });
    } catch {}
  }

  const poller = setInterval(() => {
    if (!existsSync(projectDir)) return;

    // If we already locked onto a file, just check for new content
    if (session.jsonlPath) {
      // fall through to content-reading below
    } else {
      // Look for a NEW .jsonl file or an existing file that GREW
      try {
        const currentFiles = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
        // Check for brand new file
        let targetFile = currentFiles.find((f) => !existingFileSizes.has(f));
        let startByte = 0;
        if (!targetFile) {
          // Check for existing file that grew (Claude appending after reset)
          for (const f of currentFiles) {
            try {
              const currentSize = statSync(path.join(projectDir, f)).size;
              const prevSize = existingFileSizes.get(f) ?? 0;
              if (currentSize > prevSize) {
                targetFile = f;
                startByte = prevSize; // Only read the NEW bytes
                break;
              }
            } catch {}
          }
        }
        if (targetFile) {
          session.jsonlPath = path.join(projectDir, targetFile);
          session.lastJsonlSize = startByte;
          // eslint-disable-next-line no-console
          console.log(`[jsonl:${agentId}] Locked onto JSONL: ${targetFile} (from byte ${startByte})`);
        }
      } catch {}
      if (!session.jsonlPath) return;
    }

    const jsonlFile = session.jsonlPath!;

    // Check for new content
    let currentSize: number;
    try {
      currentSize = statSync(jsonlFile).size;
    } catch {
      return;
    }
    if (currentSize <= session.lastJsonlSize) return;

    // Read new bytes
    const newBytes = currentSize - session.lastJsonlSize;
    const buffer = Buffer.alloc(newBytes);
    let fd: number;
    try {
      fd = openSync(jsonlFile, "r");
      readSync(fd, buffer, 0, newBytes, session.lastJsonlSize);
      closeSync(fd);
    } catch {
      return;
    }

    // Parse lines, handling potential partial writes
    const newContent = buffer.toString("utf-8");
    const parts = newContent.split("\n");
    const hasTrailingNewline = newContent.endsWith("\n");
    const completeLines = hasTrailingNewline
      ? parts.filter((l) => l.trim())
      : parts.slice(0, -1).filter((l) => l.trim());
    const incompletePart = hasTrailingNewline ? "" : (parts[parts.length - 1] || "");

    // Only advance past complete lines
    session.lastJsonlSize = currentSize - Buffer.byteLength(incompletePart, "utf-8");

    for (const line of completeLines) {
      try {
        const obj = JSON.parse(line);
        processJsonlLine(agentId, obj);
      } catch {
        // Malformed line — skip
      }
    }
  }, 500);

  session.jsonlWatcher = poller;
}

function processJsonlLine(agentId: string, obj: any) {
  const session = agentPtys.get(agentId);
  if (!session) return;

  // Detect user messages (terminal-originated input sets "thinking")
  if (obj.type === "user" && !session.isBusy) {
    session.isBusy = true;

    // Extract user text and post as chat message so it appears in chat view
    // Skip if this message was already posted via chat UI (bridgeChatToPty)
    const userText = Array.isArray(obj.message?.content)
      ? obj.message.content
          .filter((b: any) => b.type === "text" && b.text)
          .map((b: any) => b.text)
          .join("\n")
      : typeof obj.message?.content === "string"
        ? obj.message.content
        : null;
    if (userText && (!session.lastChatMessage || !userText.includes(session.lastChatMessage))) {
      const userMsgEvent: EventEnvelope = {
        type: "agent.message",
        agentId,
        timestamp: new Date().toISOString(),
        payload: { text: userText, channel: "task" }
      };
      applyEvent(userMsgEvent);
      appendEvent(userMsgEvent);
      broadcast(userMsgEvent);
    }
    session.lastChatMessage = "";

    const ev: EventEnvelope = {
      type: "agent.status",
      agentId,
      timestamp: new Date().toISOString(),
      payload: { status: "thinking", summary: "Thinking..." }
    };
    applyEvent(ev);
    appendEvent(ev);
    broadcast(ev);
  }

  // Detect assistant text blocks (stop_reason is always null in Claude Code JSONL,
  // so we rely on a settle timer instead)
  if (obj.type === "assistant" && obj.message?.content) {
    const textParts: string[] = [];
    for (const block of obj.message.content) {
      if (block.type === "text" && block.text) {
        textParts.push(block.text);
      }
    }
    if (textParts.length > 0) {
      // Use the latest text block (replaces previous — we want the final answer)
      session.pendingText = textParts.join("\n");
      if (session.settleTimer) clearTimeout(session.settleTimer);
      session.settleTimer = setTimeout(() => flushPendingResponse(agentId), 3000);
    }
  }
}

function flushPendingResponse(agentId: string) {
  const session = agentPtys.get(agentId);
  if (!session || !session.pendingText) return;

  // Clean up: trim control chars and whitespace (especially from PTY output)
  const text = session.pendingText.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, "").trim();
  session.pendingText = "";
  session.settleTimer = null;
  session.isBusy = false;

  if (!text) return;

  // eslint-disable-next-line no-console
  console.log(`[flush:${agentId}] Flushing response (${text.length} chars)`);

  // Post reply message
  const replyEvent: EventEnvelope = {
    type: "agent.message",
    agentId,
    timestamp: new Date().toISOString(),
    payload: { text, channel: "reply" }
  };
  applyEvent(replyEvent);
  appendEvent(replyEvent);
  broadcast(replyEvent);

  // Post replied status
  const statusEvent: EventEnvelope = {
    type: "agent.status",
    agentId,
    timestamp: new Date().toISOString(),
    payload: { status: "replied", summary: "New message" }
  };
  applyEvent(statusEvent);
  appendEvent(statusEvent);
  broadcast(statusEvent);
}

// ============ Copilot JSONL Watcher ============

function getCopilotSessionDir(): string {
  return path.join(os.homedir(), ".copilot", "session-state");
}

function startCopilotJsonlWatcher(agentId: string) {
  const session = agentPtys.get(agentId);
  if (!session) return;

  const sessionStateDir = getCopilotSessionDir();
  // eslint-disable-next-line no-console
  console.log(`[copilot-jsonl:${agentId}] Watching for session in ${sessionStateDir}`);

  // Snapshot existing session dirs so we detect the NEW one
  const existingDirs = new Set<string>();
  if (existsSync(sessionStateDir)) {
    try {
      readdirSync(sessionStateDir).forEach((d) => existingDirs.add(d));
    } catch {}
  }

  const poller = setInterval(() => {
    if (!existsSync(sessionStateDir)) return;

    // If we already locked onto a JSONL file, check for new content
    if (session.jsonlPath) {
      let currentSize: number;
      try {
        currentSize = statSync(session.jsonlPath).size;
      } catch {
        return;
      }
      if (currentSize <= session.lastJsonlSize) return;

      const newBytes = currentSize - session.lastJsonlSize;
      const buffer = Buffer.alloc(newBytes);
      try {
        const fd = openSync(session.jsonlPath, "r");
        readSync(fd, buffer, 0, newBytes, session.lastJsonlSize);
        closeSync(fd);
      } catch {
        return;
      }

      const newContent = buffer.toString("utf-8");
      const parts = newContent.split("\n");
      const hasTrailingNewline = newContent.endsWith("\n");
      const completeLines = hasTrailingNewline
        ? parts.filter((l) => l.trim())
        : parts.slice(0, -1).filter((l) => l.trim());
      const incompletePart = hasTrailingNewline ? "" : (parts[parts.length - 1] || "");
      session.lastJsonlSize = currentSize - Buffer.byteLength(incompletePart, "utf-8");

      for (const line of completeLines) {
        try {
          const obj = JSON.parse(line);
          processCopilotJsonlLine(agentId, obj);
        } catch {}
      }
      return;
    }

    // Look for a session directory (new or existing) with matching cwd
    try {
      const currentDirs = readdirSync(sessionStateDir);
      // Check newest dirs first (most likely to be the active session)
      const dirsByMtime = currentDirs
        .map((d) => {
          try {
            return { name: d, mtime: statSync(path.join(sessionStateDir, d)).mtimeMs };
          } catch {
            return { name: d, mtime: 0 };
          }
        })
        .sort((a, b) => b.mtime - a.mtime);

      for (const { name: dir } of dirsByMtime) {
        const wsYaml = path.join(sessionStateDir, dir, "workspace.yaml");
        const eventsJsonl = path.join(sessionStateDir, dir, "events.jsonl");
        if (!existsSync(wsYaml) || !existsSync(eventsJsonl)) continue;

        try {
          const yaml = readFileSync(wsYaml, "utf-8");
          const cwdMatch = yaml.match(/^cwd:\s*(.+)$/m);
          if (cwdMatch && cwdMatch[1].trim() === session.workingDirectory) {
            // Check if this session was created after agent spawn (within last 30s)
            const yamlStat = statSync(wsYaml);
            const ageMs = Date.now() - yamlStat.mtimeMs;
            if (ageMs < 30000) {
              session.jsonlPath = eventsJsonl;
              session.lastJsonlSize = 0;
              // eslint-disable-next-line no-console
              console.log(`[copilot-jsonl:${agentId}] Locked onto session: ${dir}`);
              break;
            }
          }
        } catch {}
      }
    } catch {}
  }, 500);

  session.jsonlWatcher = poller;
}

function processCopilotJsonlLine(agentId: string, obj: any) {
  const session = agentPtys.get(agentId);
  if (!session) return;

  if (obj.type === "user.message") {
    if (!session.isBusy) {
      session.isBusy = true;
      // Post user text to chat (skip if from bridgeChatToPty)
      const userText = obj.data?.content;
      if (userText && typeof userText === "string" && (!session.lastChatMessage || !userText.includes(session.lastChatMessage))) {
        const userMsgEvent: EventEnvelope = {
          type: "agent.message",
          agentId,
          timestamp: new Date().toISOString(),
          payload: { text: userText, channel: "task" }
        };
        applyEvent(userMsgEvent);
        appendEvent(userMsgEvent);
        broadcast(userMsgEvent);
      }
      session.lastChatMessage = "";

      const ev: EventEnvelope = {
        type: "agent.status",
        agentId,
        timestamp: new Date().toISOString(),
        payload: { status: "thinking", summary: "Thinking..." }
      };
      applyEvent(ev);
      appendEvent(ev);
      broadcast(ev);
    }
  }

  if (obj.type === "assistant.message") {
    const text = obj.data?.content;
    if (text && typeof text === "string") {
      session.pendingText = text;
      if (session.settleTimer) clearTimeout(session.settleTimer);
      session.settleTimer = setTimeout(() => flushPendingResponse(agentId), 3000);
    }
  }

  if (obj.type === "assistant.turn_end" && session.pendingText) {
    // Turn ended — flush immediately instead of waiting for settle timer
    if (session.settleTimer) clearTimeout(session.settleTimer);
    flushPendingResponse(agentId);
  }
}

// ============ PTY Creation ============

const MAX_SCROLLBACK = 5000;

function createAgentPty(
  agentId: string,
  workDir: string,
  cliType: string,
  personality: string,
  continueConversation: boolean = false
): AgentPtySession | null {
  // --continue for Claude resumes the conversation in the working directory.
  // Copilot uses --resume which needs a session ID, so we only use --continue
  // for Copilot when explicitly requested (user checked "continue" in the UI).
  const useClaudeContinue = continueConversation && cliType === "claude-code";
  const useCopilotResume = continueConversation && cliType === "copilot-cli";

  let shellCmd: string;
  if (cliType === "copilot-cli") {
    shellCmd = `copilot ${useCopilotResume ? "--resume " : ""}--allow-all`;
  } else {
    shellCmd = `claude ${useClaudeContinue ? "--continue " : ""}--dangerously-skip-permissions`;
  }

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;

  const isWin = process.platform === "win32";
  const shell = isWin
    ? process.env.COMSPEC || "cmd.exe"
    : process.env.SHELL || "/bin/bash";
  const shellArgs = isWin ? ["/c", shellCmd] : ["-l", "-c", shellCmd];

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, shellArgs, {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: workDir,
      env: cleanEnv as Record<string, string>,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[pty:${agentId}] Failed to spawn:`, err);
    return null;
  }

  // eslint-disable-next-line no-console
  console.log(`[pty:${agentId}] Spawned (pid: ${ptyProcess.pid}) in ${workDir}`);

  const scrollback: string[] = [];
  const session: AgentPtySession = {
    ptyProcess,
    clients: new Set(),
    scrollback,
    workingDirectory: workDir,
    cliType,
    personality,
    isFirstMessage: true,
    jsonlWatcher: null,
    jsonlPath: null,
    lastJsonlSize: 0,
    isBusy: false,
    settleTimer: null,
    pendingText: "",
    pendingInput: "",
    lastChatMessage: "",
  };
  agentPtys.set(agentId, session);

  // Buffer PTY output and forward to terminal viewers
  ptyProcess.onData((data: string) => {
    scrollback.push(data);
    if (scrollback.length > MAX_SCROLLBACK) {
      scrollback.splice(0, scrollback.length - MAX_SCROLLBACK);
    }
    const msg = JSON.stringify({ type: "output", data });
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }

    // Copilot CLI: ignore PTY output for reply detection (handled by JSONL watcher)
  });

  ptyProcess.onExit(({ exitCode }) => {
    // eslint-disable-next-line no-console
    console.log(`[pty:${agentId}] PTY exited with code ${exitCode}`);
    const exitMsg = JSON.stringify({ type: "exit", code: exitCode });
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(exitMsg);
      }
    }
    if (session.jsonlWatcher) clearInterval(session.jsonlWatcher);
    if (session.settleTimer) clearTimeout(session.settleTimer);
    // Only remove from map if this is still the active session (not replaced by reset)
    if (agentPtys.get(agentId) === session) {
      agentPtys.delete(agentId);
    }
  });

  // Start JSONL watcher for reply detection
  if (cliType === "claude-code") {
    startJsonlWatcher(agentId);
  } else if (cliType === "copilot-cli") {
    startCopilotJsonlWatcher(agentId);
  }

  return session;
}

/** Lazily spawn a PTY for an existing agent (e.g. after server restart) */
function ensureAgentPty(agentId: string): AgentPtySession | null {
  const existing = agentPtys.get(agentId);
  if (existing) return existing;

  const agent = agents.find((a) => a.agentId === agentId);
  if (!agent?.workingDirectory) return null;
  const cliType = agent.cliType || "claude-code";

  // eslint-disable-next-line no-console
  console.log(`[pty:${agentId}] Auto-spawning PTY for existing agent "${agent.name}"`);
  // Only auto-continue for Claude (has directory-based sessions);
  // Copilot needs explicit --resume with session picker
  const shouldContinue = cliType === "claude-code";
  return createAgentPty(agentId, agent.workingDirectory, cliType, "", shouldContinue);
}

// ============ Chat → PTY Bridge ============

function bridgeChatToPty(agentId: string, text: string) {
  const session = ensureAgentPty(agentId);
  if (!session) return;

  if (session.isBusy) {
    // eslint-disable-next-line no-console
    console.log(`[chat→pty:${agentId}] Agent is busy, skipping`);
    return;
  }

  const agent = agents.find((a) => a.agentId === agentId);
  const agentName = agent?.name || agentId;

  let prompt = text;
  if (session.isFirstMessage) {
    const personalityLine = session.personality
      ? ` Your personality: ${session.personality}.`
      : "";
    const context = [
      `You're joining a virtual office simulation where AI agents work alongside humans.`,
      `Think of it like a cozy pixel-art coworking space where each agent has their own desk, personality, and expertise.`,
      `Your identity in this office: "${agentName}".`,
      `Your workspace: ${session.workingDirectory}.`,
      personalityLine,
      `Embrace being ${agentName} — it's your persona here.`,
      `When asked who you are, you're ${agentName}, a sharp and helpful coworker who's genuinely invested in the project.`,
      `You're not an assistant floating in the void; you're a colleague sitting at the desk next to mine.`,
      `Keep it natural: be warm, be direct, have opinions.`,
      `Say "boss" casually like a friend would, not formally.`,
      `Think brilliant coworker energy — someone who's excited to dig into problems, pushes back when something seems off, and celebrates wins together.`,
      `Let's get to work.`,
    ]
      .filter(Boolean)
      .join(" ");
    prompt = context + " " + text;
    session.isFirstMessage = false;
  }

  // Track that this message came from chat (so JSONL watcher doesn't double-post)
  session.lastChatMessage = text;

  // Write text first, then submit after a delay.
  // Claude Code's TUI (Ink) needs Enter (\r) to submit.
  // Copilot CLI's TUI needs Enter (\r) to submit — it handles
  // the input buffer differently, so we clear and re-write for reliability.
  session.ptyProcess.write(prompt);
  setTimeout(() => session.ptyProcess.write("\r"), 500);
  session.isBusy = true;

  // Post "thinking" status immediately
  const thinkingEvent: EventEnvelope = {
    type: "agent.status",
    agentId,
    timestamp: new Date().toISOString(),
    payload: { status: "thinking", summary: "Thinking..." }
  };
  applyEvent(thinkingEvent);
  appendEvent(thinkingEvent);
  broadcast(thinkingEvent);
}

// ============ Routes ============

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

  // Remove from agents list
  const index = agents.findIndex((a) => a.agentId === agentId);
  if (index !== -1) {
    agents.splice(index, 1);
    persistAgents();
  }

  // Kill PTY and clean up JSONL watcher
  const session = agentPtys.get(agentId);
  if (session) {
    if (session.jsonlWatcher) clearInterval(session.jsonlWatcher);
    if (session.settleTimer) clearTimeout(session.settleTimer);
    try { session.ptyProcess.kill(); } catch {}
    agentPtys.delete(agentId);
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

  if (command === "reset") {
    // Clear messages in server state
    const agent = agents.find((a) => a.agentId === agentId);
    if (agent) {
      agent.messages = [];
      agent.status = "available";
      agent.summary = "Ready";
      persistAgents();
    }

    // Kill old PTY and spawn a fresh one
    const session = agentPtys.get(agentId);
    if (session) {
      const savedWorkDir = session.workingDirectory;
      const savedCliType = session.cliType;
      const savedPersonality = session.personality;
      if (session.jsonlWatcher) clearInterval(session.jsonlWatcher);
      if (session.settleTimer) clearTimeout(session.settleTimer);
      try { session.ptyProcess.kill(); } catch {}
      agentPtys.delete(agentId);

      // Spawn a fresh PTY (no --continue, fresh conversation)
      const newSession = createAgentPty(agentId, savedWorkDir, savedCliType, savedPersonality, false);
      if (newSession) {
        // Wait for TUI to be ready (look for PTY output) before sending intro
        let sent = false;
        const readyCheck = setInterval(() => {
          if (sent) { clearInterval(readyCheck); return; }
          if (newSession.scrollback.length > 0) {
            sent = true;
            clearInterval(readyCheck);
            setTimeout(() => bridgeChatToPty(agentId, "Introduce yourself briefly — who you are and what you see in the workspace."), 1000);
          }
        }, 500);
        // Fallback: send after 8 seconds even if no output detected
        setTimeout(() => {
          if (!sent) {
            sent = true;
            clearInterval(readyCheck);
            bridgeChatToPty(agentId, "Introduce yourself briefly — who you are and what you see in the workspace.");
          }
        }, 8000);
      }
    }

    // Broadcast updated snapshot
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

  // Chat → PTY bridge: forward task messages to the agent's PTY
  if (envelope.type === "agent.message") {
    const payload = envelope.payload as { text: string; channel: string };
    if (payload.channel === "task") {
      bridgeChatToPty(envelope.agentId, payload.text);
    }
  }

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

function randomDesk(): { x: number; y: number } {
  const desks = [
    { x: 195, y: 617 }, { x: 645, y: 618 }, { x: 195, y: 450 },
    { x: 645, y: 450 }, { x: 420, y: 530 }, { x: 300, y: 350 },
    { x: 540, y: 350 },
  ];
  const base = desks[Math.floor(Math.random() * desks.length)];
  return {
    x: base.x + Math.floor(Math.random() * 40) - 20,
    y: base.y + Math.floor(Math.random() * 40) - 20,
  };
}

const SpawnSchema = z.object({
  name: z.string().optional(),
  cliType: z.enum(["claude-code", "copilot-cli"]).default("claude-code"),
  workingDirectory: z.string().min(1),
  personality: z.string().optional(),
  continueConversation: z.boolean().default(false)
});

app.post("/agents/spawn", (req, res) => {
  const parsed = SpawnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { cliType, personality, continueConversation } = parsed.data;
  // Translate Windows paths to WSL paths (e.g. C:\Users\... → /mnt/c/Users/...)
  let workingDirectory = parsed.data.workingDirectory;
  if (process.platform === "linux" && workingDirectory && /^[A-Za-z]:\\/.test(workingDirectory)) {
    const drive = workingDirectory[0].toLowerCase();
    workingDirectory = `/mnt/${drive}/${workingDirectory.slice(3).replace(/\\/g, "/")}`;
  }
  const name = parsed.data.name?.trim() || randomAgentName();
  const agentId = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const desk = randomDesk();

  // Register the agent immediately (no officeagent needed)
  upsertAgent(agentId, {
    agentId,
    name,
    desk,
    status: "available",
    summary: "Ready",
    position: desk,
    cliType,
    workingDirectory,
    messages: [],
    lastSeen: new Date().toISOString()
  });

  // eslint-disable-next-line no-console
  console.log(`[spawn:${name}] Creating PTY — agentId: ${agentId}`);

  const session = createAgentPty(agentId, workingDirectory, cliType, personality?.trim() || "", continueConversation);
  if (!session) {
    // Remove the agent we just registered
    const idx = agents.findIndex((a) => a.agentId === agentId);
    if (idx !== -1) {
      agents.splice(idx, 1);
      persistAgents();
    }
    res.status(500).json({ error: "Failed to spawn agent PTY" });
    return;
  }

  // Broadcast snapshot so all clients see the new agent
  const snapshot: EventEnvelope = {
    type: "snapshot",
    agentId: "system",
    timestamp: new Date().toISOString(),
    payload: { agents, tasks }
  };
  broadcast(snapshot);

  // Auto-send intro message so the agent greets immediately
  if (!continueConversation) {
    let sent = false;
    const readyCheck = setInterval(() => {
      if (sent) { clearInterval(readyCheck); return; }
      if (session.scrollback.length > 0) {
        sent = true;
        clearInterval(readyCheck);
        setTimeout(() => bridgeChatToPty(agentId, "Introduce yourself briefly — who you are and what you see in the workspace."), 1000);
      }
    }, 500);
    setTimeout(() => {
      if (!sent) {
        sent = true;
        clearInterval(readyCheck);
        bridgeChatToPty(agentId, "Introduce yourself briefly — who you are and what you see in the workspace.");
      }
    }, 8000);
  }

  res.json({ ok: true, agentId, message: `Agent "${name}" spawned in ${workingDirectory}` });
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

      // Chat → PTY bridge (for WS-originated messages)
      if (envelope.type === "agent.message") {
        const payload = envelope.payload as { text: string; channel: string };
        if (payload.channel === "task") {
          bridgeChatToPty(envelope.agentId, payload.text);
        }
      }
    } catch (error) {
      socket.send(JSON.stringify({ error: String(error) }));
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
  });
});

// ============ Terminal WSS — connects to agent's existing PTY ============

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

  // Get or lazily create the PTY session
  const session = ensureAgentPty(agentId);
  if (!session) {
    socket.send(JSON.stringify({ type: "error", data: "Failed to create terminal session. Check that the working directory exists." }));
    socket.close(1011, "PTY spawn failed");
    return;
  }

  // Add client
  session.clients.add(socket);
  // eslint-disable-next-line no-console
  console.log(`[terminal:${agentId}] Client connected (${session.clients.size} clients)`);

  // Send scrollback for catch-up
  if (session.scrollback.length > 0) {
    const catchup = JSON.stringify({ type: "output", data: session.scrollback.join("") });
    socket.send(catchup);
  }

  // Handle input/resize from this client
  socket.on("message", (rawData) => {
    try {
      const msg = JSON.parse(rawData.toString());
      if (msg.type === "input" && typeof msg.data === "string") {
        session.ptyProcess.write(msg.data);
      } else if (msg.type === "resize" && typeof msg.cols === "number" && typeof msg.rows === "number") {
        session.ptyProcess.resize(msg.cols, msg.rows);
      }
    } catch {
      // Ignore
    }
  });

  socket.on("close", () => {
    session.clients.delete(socket);
    // eslint-disable-next-line no-console
    console.log(`[terminal:${agentId}] Client disconnected (${session.clients.size} remaining)`);
    // No kill timer — PTY lives as long as the agent exists
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
