# CLI Spec — `officeagent`

> CLI for AIOffice

---

## USAGE

```
officeagent <command> [options]
```

If no recognized command is given, all arguments are forwarded to `spawn` (backwards compatibility).

---

## Subcommands

### `officeagent start`

Launch the AIOffice server and/or web app.

```
officeagent start [options]
```

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--server-only` | — | boolean | `false` | Only start the server (port 3003) |
| `--web-only` | — | boolean | `false` | Only start the web app (port 3000) |
| `--help` | `-h` | boolean | — | Show help for this command |

With no flags, starts **both** the server and web app. Runs until `Ctrl-C` (SIGINT/SIGTERM), then sends SIGTERM to child processes and exits.

---

### `officeagent spawn`

Spawn an AI agent into the world via the running server.

```
officeagent spawn [options]
```

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--name` | `-n` | string | _(random)_ | Agent display name |
| `--cli` | `-c` | string | `claude-code` | CLI backend: `claude` or `copilot` |
| `--personality` | `-p` | string | _(none)_ | Personality description for the agent |
| `--dir` | `-d` | string | `cwd` | Working directory for the agent |
| `--continue` | — | boolean | `false` | Resume a previous conversation |
| `--server` | `-s` | string | `http://localhost:3003` | Server URL to spawn against |
| `--help` | `-h` | boolean | — | Show help for this command |

Sends a `POST /agents/spawn` request to the server. Prints the spawned agent's ID, name, CLI type, and working directory on success.

---

### `officeagent demo`

Launch a full demo: starts the server + web app, detects installed AI CLIs, and spawns two agents into demo projects.

```
officeagent demo [options]
```

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--help` | `-h` | boolean | — | Show help for this command |

**Auto-detection logic:**

| Claude installed | Copilot installed | Agents spawned |
|:---:|:---:|---|
| ✅ | ✅ | Claude → `demo/todo-api`, Copilot → `demo/world-clock` |
| ✅ | ❌ | Claude-1 → `demo/todo-api`, Claude-2 → `demo/world-clock` |
| ❌ | ✅ | Copilot-1 → `demo/todo-api`, Copilot-2 → `demo/world-clock` |
| ❌ | ❌ | Error — exit 1 |

Waits up to 30 s for the server to become healthy before spawning agents.

---

## Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show top-level help (command list) |

`--version` is not currently implemented. Passing an unknown command falls back to `spawn` with all args forwarded.

---

## I/O Contract

| Channel | Content |
|---------|---------|
| **stdout** | Help text, progress banners (emoji-prefixed), spawn confirmations (agent ID, name, CLI, dir) |
| **stderr** | Error messages (`❌` prefixed), fatal errors (`Fatal: …`) |

Child process output (server, web app) is inherited to the parent's stdio in `start`; suppressed (`"ignore"`) in `demo`.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success / graceful shutdown via SIGINT |
| `1` | Runtime failure — server spawn error, HTTP error, missing CLI (demo), or unhandled exception |
| `2` | _(reserved — invalid usage; not yet distinguished from 1)_ |

---

## Env / Config

No environment variables are read directly. All configuration is via flags.

| Setting | Flag | Default |
|---------|------|---------|
| Server URL | `--server` / `-s` (spawn only) | `http://localhost:3003` |
| Server port | — (hardcoded) | `3003` |
| Web app port | — (hardcoded) | `3000` |

Server and web app are started via `npm run dev:server` and `npm run dev:web` from the monorepo root.

---

## Examples

```bash
# Start both server and web app
officeagent start

# Start only the server
officeagent start --server-only

# Start only the web frontend
officeagent start --web-only

# Spawn an agent with a random name using Claude (default)
officeagent spawn

# Spawn a named agent in a specific project directory
officeagent spawn --name "Bob" --dir ~/projects/myapp

# Spawn a Copilot-backed agent
officeagent spawn -n "Alice" -c copilot

# Spawn an agent with a custom personality
officeagent spawn -n "Grumpy" -p "Sarcastic senior dev"

# Resume a previous agent conversation
officeagent spawn --name "Bob" --continue

# Spawn against a remote server
officeagent spawn -n "Remote" -s https://office.example.com

# Run the full demo (auto-detects CLIs, spawns two agents)
officeagent demo
```
