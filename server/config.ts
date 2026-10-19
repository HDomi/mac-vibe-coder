import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export const PORT = 11398;
export const HOST = '127.0.0.1';
export const CONFIG_DIR = path.join(homedir(), '.mac-vibe-coder');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface Favorite {
  path: string;
  name: string;
  /** Group id, or undefined for top level. */
  group?: string;
}

export interface FavoriteGroup {
  id: string;
  name: string;
  collapsed?: boolean;
}

export interface Config {
  favorites: Favorite[];
  groups: FavoriteGroup[];
  recent: string[];
  /** "agent:sessionId" keys of pinned sessions; pinned sessions cannot be deleted. */
  pinnedSessions: string[];
}

const DEFAULT: Config = { favorites: [], groups: [], recent: [], pinnedSessions: [] };

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT };
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}
