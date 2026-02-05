# Setting Up `officeagent` on Windows

This guide documents how to install and configure the `officeagent` CLI command on Windows.

## Prerequisites

- Node.js 18+
- Git Bash (recommended) or PowerShell
- GitHub Copilot CLI or Claude Code CLI installed

## Installation Steps

### 1. Install Dependencies

From the project root:

```bash
npm install
```

### 2. Build the officeagent Package

```bash
npm --workspace apps/officeagent run build
```

This compiles TypeScript to `apps/officeagent/dist/index.js`.

### 3. Link Globally

```bash
cd apps/officeagent
npm link
```

This registers `officeagent` as a global command. You can now run it from any directory.

### 4. Verify Installation

```bash
officeagent --help
```

## Windows-Specific Fixes

### Issue 1: `ENOENT` Error When Spawning CLI

**Problem:** On Windows, Node.js `spawn()` couldn't find `copilot` or `claude` commands.

**Solution:** Added `shell: true` to the spawn options:

```typescript
const child = spawn(fullCommand, [], {
  cwd: this.workingDirectory,
  env: { ...process.env, CI: "true", TERM: "xterm-256color" },
  stdio: ["ignore", "pipe", "pipe"],
  shell: true, // Required for Windows to find CLI commands
});
```

### Issue 2: "Too Many Arguments" Error

**Problem:** When using `shell: true`, passing the prompt as a separate argument caused shell parsing issues with special characters.

**Solution:** Changed from array-based arguments to a single shell command string:

**Before (broken on Windows):**
```typescript
const args = ["-p", prompt, "--allow-all", "--silent"];
spawn(command, args, { shell: true });
```

**After (works on all platforms):**
```typescript
const escapedPrompt = prompt
  .replace(/\\/g, '\\\\')     // Escape backslashes first
  .replace(/"/g, '\\"')        // Escape double quotes
  .replace(/\n/g, ' ')         // Replace newlines with spaces
  .replace(/\r/g, '')          // Remove carriage returns
  .replace(/`/g, '\\`')        // Escape backticks
  .replace(/\$/g, '\\$');      // Escape dollar signs

const fullCommand = `copilot -p "${escapedPrompt}" --allow-all --silent`;
spawn(fullCommand, [], { shell: true });
```

This handles paths with spaces like `C:\Users\name\OneDrive - Microsoft\...`.

## Git Bash Tips

When using Git Bash on Windows:

- Use forward slashes: `/c/Users/...` instead of `C:\Users\...`
- The backslash `\` is an escape character in bash
- Use `//` for Windows-style flags: `taskkill //F //PID 1234`

## Troubleshooting

### Command Not Found After Linking

If `officeagent` isn't recognized after `npm link`:

1. Check if npm's global bin is in your PATH:
   ```bash
   npm config get prefix
   ```
2. Add `<prefix>/bin` to your PATH

### Rebuilding After Code Changes

If you modify the source code:

```bash
# From project root
npm --workspace apps/officeagent run build

# Then re-link
cd apps/officeagent
npm link
```

### Checking What's Installed

```bash
# See where officeagent points to
which officeagent

# Or on PowerShell
Get-Command officeagent
```

## Performance Note

Using `shell: true` adds ~10-50ms startup overhead per CLI call. This is negligible compared to the 5-60 seconds typical response time from AI CLIs.

## Cross-Platform Compatibility

These changes work on macOS and Linux too:
- `shell: true` uses `/bin/sh` on Unix, `cmd.exe` on Windows
- Quote escaping (`\"`) is standard across both shells
