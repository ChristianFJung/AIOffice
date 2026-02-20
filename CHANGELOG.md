# Changelog — AIOffice

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2025-02-20

### Added
- Pixel-art virtual office with walkable tilemap (Phaser 3)
- Player character with WASD/arrow movement and collision
- Agent spawning via UI modal (+ button) and CLI
- Support for Claude Code and GitHub Copilot CLI agents
- Real-time chat bridged through PTY + JSONL file watching
- Built-in terminal view per agent (xterm.js)
- Agent reset (+ button) and delete (× button)
- Auto-intro message when agents spawn
- Typing indicators and status colors on NPC sprites
- Real-time clock overlay on the office desk
- Background music with play/pause toggle
- Tab memory (chat/terminal mode persists across panel open/close)
- `officeagent` CLI tool with `start`, `spawn`, and `demo` commands
- Smart CLI detection in `demo` command (detects claude/copilot)
- Two demo projects: todo-api (spec only) and world-clock (partially built)
- 22 Playwright integration tests (agent + CLI)
- MIT license and asset attribution

### Fixed
- PTY onExit race condition on agent reset
- JSONL watcher detecting existing file growth (not just new files)
- WASD/space keys captured by Phaser when typing in chat/modal
- Stuck movement keys after closing chat panel
