# TODO — World Clock CLI

## Remaining Tasks

- [x] **Parse `--zone` flag** — Accept `--zone America/Los_Angeles` to show a specific timezone. Support multiple `--zone` flags.
- [x] **Parse `--all` flag** — Show all IANA timezones grouped by region (Americas, Europe, Asia, etc.)
- [ ] **Add more default zones** — Sydney, Dubai, São Paulo, Los Angeles, Paris
- [ ] **Add `--format` flag** — Support `--format 24h` for 24-hour time display
- [ ] **Add `--live` flag** — Clear screen and refresh every second (like `watch`)
- [ ] **Add emoji flags** — Show country flag emoji next to each timezone (🇺🇸 🇬🇧 🇯🇵)
- [x] **Error handling** — Graceful error for invalid timezone names
- [ ] **Add `--json` flag** — Output as JSON for scripting
