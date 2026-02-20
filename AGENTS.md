# AGENTS.md — AI Agent Instructions

> Read this first if you're an AI agent entering this codebase.

## Project Overview

**AIOffice** — A pixel-art virtual office where AI coding agents (Claude Code, GitHub Copilot CLI) work at desks. Users walk around, chat with agents, and watch them build software in real-time.

**Tech stack:** TypeScript, Phaser 3, Express, node-pty, WebSocket, Vite, Playwright

## Essential Commands

```bash
npm install                # Install all dependencies
npm run dev:server         # Start server on :3003
npm run dev:web            # Start web app on :3000
npm test                   # Run all Playwright tests (22 tests, needs server running)
npm run demo               # Launch full demo with auto-detected agents
```

Both `dev:server` and `dev:web` must be running for the app to work.

## Architecture

```
apps/
├── server/src/index.ts    # Express + WebSocket server, PTY management, JSONL bridge
├── web/src/
│   ├── game.ts            # Phaser scene: map, player, NPCs, clock overlay
│   ├── main.ts            # UI: panels, chat, terminal, keyboard, agent management
│   └── style.css          # All styling
├── officeagent/src/
│   └── index.ts           # CLI tool: start, spawn, demo commands
shared/
├── types.ts               # Shared TypeScript types (Agent, Message, etc.)
demo/
├── todo-api/              # Demo: REST API spec for agents to build
├── world-clock/           # Demo: partially built CLI for agents to finish
tests/
├── agents.spec.ts         # 16 agent integration tests
├── cli.spec.ts            # 6 CLI tests
```

### Key Data Flow

1. **Spawn:** HTTP POST `/agents/spawn` → server creates PTY → runs `claude` or `copilot` CLI
2. **Chat in:** WebSocket `chat` event → server writes to PTY stdin
3. **Chat out:** Server watches JSONL files in `~/.claude/projects/` → parses assistant messages → broadcasts via WebSocket
4. **Terminal:** WebSocket `/terminal/:id` → raw PTY I/O (xterm.js in browser)

## Coding Conventions

- TypeScript throughout (no linter configured yet)
- No classes for game logic — Phaser scene methods + module-level functions
- Tests use Playwright's `request` context for API testing (no browser needed for agent tests)
- `workers: 1` in Playwright config — tests run sequentially to avoid interference
- Each test uses unique timestamped directories to avoid JSONL accumulation

## Testing

```bash
# Start server first
npm run dev:server &
npm run dev:web &

# Run tests
npm test
```

Tests cover: agent spawning (both CLI types), auto-intro, chat round-trip, reset, delete, terminal WebSocket, CLI commands, edge cases.

## What NOT To Do

- ⚠️ Don't modify `~/.claude/projects/` or agent PTY sessions directly
- ⚠️ Don't delete `data/` contents at runtime — the server manages runtime state
- ⚠️ Don't run multiple test suites in parallel — they share the server
- ⚠️ Don't hardcode absolute paths — use relative paths from repo root
