import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolvePath } from './fs.js';

/**
 * What the agents read besides the prompt, for one project: instruction files (CLAUDE.md / AGENTS.md,
 * project and user level), skills, hooks and MCP servers. Read-only here; the editor saves the
 * instruction files through the normal file API.
 */

type Scope = 'project' | 'user' | 'plugin';
type Agent = 'claude' | 'codex';

export interface ContextDoc { scope: Scope; agent: Agent; path: string; exists: boolean; content: string; mtime: number | null }
export interface ContextSkill { scope: Scope; agent: Agent; name: string; description: string; path: string }
export interface ContextHook { scope: Scope; file: string; event: string; matcher: string; command: string }
export interface ContextMcp { scope: Scope; agent: Agent; name: string; command: string; file: string }
export interface AgentContext { docs: ContextDoc[]; skills: ContextSkill[]; hooks: ContextHook[]; mcp: ContextMcp[] }

const HOME = process.env.MVC_AGENT_HOME || homedir();
const MAX_DOC = 512 * 1024;

async function readDoc(scope: Scope, agent: Agent, file: string): Promise<ContextDoc> {
  try {
    const st = await fs.stat(file);
    const content = st.size > MAX_DOC ? '' : await fs.readFile(file, 'utf8');
    return { scope, agent, path: file, exists: true, content, mtime: st.mtimeMs };
  } catch {
    return { scope, agent, path: file, exists: false, content: '', mtime: null };
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

/** name / description from a SKILL.md front matter block. */
export function skillMeta(text: string): { name?: string; description?: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const get = (k: string) => {
    const i = lines.findIndex((l) => l.startsWith(`${k}:`));
    if (i < 0) return undefined;
    const v = lines[i].slice(k.length + 1).trim();
    // YAML block scalar ("description: >" / "|-"): the value is the indented lines that follow.
    if (/^[>|][-+]?$/.test(v)) {
      const body: string[] = [];
      for (const l of lines.slice(i + 1)) { if (l.trim() && !/^\s/.test(l)) break; body.push(l.trim()); }
      return body.join(v[0] === '>' ? ' ' : '\n').replace(/\s+$/, '').trim();
    }
    return v.replace(/^["']|["']$/g, '');
  };
  return { name: get('name'), description: get('description') };
}

async function listSkills(scope: Scope, agent: Agent, dir: string, prefix = ''): Promise<ContextSkill[]> {
  const out: ContextSkill[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const file = path.join(dir, e.name, 'SKILL.md');
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text === null) continue;
    const meta = skillMeta(text.slice(0, 4000));
    out.push({ scope, agent, name: prefix + (meta.name || e.name), description: meta.description ?? '', path: file });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Skills of the Claude plugins enabled in user settings, named "plugin:skill" as the CLI invokes them. */
async function pluginSkills(claudeHome: string): Promise<ContextSkill[]> {
  const [installed, settings] = await Promise.all([readJson(path.join(claudeHome, 'plugins', 'installed_plugins.json')), readJson(path.join(claudeHome, 'settings.json'))]);
  const enabled = (settings?.enabledPlugins ?? {}) as Record<string, unknown>;
  const plugins = (installed?.plugins ?? {}) as Record<string, Array<{ installPath?: unknown }>>;
  const lists = Object.entries(plugins).filter(([key]) => enabled[key] === true).map(([key, installs]) => {
    const dir = Array.isArray(installs) ? installs.find((i) => typeof i?.installPath === 'string')?.installPath as string | undefined : undefined;
    return dir ? listSkills('plugin', 'claude', path.join(dir, 'skills'), `${key.split('@')[0]}:`) : Promise.resolve([]);
  });
  return (await Promise.all(lists)).flat();
}

function hooksOf(scope: Scope, file: string, json: Record<string, unknown> | null): ContextHook[] {
  const hooks = (json?.hooks ?? {}) as Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string; prompt?: string }> }>>;
  const out: ContextHook[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) for (const h of g?.hooks ?? []) out.push({ scope, file, event, matcher: g.matcher ?? '', command: h.command ?? h.prompt ?? h.type ?? '' });
  }
  return out;
}

function mcpOf(scope: Scope, agent: Agent, file: string, servers: unknown): ContextMcp[] {
  if (!servers || typeof servers !== 'object') return [];
  return Object.entries(servers as Record<string, { command?: string; args?: string[]; url?: string; type?: string }>).map(([name, s]) => ({
    scope, agent, name, file, command: s?.url ? `${s.type ?? 'http'} ${s.url}` : [s?.command, ...(Array.isArray(s?.args) ? s.args : [])].filter(Boolean).join(' '),
  }));
}

/** [mcp_servers.name] tables from Codex's config.toml (command / args / url only). */
export function codexMcp(toml: string, file: string): ContextMcp[] {
  const out: ContextMcp[] = [];
  const re = /^\[mcp_servers\.("?)([^\]"]+)\1\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/gm;
  for (const m of toml.matchAll(re)) {
    const body = m[3];
    const str = (k: string) => body.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
    const args = body.match(/^args\s*=\s*\[([^\]]*)\]/m)?.[1]?.match(/"([^"]*)"/g)?.map((a) => a.slice(1, -1)) ?? [];
    const url = str('url');
    out.push({ scope: 'user', agent: 'codex', name: m[2], file, command: url ? `http ${url}` : [str('command'), ...args].filter(Boolean).join(' ') });
  }
  return out;
}

export async function agentContext(cwd: string): Promise<AgentContext> {
  const root = resolvePath(cwd);
  const claudeHome = path.join(HOME, '.claude');
  const codexHome = process.env.CODEX_HOME || path.join(HOME, '.codex');
  const docs = await Promise.all([
    readDoc('project', 'claude', path.join(root, 'CLAUDE.md')),
    readDoc('project', 'codex', path.join(root, 'AGENTS.md')),
    readDoc('user', 'claude', path.join(claudeHome, 'CLAUDE.md')),
    readDoc('user', 'codex', path.join(codexHome, 'AGENTS.md')),
  ]);
  const skills = (await Promise.all([
    listSkills('project', 'claude', path.join(root, '.claude', 'skills')),
    listSkills('user', 'claude', path.join(claudeHome, 'skills')),
    pluginSkills(claudeHome),
    listSkills('project', 'codex', path.join(root, '.codex', 'skills')),
    listSkills('user', 'codex', path.join(codexHome, 'skills')),
  ])).flat();
  const settingsFiles: [Scope, string][] = [['project', path.join(root, '.claude', 'settings.json')], ['project', path.join(root, '.claude', 'settings.local.json')], ['user', path.join(claudeHome, 'settings.json')]];
  const settings = await Promise.all(settingsFiles.map(async ([scope, file]) => ({ scope, file, json: await readJson(file) })));
  const hooks = settings.flatMap((s) => hooksOf(s.scope, s.file, s.json));
  const claudeJsonFile = path.join(HOME, '.claude.json');
  const [projectMcp, claudeJson, codexToml] = await Promise.all([readJson(path.join(root, '.mcp.json')), readJson(claudeJsonFile), fs.readFile(path.join(codexHome, 'config.toml'), 'utf8').catch(() => '')]);
  const perProject = ((claudeJson?.projects ?? {}) as Record<string, { mcpServers?: unknown }>)[root]?.mcpServers;
  const mcp = [
    ...mcpOf('project', 'claude', path.join(root, '.mcp.json'), projectMcp?.mcpServers),
    ...mcpOf('project', 'claude', claudeJsonFile, perProject),
    ...mcpOf('user', 'claude', claudeJsonFile, claudeJson?.mcpServers),
    ...codexMcp(codexToml, path.join(codexHome, 'config.toml')),
  ];
  return { docs, skills, hooks, mcp };
}
