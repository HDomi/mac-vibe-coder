import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duplicate, FsError, homeInfo, listDir, mkdir, rawFile, readText, rename, resolvePath, statPath, transfer, trash } from './fs.js';
import { loadConfig, saveConfig } from './config.js';
import { streamSSE } from 'hono/streaming';
import { detectTools, INSTALL_COMMANDS, UPDATE_COMMANDS, type InstallMethod, type ToolId } from './tools.js';
import { streamShell } from './shell.js';
import { getUsage } from './usage.js';
import { saveAttachment } from './attachments.js';
import { listSessions, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { SessionRegistry } from './sessions.js';
import { previewKind } from './mime.js';
import { listCodexModels, listCodexThreads } from './agents/codex.js';
import { listClaudeModels } from './agents/claude.js';
import { which, run } from './shell.js';
import { applyUpdate, checkUpdate, RESTART_EXIT_CODE } from './updater.js';
import { gitBranches, gitCheckout, gitCommit, gitDiff, gitLog, gitRemoteOp, gitStage, gitStatus } from './git.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/server/app.js -> ../../web/dist ; server/app.ts (tsx) -> ../web/dist
const WEB_DIST = path.resolve(__dirname, __dirname.includes(`${path.sep}dist${path.sep}`) ? '../../web/dist' : '../web/dist');

export function createApp(registry?: SessionRegistry) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof FsError) {
      return c.json({ error: err.message, code: err.code }, err.status as 400);
    }
    console.error(err);
    return c.json({ error: err.message ?? 'Internal error', code: 'INTERNAL' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true, version: process.env.npm_package_version ?? 'dev' }));
  app.get('/api/home', async (c) => c.json(await homeInfo()));

  app.get('/api/fs/list', async (c) => c.json(await listDir(c.req.query('path') ?? '~')));
  app.get('/api/fs/stat', async (c) => c.json(await statPath(c.req.query('path') ?? '~')));
  app.get('/api/fs/text', async (c) => {
    const p = c.req.query('path');
    if (!p) return c.json({ error: 'path required', code: 'BAD_REQUEST' }, 400);
    return c.json(await readText(p));
  });
  app.get('/api/fs/raw', async (c) => {
    const p = c.req.query('path');
    if (!p) return c.json({ error: 'path required', code: 'BAD_REQUEST' }, 400);
    const res = await rawFile(p, c.req.header('range'));
    return new Response(res.body, { status: res.status, headers: res.headers });
  });

  app.post('/api/fs/mkdir', async (c) => { const b = await c.req.json<{ dir: string; name: string }>(); return c.json({ path: await mkdir(b.dir, b.name) }); });
  app.post('/api/fs/rename', async (c) => { const b = await c.req.json<{ path: string; name: string }>(); return c.json({ path: await rename(b.path, b.name) }); });
  app.post('/api/fs/copy', async (c) => { const b = await c.req.json<{ paths: string[]; dest: string }>(); return c.json({ paths: await transfer(b.paths, b.dest, false) }); });
  app.post('/api/fs/move', async (c) => { const b = await c.req.json<{ paths: string[]; dest: string }>(); return c.json({ paths: await transfer(b.paths, b.dest, true) }); });
  app.post('/api/fs/duplicate', async (c) => { const b = await c.req.json<{ path: string }>(); return c.json({ path: await duplicate(b.path) }); });
  app.post('/api/fs/trash', async (c) => { const b = await c.req.json<{ paths: string[] }>(); await trash(b.paths); return c.json({ ok: true }); });

  const favPayload = (cfg: { favorites: unknown; groups: unknown }) => ({ favorites: cfg.favorites, groups: cfg.groups });
  app.get('/api/favorites', async (c) => c.json(favPayload(await loadConfig())));
  app.patch('/api/favorites', async (c) => {
    const body = await c.req.json<{ path: string; name?: string; group?: string | null }>();
    const abs = resolvePath(body.path);
    const cfg = await loadConfig();
    cfg.favorites = cfg.favorites.map((f) => {
      if (f.path !== abs) return f;
      const next = { ...f };
      if (typeof body.name === 'string' && body.name.trim()) next.name = body.name.trim();
      if (body.group === null) delete next.group;
      else if (typeof body.group === 'string' && cfg.groups.some((g) => g.id === body.group)) next.group = body.group;
      return next;
    });
    await saveConfig(cfg);
    return c.json(favPayload(cfg));
  });
  app.post('/api/favorites/groups', async (c) => {
    const body = await c.req.json<{ name: string }>();
    const cfg = await loadConfig();
    const id = `g${Date.now().toString(36)}`;
    cfg.groups.push({ id, name: body.name.trim() || 'Group' });
    await saveConfig(cfg);
    return c.json(favPayload(cfg));
  });
  app.patch('/api/favorites/groups', async (c) => {
    const body = await c.req.json<{ id: string; name?: string; collapsed?: boolean }>();
    const cfg = await loadConfig();
    cfg.groups = cfg.groups.map((g) => (g.id === body.id ? { ...g, ...(body.name?.trim() ? { name: body.name.trim() } : {}), ...(typeof body.collapsed === 'boolean' ? { collapsed: body.collapsed } : {}) } : g));
    await saveConfig(cfg);
    return c.json(favPayload(cfg));
  });
  app.delete('/api/favorites/groups', async (c) => {
    const id = c.req.query('id') ?? '';
    const cfg = await loadConfig();
    cfg.groups = cfg.groups.filter((g) => g.id !== id);
    cfg.favorites = cfg.favorites.map((f) => (f.group === id ? { path: f.path, name: f.name } : f));
    await saveConfig(cfg);
    return c.json(favPayload(cfg));
  });
  app.post('/api/favorites', async (c) => {
    const body = await c.req.json<{ path: string; name?: string }>();
    const abs = resolvePath(body.path);
    const st = await statPath(abs);
    if (!st.isDir) return c.json({ error: 'Not a directory', code: 'ENOTDIR' }, 400);
    const cfg = await loadConfig();
    if (!cfg.favorites.some((f) => f.path === abs)) {
      cfg.favorites.push({ path: abs, name: body.name?.trim() || path.basename(abs) || abs });
      await saveConfig(cfg);
    }
    return c.json(favPayload(cfg));
  });
  app.delete('/api/favorites', async (c) => {
    const p = resolvePath(c.req.query('path') ?? '');
    const cfg = await loadConfig();
    cfg.favorites = cfg.favorites.filter((f) => f.path !== p);
    await saveConfig(cfg);
    return c.json(favPayload(cfg));
  });

  app.get('/api/recent', async (c) => c.json((await loadConfig()).recent));
  app.delete('/api/recent', async (c) => {
    const p = resolvePath(c.req.query('path') ?? '');
    const cfg = await loadConfig();
    cfg.recent = cfg.recent.filter((r) => r !== p);
    await saveConfig(cfg);
    return c.json(cfg.recent);
  });
  app.post('/api/recent', async (c) => {
    const body = await c.req.json<{ path: string }>();
    const abs = resolvePath(body.path);
    const cfg = await loadConfig();
    cfg.recent = [abs, ...cfg.recent.filter((r) => r !== abs)].slice(0, 20);
    await saveConfig(cfg);
    return c.json(cfg.recent);
  });

  app.get('/api/tools', async (c) => c.json(await detectTools()));
  app.get('/api/tools/install', (c) => {
    const tool = c.req.query('tool') as ToolId;
    const method = c.req.query('method') as InstallMethod | 'update';
    const cmd = method === 'update' ? UPDATE_COMMANDS[tool] : INSTALL_COMMANDS[tool]?.[method];
    if (!cmd) return c.json({ error: 'unknown tool/method', code: 'BAD_REQUEST' }, 400);
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'start', data: cmd });
      const code = await streamShell(cmd, (line, src) => {
        void stream.writeSSE({ event: src, data: line });
      });
      await stream.writeSSE({ event: 'done', data: String(code) });
    });
  });

  app.get('/api/usage', async (c) => c.json(await getUsage(c.req.query('force') === '1')));

  app.post('/api/attach', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const files = ([] as unknown[]).concat(body['files'] ?? body['file'] ?? []).filter((f): f is File => f instanceof File);
    const saved = [];
    for (const f of files) {
      const p = await saveAttachment(f);
      const ext = path.extname(p);
      saved.push({ path: p, name: f.name, kind: previewKind(ext, f.name) === 'image' ? 'image' : 'file', mime: f.type || undefined });
    }
    return c.json(saved);
  });

  // Claude Code transcript history for a project directory.
  app.get('/api/history', async (c) => {
    const dir = resolvePath(c.req.query('cwd') ?? '~');
    if (c.req.query('agent') === 'codex') {
      const codexPath = await which('codex');
      if (!codexPath) return c.json([]);
      return c.json(await listCodexThreads(codexPath, dir));
    }
    const sessions = await listSessions({ dir, limit: 30 });
    return c.json(sessions);
  });
  app.get('/api/history/:id', async (c) => {
    const dir = resolvePath(c.req.query('cwd') ?? '~');
    const messages = await getSessionMessages(c.req.param('id'), { dir });
    return c.json(messages);
  });

  // Recent sessions across every project (sidebar).
  app.get('/api/history-all', async (c) => {
    const [claude, codexPath] = await Promise.all([listSessions({ limit: 15 }).catch(() => []), which('codex')]);
    const codex = codexPath ? await listCodexThreads(codexPath, null).catch(() => []) : [];
    const rows = [
      ...claude.map((s) => ({ agent: 'claude' as const, sessionId: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || s.sessionId, cwd: (s as { cwd?: string }).cwd ?? null, lastModified: s.lastModified })),
      ...codex.map((s) => ({ agent: 'codex' as const, sessionId: s.sessionId, title: s.summary || s.sessionId, cwd: s.cwd ?? null, lastModified: s.lastModified })),
    ].sort((a, b) => b.lastModified - a.lastModified).slice(0, 20);
    return c.json(rows);
  });

  app.get('/api/models', async (c) => {
    if (c.req.query('agent') === 'codex') {
      const codexPath = await which('codex');
      return c.json(codexPath ? await listCodexModels(codexPath).catch(() => []) : []);
    }
    const claudePath = await which('claude');
    return c.json(claudePath ? await listClaudeModels(claudePath).catch(() => []) : []);
  });

  app.get('/api/sessions', (c) => c.json(registry?.list() ?? []));

  // Open a folder in the native Terminal / iTerm / Finder / VS Code.
  app.post('/api/open', async (c) => {
    const body = await c.req.json<{ path: string; app?: 'terminal' | 'iterm' | 'finder' | 'vscode'; command?: string }>();
    const abs = resolvePath(body.path);
    const dirQ = abs.replace(/"/g, '\\"');
    const cmd = body.command ? body.command.replace(/"/g, '\\"') : '';
    const target = body.app ?? 'terminal';
    let r;
    if (target === 'finder') r = await run('open', [abs]);
    else if (target === 'vscode') r = await run('open', ['-a', 'Visual Studio Code', abs]);
    else if (target === 'iterm') {
      r = await run('osascript', ['-e', 'tell application "iTerm" to activate', '-e', 'tell application "iTerm" to create window with default profile',
        '-e', `tell application "iTerm" to tell current session of current window to write text "cd \"${dirQ}\"${cmd ? ' && ' + cmd : ''}"`]);
    } else {
      r = await run('osascript', ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script "cd \"${dirQ}\"${cmd ? ' && ' + cmd : ''}"`]);
    }
    if (!r.ok) return c.json({ error: r.stderr, code: 'OPEN_FAILED' }, 500);
    return c.json({ ok: true });
  });

  // Git panel.
  app.get('/api/git/status', async (c) => c.json(await gitStatus(c.req.query('cwd') ?? '~')));
  app.get('/api/git/diff', async (c) => c.text(await gitDiff(c.req.query('cwd') ?? '~', c.req.query('path') ?? '', c.req.query('staged') === '1')));
  app.get('/api/git/log', async (c) => c.json(await gitLog(c.req.query('cwd') ?? '~')));
  app.post('/api/git/stage', async (c) => {
    const b = await c.req.json<{ cwd: string; paths: string[]; action: 'add' | 'reset' | 'discard' }>();
    await gitStage(b.cwd, b.paths, b.action);
    return c.json({ ok: true });
  });
  app.get('/api/git/branches', async (c) => c.json(await gitBranches(c.req.query('cwd') ?? '~')));
  app.post('/api/git/checkout', async (c) => {
    const b = await c.req.json<{ cwd: string; branch: string; create?: boolean }>();
    return c.json(await gitCheckout(b.cwd, b.branch, Boolean(b.create)));
  });
  app.post('/api/git/remote', async (c) => {
    const b = await c.req.json<{ cwd: string; op: 'fetch' | 'pull' | 'push' }>();
    return c.json(await gitRemoteOp(b.cwd, b.op));
  });
  app.post('/api/git/commit', async (c) => {
    const b = await c.req.json<{ cwd: string; message: string }>();
    return c.json(await gitCommit(b.cwd, b.message));
  });

  // Self-update from the git remote.
  app.get('/api/update/status', async (c) => c.json(await checkUpdate(c.req.query('force') === '1')));
  app.get('/api/update/apply', (c) => streamSSE(c, async (stream) => {
    if (registry && registry.list().length > 0 && c.req.query('force') !== '1') {
      await stream.writeSSE({ event: 'stderr', data: 'Active sessions exist; update deferred. Close them or force.' });
      await stream.writeSSE({ event: 'done', data: '1' });
      return;
    }
    await stream.writeSSE({ event: 'start', data: 'git pull --ff-only && npm ci && npm run build' });
    const code = await applyUpdate((line, src) => { void stream.writeSSE({ event: src, data: line }); });
    await stream.writeSSE({ event: 'done', data: String(code) });
    if (code === 0) {
      await stream.writeSSE({ event: 'restart', data: String(RESTART_EXIT_CODE) });
      setTimeout(() => process.exit(RESTART_EXIT_CODE), 800);
    }
  }));
  app.post('/api/restart', (c) => { setTimeout(() => process.exit(RESTART_EXIT_CODE), 300); return c.json({ ok: true }); });

  // Static SPA (production build)
  const root = path.relative(process.cwd(), WEB_DIST) || '.';
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));

  return app;
}
