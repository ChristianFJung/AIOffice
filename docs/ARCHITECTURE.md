# Architecture

## Overview

AIOffice is a monorepo with three apps that work together:

```
┌──────────────────────────────────────────────────────┐
│              Web App (Phaser 3 + Vite)               │
│          http://localhost:3000                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  Phaser   │  │  Chat    │  │  Terminal         │   │
│  │  Scene    │  │  Panel   │  │  (xterm.js)       │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└──────────────────────┬───────────────────────────────┘
                       │ WebSocket
                       ▼
┌──────────────────────────────────────────────────────┐
│              Server (Express + WS)                   │
│          http://localhost:3003                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │  REST     │  │  PTY     │  │  JSONL            │   │
│  │  Routes   │  │  Manager │  │  Watcher          │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└──────────────────────┬───────────────────────────────┘
                       │ PTY (node-pty)
              ┌────────┴────────┐
              ▼                 ▼
        Claude Code       Copilot CLI
```

## Server (`apps/server/src/index.ts`)

Single-file Express server. Key responsibilities:

### REST Endpoints
- `GET /agents` — List all agents with status
- `POST /agents/spawn` — Create agent + PTY + start CLI process
- `POST /agents/:id/chat` — Send message to agent's PTY
- `POST /agents/:id/reset` — Kill PTY, respawn fresh
- `DELETE /agents/:id` — Kill PTY, remove agent

### PTY Management
Each agent gets a `node-pty` pseudo-terminal running the CLI:
- **Claude Code:** `claude --dangerously-skip-permissions` (interactive mode)
- **Copilot CLI:** `copilot` (interactive mode)

Messages are written to PTY stdin. PTY stdout feeds the terminal WebSocket.

### JSONL Watcher
Claude Code writes assistant responses to `~/.claude/projects/<hash>/` as JSONL files. The server watches these directories:
- Detects new files AND existing files that grow
- Parses `assistant` type entries for the response text
- Broadcasts parsed messages via WebSocket

### WebSocket Events
- `agents-update` — Full agent list (status, messages, positions)
- `chat` — Chat message from/to agent
- `status` — Agent status change (available, thinking, has-reply, error)
- `/terminal/:id` — Raw PTY I/O for xterm.js

## Web App (`apps/web/src/`)

### `game.ts` — Phaser Scene
- Loads pixel-art tilemap and character sprites
- Player movement (WASD/arrows) with collision
- NPC sprites positioned at desks, typing indicators
- Clock overlay covering static "12:00" with real-time display
- Selection indicator (yellow rectangle) around nearby agents

### `main.ts` — UI Layer
- Panel system: chat mode and terminal mode (tab memory)
- Chat input with message history
- Agent spawn modal
- Keyboard locking (prevents game input when typing)
- Audio controls
- WebSocket connection management

## CLI (`apps/officeagent/src/index.ts`)

Thin wrapper around the server API:
- `start` — Spawns `dev:server` and `dev:web` as child processes
- `spawn` — HTTP POST to `/agents/spawn`
- `demo` — Starts world + auto-detects CLIs + spawns agents into demo projects

## Data Flow: Sending a Chat Message

```
User types in chat input
    → main.ts sends WebSocket "chat" event
    → Server receives, writes message to PTY stdin
    → CLI processes the message
    → Claude writes response to JSONL file
    → JSONL watcher detects file growth
    → Server parses new JSONL content
    → Server broadcasts "chat" event via WebSocket
    → main.ts displays message in chat panel
    → game.ts shows typing indicator on NPC sprite
```

## Data Flow: Agent Spawn

```
User clicks + or runs officeagent spawn
    → POST /agents/spawn with name, cliType, workingDirectory
    → Server assigns desk position + random appearance
    → Server creates PTY (node-pty) with CLI command
    → Server starts JSONL watcher for Claude agents
    → Server waits for PTY output (smart intro timing)
    → Server sends intro message to CLI
    → Server broadcasts agents-update via WebSocket
    → Web app creates NPC sprite at assigned desk
```
