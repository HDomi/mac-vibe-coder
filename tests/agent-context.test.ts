import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const home = mkdtempSync(join(tmpdir(), 'mvc-home-'));
process.env.MVC_AGENT_HOME = home;
process.env.CODEX_HOME = join(home, '.codex');

test('agent context: docs, skills, hooks and MCP from project and user level', async () => {
  const { agentContext, codexMcp, skillMeta } = await import('../server/agentContext');
  const proj = mkdtempSync(join(tmpdir(), 'mvc-proj-'));
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
  } finally { rmSync(proj, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});
