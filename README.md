<div align="center">

![AIOffice](demo/banner.svg)

**You're the boss. Claude and Copilot are your employees.**
**Give them desks, assign them work, and watch them build — in a pixel-art office.**

<img src="demo/hero.gif" alt="AIOffice — walk around, chat with AI agents, watch them code" width="100%">

[Getting Started](#try-it-now) · [Features](#features) · [CLI](#cli) · [Architecture](docs/ARCHITECTURE.md)

</div>

---

## Try it now

```bash
git clone https://github.com/ChristianFJung/AIOffice
cd AIOffice
npm i
officeagent demo
```

<img src="demo/demo.gif" alt="officeagent demo — CLI detection and agent spawning" width="600">

> Open **http://localhost:3000** — your office is ready. Walk around, assign tasks, be the boss.

## Features

- 🏢 **Your office** — a walkable pixel-art map where each agent gets a desk
- 🤖 **Real AI agents** — Claude Code and Copilot CLI, doing real work
- 💬 **Walk up and chat** — talk to any agent like an NPC
- 🖥️ **Terminal view** — peek over their shoulder and see what they're typing
- 🔄 **Hire and fire** — spawn, reset, and delete agents on the fly
- 🎵 **Vibes** — lo-fi office background music
- ⌨️ **CLI tool** — script your whole team from the terminal

## How It Works

Each agent is a real CLI process (Claude Code or Copilot) running in a PTY. The server watches JSONL output for responses, bridges messages over WebSocket, and Phaser renders it all as a cozy pixel-art office. See [Architecture →](docs/ARCHITECTURE.md)

## CLI

```bash
officeagent start                        # Launch the office
officeagent spawn                        # Add a Claude agent
officeagent spawn -n "Bob" -c copilot    # Named Copilot agent
officeagent demo                         # Auto-detect CLIs, full demo
```

## Adding Agents

**From the UI** — click **+**, fill in name, CLI type, working directory, and personality.

<img src="demo/spawn.gif" alt="Spawning a new agent into the office" width="100%">

**From the terminal:**
```bash
officeagent spawn --name "Alice" --dir ~/projects/myapp --cli copilot
```

## Controls

| Key | Action |
|-----|--------|
| `WASD` / `Arrows` | Move around |
| `E` / `Enter` | Chat with nearby agent |
| `Esc` / `Space` | Close panel |
| `Tab` | Switch Chat ↔ Terminal |

## Requirements

- **Node.js 18+**
- At least one AI CLI:
  [Claude Code](https://docs.anthropic.com/en/docs/claude-code) ·
  [GitHub Copilot CLI](https://docs.github.com/copilot/github-copilot-in-the-cli)

## Development

```bash
npm install
npm run dev:server    # API + WebSocket on :3003
npm run dev:web       # Phaser app on :3000
npm test              # 22 Playwright integration tests
```

<details>
<summary>Project structure</summary>

```
aioffice/
├── apps/
│   ├── web/           # Phaser 3 game + UI (Vite + TypeScript)
│   ├── server/        # Express server, PTY management, JSONL bridge
│   └── officeagent/   # CLI tool (start, spawn, demo)
├── shared/            # Shared types and schemas
├── demo/              # Demo projects for agents to work on
├── tests/             # Playwright integration tests
└── docs/              # Architecture docs
```

</details>

---

## CLI Reference

### `officeagent start`

Launch the server and web app.

```bash
officeagent start              # Start both server (:3003) and web (:3000)
officeagent start --server-only  # Server only
officeagent start --web-only     # Web app only
```

### `officeagent spawn`

Spawn an AI agent into the office.

```bash
officeagent spawn                                          # Claude agent, random name
officeagent spawn --name "Alice" --cli copilot             # Named Copilot agent
officeagent spawn -n "Bob" -d ~/projects/myapp             # Custom working directory
officeagent spawn -n "Grumpy" -p "Sarcastic senior dev"    # With personality
officeagent spawn --continue                               # Resume previous conversation
```

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--name` | `-n` | Agent display name | Random |
| `--cli` | `-c` | `claude` or `copilot` | `claude` |
| `--dir` | `-d` | Working directory | Current dir |
| `--personality` | `-p` | Personality description | None |
| `--continue` | | Resume previous conversation | `false` |
| `--server` | `-s` | Server URL | `http://localhost:3003` |

### `officeagent demo`

One command to see everything. Detects which AI CLIs you have installed and spawns agents into demo projects.

```bash
officeagent demo    # Auto-detect CLIs, start world, spawn agents
```

| You have installed | What happens |
|---|---|
| Claude + Copilot | One of each, different demo projects |
| Only Claude | Two Claude agents |
| Only Copilot | Two Copilot agents |
| Neither | Error with install links |

---

<div align="center">

[Attribution](ATTRIBUTION.md) · MIT [License](LICENSE)

</div>
