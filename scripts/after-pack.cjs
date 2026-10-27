// electron-builder afterPack hook: ad-hoc sign the bundle. Renaming the Electron binary and editing
// Info.plist break Electron's own signature, and Apple Silicon refuses to run unsigned code.
// There is no Developer ID, so the signature is ad hoc ("-"), the same as install.sh produces.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // npm can drop the executable bit on node-pty's helper; without it every terminal fails to start.
  const prebuilds = path.join(app, 'Contents/Resources/app/node_modules/node-pty/prebuilds');
  for (const dir of fs.existsSync(prebuilds) ? fs.readdirSync(prebuilds) : []) {
    const helper = path.join(prebuilds, dir, 'spawn-helper');
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
