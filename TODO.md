# TODO - Publish Checklist

## Critical (Must Have)

- [ ] Add `.gitignore`
  - `node_modules/`
  - `data/*.json`, `data/*.jsonl`
  - `.DS_Store`
  - `dist/`
  - `.env`

- [ ] Remove personal files before publishing
  - `testApp/` folder
  - `PixelSpaces Free Pack.zip`
  - `cli-bridge.config.json` (has personal paths)
  - Any downloaded sprite zips in `data/`

- [ ] Make URLs configurable via environment variables
  - `apps/web/src/main.ts` has hardcoded `localhost:3003`
  - Consider `VITE_SERVER_URL` env var

- [ ] Add LICENSE file (MIT recommended)

- [ ] Add screenshot/GIF to README
  - Record the office with agents chatting
  - Show the chat panel in action

## Important (Should Have)

- [ ] Add setup script
  - `npm run setup` that creates `data/` folder
  - Copies example configs

- [ ] Example config files
  - `cli-bridge.config.example.json`

- [ ] Better error messages
  - When Claude CLI not installed
  - When Copilot CLI not installed
  - When server not running

- [ ] Add `CONTRIBUTING.md`

## Nice to Have

- [ ] Add player movement speed setting (for slower machines)
- [ ] Make clock in game working (show real time)
- [ ] Docker setup for easy deployment
- [ ] Hosted demo (deploy web UI somewhere)
- [ ] More character sprites (currently only 5)
- [ ] Basic tests for server endpoints
- [ ] TypeScript strict mode / clean up `any` types
- [ ] Sound effects for status changes
- [ ] Keyboard shortcut to cycle between agents
- [ ] Agent activity log/history view

## Chat UX

- [x] Auto-scroll chat to bottom on new messages
- [ ] Make chat panel larger
- [ ] Multiline text input for chat
- [ ] Thinking icon / loader in chat while agent is processing

## Agent Management

- [ ] Ability to open Claude Code or GitHub Copilot CLI directly from agent
- [ ] Build "Add Agent" form into the app more natively. walk up somewhere and do it
- [x] Number keys (1-9) to jump directly into chat with an agent

## Windows Support

- [ ] Support both `\` and `/` slashes for file paths

## Cleanup

- [ ] Decide: keep or remove `apps/cli-bridge/`?
  - Currently using `officeagent` instead
  - cli-bridge was the original approach

- [ ] Audit `data/` folder
  - Move sprite source files elsewhere
  - Keep only runtime-generated data here

- [ ] Update HUD title from "Office Sprite World" to "Office Agent World"
