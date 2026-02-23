const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const linkDir = path.join(__dirname, '..', 'node_modules', '.bin');

// Bash wrapper (Mac/Linux)
const target = path.join(__dirname, '..', 'bin', 'officeagent');
const link = path.join(linkDir, 'officeagent');

// Cmd wrapper (Windows)
const targetCmd = path.join(__dirname, '..', 'bin', 'officeagent.cmd');
const linkCmd = path.join(linkDir, 'officeagent.cmd');

try {
  fs.mkdirSync(linkDir, { recursive: true });
  try { fs.unlinkSync(link); } catch (e) {}
  try { fs.unlinkSync(linkCmd); } catch (e) {}
  fs.symlinkSync(target, link);
  fs.symlinkSync(targetCmd, linkCmd);
} catch (e) {
  // Symlinks may require admin on Windows — not fatal
}

// Fix node-pty spawn-helper permissions (npm sometimes strips +x)
if (!isWin) {
  const { execSync } = require('child_process');
  try {
    execSync('chmod +x node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true');
  } catch (e) {}
}
