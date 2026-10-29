// Quit the installed bundle and wait for its server before changing executable files on disk.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  const [bundle, root] = process.argv.slice(2);
  if (!bundle || !root) throw new Error('App bundle and checkout path required');
  if (fs.existsSync(bundle)) {
    const script = ['on run argv', 'set appPath to item 1 of argv', 'if application appPath is running then tell application appPath to quit', 'end run'];
    execFileSync('osascript', [...script.flatMap((line) => ['-e', line]), '--', bundle], { timeout: 10000 });
  }
  const executable = path.join(bundle, 'Contents/MacOS/Vibrato');
  const server = path.join(root, 'dist/server/index.js');
  const deadline = Date.now() + 15000;
  while (true) {
    const processes = execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n');
    if (!processes.some((line) => line.includes(executable) || line.includes(server))) return;
    if (Date.now() >= deadline) throw new Error('App or server is still running. Stop it before installing or updating.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
