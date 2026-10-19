// Render the vector master with Chromium; no additional image dependencies needed.
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'web/public');
  const svg = readFileSync(path.join(output, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({
    width: 1024, height: 1024, useContentSize: true, show: false,
    transparent: true, frame: false, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
  const capture = await win.webContents.capturePage();
  if (capture.isEmpty() || capture.getSize().width !== capture.getSize().height) {
    throw new Error(`Expected a square icon render, received ${JSON.stringify(capture.getSize())}`);
  }
  const image = capture.resize({ width: 1024, height: 1024 });
  writeFileSync(path.join(output, 'icon.png'), image.toPNG());
  writeFileSync(path.join(output, 'apple-touch-icon.png'), image.resize({ width: 180, height: 180 }).toPNG());
  if (process.platform === 'darwin') {
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'mac-vibe-icons-'));
    try {
      const iconset = path.join(temporary, 'app.iconset');
      mkdirSync(iconset);
      for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) {
          const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
          writeFileSync(path.join(iconset, name), image.resize({ width: size * scale, height: size * scale }).toPNG());
        }
      }
      mkdirSync(path.join(root, 'assets'), { recursive: true });
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'assets/icon.icns')]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
