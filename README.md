<div align="center">

![AIOffice](demo/banner.svg)

**You're the boss. Claude and Copilot are your employees.**
**Give them desks, assign them work, and watch them build — in a pixel-art office.**

https://github.com/user-attachments/assets/8083f778-1ab3-4c74-b1f4-34611d50191d

[Getting Started](#try-it-now) · [Features](#features) · [CLI](#cli) · [Architecture](docs/ARCHITECTURE.md)

</div>

---

## Try it now

```bash
git clone https://github.com/ChristianFJung/AIOffice
cd AIOffice
npm i
npx officeagent demo
```

> **Windows:** Support is still in development. For best results, use macOS or Linux. WSL works but may have issues with chat bridging.

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
- 🔒 **100% local** — Runs Claude Code or Copilot CLI on your machine

## Why?

I started running multiple AI coding agents in parallel and quickly hit a wall — terminal tabs don't scale past 3. I needed a way to see all my agents at once, remember who's doing what, and manage them without losing my mind. So I built an office for them.

## How It Works

 Each agent is a real CLI process (Claude Code or Copilot CLI) running in a PTY on your computer. The server watches JSONL output for responses, bridges messages over WebSocket, and Phaser renders it all as a cozy pixel-art office. Your existing CLI auth handles everything.

See [Architecture →](docs/ARCHITECTURE.md)

## CLI

```bash
npx officeagent start                        # Launch the office
npx officeagent spawn                        # Add a Claude agent
npx officeagent spawn -n "Bob" -c copilot    # Named Copilot agent
npx officeagent demo                         # Auto-detect CLIs, full demo
```

## Adding Agents

**From the UI** — click **+**, fill in name, CLI type, working directory, and personality.

<img src="demo/spawn.gif" alt="Spawning a new agent into the office" width="100%">

**From the terminal:**
```bash
# Claude agent in current directory
npx officeagent spawn

# Named Copilot agent working on your project
npx officeagent spawn --name "Alice" --dir ~/projects/myapp --cli copilot

# Give them a personality
npx officeagent spawn -n "Grumpy Gary" -p "Sarcastic senior dev who's seen it all"

# Resume a previous conversation
npx officeagent spawn -n "Alice" -d ~/projects/myapp --continue
```

## Controls

| Key | Action |
|-----|--------|
| `WASD` / `Arrows` | Move around |
| `E` | Chat with nearby agent |
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
npx officeagent start              # Start both server (:3003) and web (:3000)
npx officeagent start --server-only  # Server only
npx officeagent start --web-only     # Web app only
```

### `officeagent spawn`

Spawn an AI agent into the office.

```bash
npx officeagent spawn                                          # Claude agent, random name
npx officeagent spawn --name "Alice" --cli copilot             # Named Copilot agent
npx officeagent spawn -n "Bob" -d ~/projects/myapp             # Custom working directory
npx officeagent spawn -n "Grumpy" -p "Sarcastic senior dev"    # With personality
npx officeagent spawn --continue                               # Resume previous conversation
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
npx officeagent demo    # Auto-detect CLIs, start world, spawn agents
```

| You have installed | What happens |
|---|---|
| Claude + Copilot | One of each, different demo projects |
| Only Claude | Two Claude agents |
| Only Copilot | Two Copilot agents |
| Neither | Error with install links |

## Acknowledgements

- **[2dPig](https://2dpig.itch.io/pixel-office)** — for the beautiful Pixel Office tileset (CC0). The cozy office vibe is all thanks to your pixel art 🐷
- **[AI Town](https://github.com/a16z-infra/ai-town)** by a16z — for the inspiration. Their virtual town of AI characters sparked the idea of bringing that concept to a dev workflow
- The **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** team at Anthropic — for building an incredible CLI that makes this whole thing possible
- The **[GitHub Copilot CLI](https://docs.github.com/copilot/github-copilot-in-the-cli)** team — for pushing the boundaries of AI-assisted development in the terminal

> **Disclaimer:** AIOffice is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Anthropic, GitHub, or any of their products. Claude Code and GitHub Copilot CLI are trademarks of their respective owners.

---

<div align="center">

[Attribution](ATTRIBUTION.md) · MIT [License](LICENSE)

</div>
