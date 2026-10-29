import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const home = mkdtempSync(join(tmpdir(), 'vibrato-home-'));
process.env.VIBRATO_AGENT_HOME = home;
process.env.CODEX_HOME = join(home, '.codex');

test('agent context: docs, skills, hooks and MCP from project and user level', async () => {
  const { agentContext, codexMcp, skillMeta } = await import('../server/agentContext');
  const proj = mkdtempSync(join(tmpdir(), 'vibrato-proj-'));
  try {
    writeFileSync(join(proj, 'CLAUDE.md'), '# rules\n');
    mkdirSync(join(proj, '.claude', 'skills', 'deploy'), { recursive: true });
    writeFileSync(join(proj, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: "Ship it"\n---\nbody');
    writeFileSync(join(proj, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier -w' }] }] } }));
    writeFileSync(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'npx', args: ['db-mcp'] } } }));
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "x"\n\n[mcp_servers.figma]\nurl = "https://f.example/mcp"\n\n[mcp_servers."local-fs"]\ncommand = "node"\nargs = ["fs.js", "--root"]\n');
    const ctx = await agentContext(proj);
    assert.deepEqual(ctx.docs.map((d) => [d.scope, d.agent, d.exists]), [['project', 'claude', true], ['project', 'codex', false], ['user', 'claude', false], ['user', 'codex', false]]);
    assert.equal(ctx.docs[0].content, '# rules\n');
    assert.deepEqual(ctx.skills.map((s) => [s.name, s.description]), [['deploy', 'Ship it']]);
    assert.deepEqual(ctx.hooks.map((h) => [h.event, h.matcher, h.command]), [['PostToolUse', 'Edit', 'prettier -w']]);
    assert.deepEqual(ctx.mcp.map((m) => [m.agent, m.name, m.command]), [['claude', 'db', 'npx db-mcp'], ['codex', 'figma', 'http https://f.example/mcp'], ['codex', 'local-fs', 'node fs.js --root']]);
    assert.deepEqual(codexMcp('', 'f'), []);
    assert.deepEqual(skillMeta('no front matter'), {});
    assert.deepEqual(skillMeta('---\nname: sweet\ndescription: >\n  Short and\n  kind.\nlicense: MIT\n---\n'), { name: 'sweet', description: 'Short and kind.' });
  } finally { rmSync(proj, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

test('commit message: prompt carries rules, subjects and staged diff; output is cleaned', async () => {
  const { commitPrompt, cleanMessage } = await import('../server/commitMessage');
  const { execFileSync } = await import('node:child_process');
  const repo = mkdtempSync(join(tmpdir(), 'vibrato-msg-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
  try {
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    writeFileSync(join(repo, 'AGENTS.md'), 'Commit subjects use feat:/fix: in Korean.\n');
    writeFileSync(join(repo, 'a.txt'), 'one\n'); git('add', '-A'); git('commit', '-qm', 'feat: 처음');
    assert.equal(await commitPrompt(repo), null, 'nothing staged');
    writeFileSync(join(repo, 'a.txt'), 'two\n'); git('add', 'a.txt');
    const p = (await commitPrompt(repo))!;
    assert.match(p, /feat:\/fix: in Korean/);
    assert.match(p, /feat: 처음/);
    assert.match(p, /\+two/);
    assert.equal(cleanMessage('```\nfix: 고침\n\nCo-Authored-By: X <x@y>\n```'), 'fix: 고침');
    assert.equal(cleanMessage('"feat: 추가"'), 'feat: 추가');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
