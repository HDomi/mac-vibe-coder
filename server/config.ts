import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** MVC_PORT / MVC_CONFIG_DIR only exist so a test copy of the app can run next to the real one. */
export const PORT = Number(process.env.MVC_PORT) || 11398;
export const HOST = '127.0.0.1';
export const CONFIG_DIR = process.env.MVC_CONFIG_DIR || path.join(homedir(), '.mac-vibe-coder');
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

/** A reusable instruction the composer can insert ("run the tests and fix failures"). */
export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
}

export interface Config {
  favorites: Favorite[];
  groups: FavoriteGroup[];
  recent: string[];
  /** "agent:sessionId" keys of pinned sessions; pinned sessions cannot be deleted. */
  pinnedSessions: string[];
  prompts: SavedPrompt[];
}

const DEFAULT: Config = { favorites: [], groups: [], recent: [], pinnedSessions: [], prompts: [] };

export class ConfigStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private file: string) {}

  /** Serialize the whole read/modify/write transaction, including concurrent HTTP requests. */
  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(action);
    this.pending = result.catch(() => {});
    return result;
  }

  async load(): Promise<Config> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid configuration');
      const config = { ...structuredClone(DEFAULT), ...parsed };
      for (const key of Object.keys(DEFAULT) as (keyof Config)[]) {
        if (!Array.isArray(config[key])) throw new Error(`Invalid configuration: ${key}`);
      }
      return config;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(DEFAULT);
      // Preserve a damaged file instead of silently overwriting favorites and pins with defaults.
      throw err;
    }
  }

  async save(config: Config): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, this.file);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
}

const store = new ConfigStore(CONFIG_FILE);
export const loadConfig = () => store.load();
export const saveConfig = (config: Config) => store.save(config);
export const withConfigLock = <T>(action: () => Promise<T>) => store.exclusive(action);
