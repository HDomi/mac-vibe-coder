// Isolated Electron renderer checks. Uses fixture APIs and a temporary user profile; no real sessions.
const { app, BrowserWindow, session } = require('electron');
const { build } = require('esbuild');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
let temp, server, win;
let updateMode = 'disconnect';
let commits = 0;
let requestedA = false;
let usageFailed = true;
const errors = [];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = async (source) => {
  try { return await win.webContents.executeJavaScript(`(() => { const result = eval(${JSON.stringify(source)}); return typeof result === 'function' ? undefined : result; })()`, true); }
  catch (error) { console.error('Renderer check failed:', source, errors); throw error; }
};
async function until(source, attempts = 100) {
  for (let i = 0; i < attempts; i++) { if (await js(source)) return; await wait(50); }
  throw new Error(`UI condition timed out: ${source}`);
}

async function main() {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-ui-'));
  app.setPath('userData', path.join(temp, 'profile'));
  await fs.mkdir(path.join(temp, 'profile'));
  const entry = path.join(temp, 'entry.tsx');
  await fs.writeFile(entry, `
    import React from ${JSON.stringify(path.join(root, 'node_modules/react/index.js'))};
    import { createRoot } from ${JSON.stringify(path.join(root, 'node_modules/react-dom/client.js'))};
    import GitPanel from ${JSON.stringify(path.join(root, 'web/src/components/GitPanel.tsx'))};
    import { UpdateBadge } from ${JSON.stringify(path.join(root, 'web/src/components/UpdatePanel.tsx'))};
    import MarkdownView from ${JSON.stringify(path.join(root, 'web/src/components/MarkdownView.tsx'))};
    import UsageBar from ${JSON.stringify(path.join(root, 'web/src/components/UsageBar.tsx'))};
    import SessionCompanions from ${JSON.stringify(path.join(root, 'web/src/components/SessionCompanions.tsx'))};
    const target = createRoot(document.getElementById('root'));
    window.renderGit = cwd => target.render(<GitPanel cwd={cwd} visible />);
    window.renderUpdate = () => target.render(<UpdateBadge />);
    window.renderMarkdown = text => target.render(<MarkdownView text={text} baseDir="/fixture" />);
    window.renderUsage = () => target.render(<UsageBar mode="ide" onMode={() => {}} />);
    window.renderCompanions = (status = 'idle', scene = 'files') => {
      const sessions = [
        { id: 'claude-one', agent: 'claude', status, items: status === 'running' ? [{ kind: 'approval', decision: null }] : [] },
        { id: 'codex-one', agent: 'codex', status: 'idle', items: [] },
      ];
      target.render(<>
        <aside data-companion-zone="left" style={{ position: 'absolute', left: 0, top: 40, width: 180, height: 720, borderRight: '1px solid #555', overflowY: 'auto' }}>
          <div style={{ padding: 16 }}>Favorites</div>
          <div data-companion-floor="favorites-divider" style={{ marginTop: 100, borderTop: '1px solid #555' }}>Recent</div>
          <div style={{ height: 900 }} />
        </aside>
        <div data-companion-zone="prompt" style={{ position: 'absolute', left: 180, top: 40, width: 500, height: 720 }}>
          <button data-companion-floor="prompt" data-companion-ground="" style={{ position: 'absolute', left: 20, top: 610, width: 440, height: 90, border: '1px solid #555', borderRadius: 12 }}
            onClick={() => window.companionClicks = (window.companionClicks || 0) + 1}>Prompt input</button>
        </div>
        <aside data-companion-zone="right" style={{ position: 'absolute', left: 680, top: 40, width: 360, height: 720, borderLeft: '1px solid #555' }}>
          <div data-companion-floor={scene + '-toolbar'} style={{ marginTop: scene === 'git' ? 400 : 260, borderTop: '1px solid #555' }}>{scene} toolbar</div>
          <table style={{ position: 'absolute', left: 0, top: 480, width: 360, borderCollapse: 'collapse' }}><tbody>
            {[0, 1, 2, 3, 4].map((i) => <tr key={i} data-companion-rung="" style={{ height: 30, borderBottom: '1px solid #555' }}><td>file-{i}.ts</td></tr>)}
          </tbody></table>
          <div data-companion-floor="hidden-tab" style={{ visibility: 'hidden', marginTop: 10 }}>Hidden tab</div>
        </aside>
        <SessionCompanions sessions={sessions} scene={scene} />
      </>);
    };
    window.addEventListener('error', event => console.error(event.message));
  `);
  await build({ entryPoints: [entry], outfile: path.join(temp, 'harness.js'), bundle: true, platform: 'browser', jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')] });
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  const css = (await fs.readdir(path.join(root, 'web/dist/assets'))).find((name) => name.endsWith('.css'));
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://fixture');
      const cwd = url.searchParams.get('cwd');
      const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root" style="height:760px;width:440px"></div><script>localStorage.setItem("vibe.lang","en")</script><script src="/harness.js"></script></body></html>'); return; }
      if (url.pathname === '/harness.js' || url.pathname === '/style.css') {
        res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
        res.end(await fs.readFile(url.pathname.endsWith('.js') ? path.join(temp, 'harness.js') : path.join(root, 'web/dist/assets', css))); return;
      }
      if (url.pathname === '/api/git/status') {
        if (cwd === '/a') { requestedA = true; await wait(350); }
        json({ repo: true, root: cwd, branch: cwd === '/a' ? 'branch-A' : 'branch-B', ahead: 0, behind: 0, files: [
          { path: 'one.txt', index: 'A', worktree: ' ', staged: true, untracked: false },
          { path: 'two.txt', index: ' ', worktree: 'M', staged: false, untracked: false },
        ] }); return;
      }
      if (url.pathname === '/api/git/branches') { if (cwd === '/a') await wait(350); json([{ name: cwd === '/a' ? 'branch-A' : 'branch-B', current: true, remote: false }]); return; }
      if (url.pathname === '/api/git/log') {
        if (cwd === '/a') await wait(350);
        json({ commits: [
          { hash: 'merge', parents: ['main', 'feature'], refs: ['HEAD -> branch-B', 'tag: v0.3.16'], subject: cwd === '/a' ? 'wrong-project-A' : 'Merge feature', author: 'Developer', date: 'just now' },
          { hash: 'feature', parents: ['main'], refs: ['feature'], subject: 'Feature work', author: 'Developer', date: '1 minute ago' },
          { hash: 'main', parents: [], refs: [], subject: 'Initial commit', author: 'Developer', date: '2 minutes ago' },
        ], hasMore: false }); return;
      }
      if (url.pathname === '/api/git/diff') { const one = url.searchParams.get('path') === 'one.txt'; await wait(one ? 250 : 10); res.end(one ? 'OLD_DIFF' : 'CURRENT_DIFF'); return; }
      if (url.pathname === '/api/git/commit') { commits++; await wait(150); json({ ok: true, output: 'commit created' }); return; }
      if (url.pathname === '/api/git/checkout') { json({ ok: true, output: 'branch created' }); return; }
      if (url.pathname === '/api/update/status') { json({ installed: { version: '0.3.15', commit: 'old' }, remote: { version: '0.3.16', commit: 'new' }, branch: 'main', available: true, commits: [], error: null }); return; }
      if (url.pathname === '/api/usage') { json({ fetchedAt: Date.now(), claude: usageFailed ? null : { fiveHour: { usedPct: 0, resetsAt: null }, weekly: { usedPct: 10, resetsAt: null }, model: null, plan: null }, codex: { fiveHour: { usedPct: 1, resetsAt: null }, weekly: null, plan: null }, errors: usageFailed ? ['claude: HTTP 429'] : [] }); return; }
      if (url.pathname === '/api/tools') { json({ tools: [{ id: 'claude', name: 'Claude', installed: false }, { id: 'codex', name: 'Codex', installed: false }], installers: {} }); return; }
      if (url.pathname === '/api/update/apply') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write('event: start\ndata: fixture update\n\n');
        if (updateMode === 'restart') res.write('event: restart\ndata: 75\n\n');
        setTimeout(() => res.end(), 30); return;
      }
      json({ ok: true });
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  win = new BrowserWindow({ show: false, width: 480, height: 820, webPreferences: { sandbox: true, contextIsolation: true } });
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await js(`renderGit('/a')`);
  for (let i = 0; i < 100 && !requestedA; i++) await wait(10);
  assert.ok(requestedA);
  await js(`renderGit('/b')`);
  await until(`document.body.textContent.includes('Merge feature')`);
  await wait(450);
  assert.equal(await js(`document.body.textContent.includes('wrong-project-A') || document.body.textContent.includes('branch-A')`), false);
  await js(`Array.from(document.querySelectorAll('span')).find(e => e.textContent === 'one.txt').click()`);
  await js(`Array.from(document.querySelectorAll('span')).find(e => e.textContent === 'two.txt').click()`);
  await until(`document.body.textContent.includes('CURRENT_DIFF')`);
  await wait(300);
  assert.equal(await js(`document.body.textContent.includes('OLD_DIFF')`), false);
  await js(`const select = document.querySelector('select'); select.value = '__new__'; select.dispatchEvent(new Event('change', {bubbles:true}));`);
  await until(`!!document.querySelector('form input')`);
  await js(`const field = document.querySelector('form input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'feature/test'); field.dispatchEvent(new Event('input',{bubbles:true}));`);
  await js(`document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
  await until(`document.body.textContent.includes('branch created')`);
  await js(`const field = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'test commit'); field.dispatchEvent(new Event('input',{bubbles:true}));`);
  await js(`const field = document.querySelector('textarea'); field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true,bubbles:true})); field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',metaKey:true,bubbles:true}));`);
  await until(`document.body.textContent.includes('commit created')`);
  assert.equal(commits, 1);
  await js(`Array.from(document.querySelectorAll('button')).find(e => e.textContent.includes('Close')).click()`);
  await wait(50);
  const screenshot = path.join(os.tmpdir(), 'mac-vibe-git-reviewed.png');
  await fs.writeFile(screenshot, (await win.webContents.capturePage()).toPNG());

  await js(`renderMarkdown('<iframe srcdoc="test"></iframe>\\n\\n![private](https://evil.example/private)')`);
  await until(`!!document.querySelector('button')`);
  assert.equal(await js(`!!document.querySelector('iframe, img')`), false);
  await js(`renderUpdate()`);
  await until(`document.body.textContent.includes('0.3.16')`);
  await js(`document.querySelector('button').click()`);
  await until(`Array.from(document.querySelectorAll('button')).some(e => e.textContent.trim() === 'Apply update')`);
  await js(`Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Apply update').click()`);
  await until(`document.body.textContent.includes('Update connection lost')`);
  assert.equal(await js(`document.querySelector('[data-update-locked]').dataset.updateLocked`), 'false');
  updateMode = 'restart';
  await js(`window.originalNow = Date.now; window.originalFetch = window.fetch; window.fetch = (...args) => { if (String(args[0]).includes('/api/health')) { Date.now = () => originalNow() + 130001; return Promise.resolve({ok:false}); } return originalFetch(...args); }; const later = window.setTimeout; window.setTimeout = (fn,delay,...args) => later(fn,delay === 2000 ? 5 : delay,...args);`);
  await js(`Array.from(document.querySelectorAll('button')).find(e => e.textContent.trim() === 'Apply update').click()`);
  await until(`document.body.textContent.includes('Server did not restart')`);
  assert.equal(await js(`document.querySelector('[data-update-locked]').dataset.updateLocked`), 'false');
  await js(`renderUsage()`);
  await until(`!!document.querySelector('[aria-label*="HTTP 429"]')`);
  assert.equal(await js(`document.body.textContent.includes('Claude') && document.querySelector('[aria-label*="HTTP 429"]').textContent.includes('—')`), true);
  usageFailed = false;
  await js(`document.querySelector('button[title="Refresh usage"]').click()`);
  await until(`!!document.querySelector('[aria-label^="5h: 0% used"]')`);
  assert.equal(await js(`document.querySelector('[aria-label^="5h: 0% used"]').textContent.includes('100%')`), true);
  win.setSize(1100, 820);
  // Math.random fixed at .1 keeps both figures idle (short rests) so positions are deterministic.
  await js(`window.originalRandom = Math.random; Math.random = () => .1; renderCompanions()`);
  await until(`document.querySelectorAll('.session-companion').length === 2 && [...document.querySelectorAll('.session-companion')].every(e => e.style.visibility === 'visible')`);
  const firstPosition = await js(`document.querySelector('.session-companion').style.transform`);
  await wait(1200);
  assert.equal(await js(`document.querySelector('.session-companion').style.transform`), firstPosition);
  assert.equal(await js(`Math.round(document.querySelector('.session-companion').getBoundingClientRect().width * 10)`), 370);
  assert.equal(await js(`getComputedStyle(document.querySelector('.session-companions')).pointerEvents`), 'none');
  assert.equal(await js(`const r = document.querySelector('[data-companion-floor="prompt"]').getBoundingClientRect(); document.elementFromPoint(r.x + 20, r.y + 20).click(); window.companionClicks`), 1);
  const FOOT = 54 * .77, HALF = 24 * .77;
  async function dragCompanion(agent, x, feetY) {
    const start = await js(`const r = document.querySelector('[data-agent="${agent}"]').getBoundingClientRect(); ({x:Math.round(r.x+r.width/2), y:Math.round(r.y+14)})`);
    win.webContents.sendInputEvent({type:'mouseMove', ...start});
    win.webContents.sendInputEvent({type:'mouseDown', ...start, button:'left', clickCount:1});
    await until(`document.querySelector('[data-agent="${agent}"]').dataset.travel === 'drag'`);
    win.webContents.sendInputEvent({type:'mouseMove', x:Math.round(x), y:Math.round(feetY - FOOT + 14)});
    await until(`document.querySelector('[data-agent="${agent}"]').dataset.pose === 'drag'`);
    win.webContents.sendInputEvent({type:'mouseUp', x:Math.round(x), y:Math.round(feetY - FOOT + 14), button:'left', clickCount:1});
    await until(`document.querySelector('[data-agent="${agent}"]').dataset.travel === 'rest'`);
  }
  // Dropping into the right panel lands on its toolbar; a tab switch removes it and the figure falls onto the new one.
  await dragCompanion('claude', 820, 280);
  assert.equal(await js(`document.querySelector('[data-agent="claude"]').dataset.zone`), 'right');
  assert.equal(await js(`document.querySelector('[data-agent="claude"]').dataset.floor`), 'files-toolbar');
  await js(`renderCompanions('idle', 'git')`);
  await until(`document.querySelector('[data-agent="claude"]').dataset.travel === 'fall'`);
  await until(`document.querySelector('[data-agent="claude"]').dataset.travel === 'rest' && document.querySelector('[data-agent="claude"]').dataset.floor === 'git-toolbar'`);
  await js(`renderCompanions('running', 'git')`);
  await until(`document.querySelector('[data-agent="claude"]').dataset.travel === 'rest'`);
  assert.equal(await js(`document.querySelector('[data-agent="claude"]').dataset.floor`), 'git-toolbar');
  // Ladder: dropping onto a file row lands on that rung.
  await dragCompanion('claude', 760, 530);
  assert.equal(await js(`document.querySelector('[data-agent="claude"]').dataset.floor`), 'rung:0');
  // Back to the prompt; the figure follows the prompt box when the layout moves.
  await dragCompanion('claude', 420, 640);
  assert.equal(await js(`document.querySelector('[data-agent="claude"]').dataset.floor`), 'prompt');
  await js(`document.querySelector('[data-companion-floor="prompt"]').style.top = '540px'`);
  await until(`Math.abs(new DOMMatrixReadOnly(document.querySelector('[data-agent="claude"]').style.transform).m42 - ${580 - FOOT}) < 1`);
  const claudeX = await js(`new DOMMatrixReadOnly(document.querySelector('[data-agent="claude"]').style.transform).m41 + ${HALF}`);
  await dragCompanion('codex', claudeX + 30, 570);
  await until(`[...document.querySelectorAll('.session-companion')].every(e => ['fight', 'punch', 'kick', 'block', 'hit', 'down'].includes(e.dataset.pose))`);
  // Blows are hit-box tested: with Math.random fixed both throw punches, so both take hits.
  await until(`[...document.querySelectorAll('.session-companion')].every(e => Number(e.dataset.hits) > 0)`, 200);
  await until(`[...document.querySelectorAll('.session-companion')].every(e => e.dataset.travel === 'rest' && !['fight', 'punch', 'kick', 'block', 'hit', 'down'].includes(e.dataset.pose))`, 300);
  // Rifle ambush: with Math.random .98 a figure draws a rifle at the peer on another platform, tilts the barrel, fires three tracer rounds and the target collapses.
  await dragCompanion('codex', 760, 530);
  assert.equal(await js(`document.querySelector('[data-agent="codex"]').dataset.floor`), 'rung:0');
  await js(`Math.random = () => .98`);
  await until(`document.querySelector('[data-pose="aim"]')`, 300);
  assert.match(await js(`(document.querySelector('.session-companion:is([data-pose="aim"], [data-pose="shoot"]) .companion-rifle') || {getAttribute: () => ''}).getAttribute('transform') || ''`), /rotate\(-?\d/);
  await until(`document.querySelector('.companion-tracer') && document.querySelector('.companion-spark')`, 100);
  await until(`document.querySelector('[data-pose="shoot"] .companion-flash').getAttribute('d')`, 100);
  await until(`document.querySelector('[data-pose="down"]')`, 100);
  await js(`Math.random = () => .1`);
  await until(`[...document.querySelectorAll('.session-companion')].every(e => e.dataset.travel === 'rest')`, 400);
  assert.equal(await js(`document.querySelectorAll('.companion-tracer, .companion-spark').length`), 0);
  await dragCompanion('codex', 90, 170);
  assert.equal(await js(`document.querySelector('[data-agent="codex"]').dataset.floor`), 'favorites-divider');
  const beforeScroll = await js(`new DOMMatrixReadOnly(document.querySelector('[data-agent="codex"]').style.transform).m42`);
  await js(`document.querySelector('[data-companion-zone="left"]').scrollTop = 20`);
  await until(`Math.abs(new DOMMatrixReadOnly(document.querySelector('[data-agent="codex"]').style.transform).m42 - ${beforeScroll - 20}) < 1`);
  // A click hurts: the figure recoils, then flees along its floor.
  await until(`document.querySelector('[data-agent="codex"]').dataset.travel === 'rest'`);
  const codexSpot = await js(`const r = document.querySelector('[data-agent="codex"]').getBoundingClientRect(); ({x:Math.round(r.x+r.width/2), y:Math.round(r.y+14)})`);
  win.webContents.sendInputEvent({type:'mouseMove', ...codexSpot});
  win.webContents.sendInputEvent({type:'mouseDown', ...codexSpot, button:'left', clickCount:1});
  win.webContents.sendInputEvent({type:'mouseUp', ...codexSpot, button:'left', clickCount:1});
  await until(`document.querySelector('[data-agent="codex"]').dataset.pose === 'hurt'`);
  await until(`document.querySelector('[data-agent="codex"]').dataset.pose === 'flee'`);
  await until(`document.querySelector('[data-agent="codex"]').dataset.travel === 'rest'`);
  assert.equal(await js(`document.querySelector('[data-agent="codex"]').dataset.floor`), 'favorites-divider');
  // Walking: Math.random .5 picks a stroll; the stride animates.
  await js(`Math.random = () => .5`);
  await until(`document.querySelector('[data-agent="codex"]').dataset.pose === 'walk'`, 400);
  const step = await js(`document.querySelector('[data-agent="codex"] .companion-body').children[1].getAttribute('d')`);
  await wait(200);
  assert.notEqual(await js(`document.querySelector('[data-agent="codex"] .companion-body').children[1].getAttribute('d')`), step);
  // Walls: Math.random .3 walks claude to the prompt panel's left wall, where it knocks, climbs over and drops onto the left panel's floor.
  await dragCompanion('claude', 420, 560);
  assert.equal(await js(`document.querySelector('[data-agent="claude"]').dataset.floor`), 'prompt');
  await js(`renderCompanions('idle', 'git'); Math.random = () => .3`);
  await until(`document.querySelector('[data-agent="claude"]').dataset.pose === 'knock'`, 600);
  await until(`document.querySelector('[data-agent="claude"]').dataset.travel === 'climb'`, 200);
  await until(`document.querySelector('[data-agent="claude"]').dataset.travel === 'rest' && document.querySelector('[data-agent="claude"]').dataset.floor === 'ground:left'`, 200);
  assert.equal(await js(`document.querySelector('[data-agent="claude"]').dataset.zone`), 'left');
  const companionScreenshot = path.join(os.tmpdir(), 'mac-vibe-companions.png');
  await fs.writeFile(companionScreenshot, (await win.webContents.capturePage()).toPNG());
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await until(`getComputedStyle(document.querySelector('.session-companions')).display === 'none'`);
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await until(`document.querySelector('[data-agent="claude"]').style.visibility === 'visible'`);
  win.webContents.debugger.detach();
  await js(`renderCompanions('closed', 'git')`);
  await until(`document.querySelectorAll('.session-companion').length === 1 && !document.querySelector('[data-agent="claude"]')`);
  await js(`Math.random = originalRandom; renderUsage()`);
  await until(`!document.querySelector('.session-companions')`);
  assert.deepEqual(errors, []);
  console.log(`UI checks passed: project/diff races, branch creation, duplicate commit, markdown safety, update disconnect and restart timeout, usage failure and zero usage, companion idle timing, 77% size, drag/drop, tab fall, ladder rungs, hit-box sparring, cross-platform rifle ambush with tracers, click flee, wall knock and crossing, click-through, layout changes, reduced motion and cleanup. Screenshots: ${screenshot}, ${companionScreenshot}`);
}

async function finish(code) {
  win?.destroy();
  server?.closeAllConnections();
  server?.close();
  if (temp) await fs.rm(temp, { recursive: true, force: true });
  app.exit(code);
}
main().then(() => finish(0)).catch((error) => { console.error(error); void finish(1); });
