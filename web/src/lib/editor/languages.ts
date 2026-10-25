import type { Extension } from '@codemirror/state';

/**
 * Editor languages, each loaded on first use so the parsers stay out of the startup bundle.
 * `id` is what the status bar shows; `load` resolves to the CodeMirror extension.
 */
interface Lang { id: string; label: string; load: () => Promise<Extension> }

const stream = async (load: () => Promise<unknown>) => {
  const [{ StreamLanguage }, mode] = await Promise.all([import('@codemirror/language'), load()]);
  return StreamLanguage.define(mode as never);
};

export const LANGS: Record<string, Lang> = {
  typescript: { id: 'typescript', label: 'TypeScript', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })) },
  tsx: { id: 'tsx', label: 'TypeScript JSX', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true })) },
  javascript: { id: 'javascript', label: 'JavaScript', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript()) },
  jsx: { id: 'jsx', label: 'JavaScript JSX', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })) },
  json: { id: 'json', label: 'JSON', load: () => import('@codemirror/lang-json').then((m) => m.json()) },
  yaml: { id: 'yaml', label: 'YAML', load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()) },
  css: { id: 'css', label: 'CSS', load: () => import('@codemirror/lang-css').then((m) => m.css()) },
  html: { id: 'html', label: 'HTML', load: () => import('@codemirror/lang-html').then((m) => m.html()) },
  xml: { id: 'xml', label: 'XML', load: () => import('@codemirror/lang-xml').then((m) => m.xml()) },
  markdown: { id: 'markdown', label: 'Markdown', load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()) },
  python: { id: 'python', label: 'Python', load: () => import('@codemirror/lang-python').then((m) => m.python()) },
  sql: { id: 'sql', label: 'SQL', load: () => import('@codemirror/lang-sql').then((m) => m.sql()) },
  rust: { id: 'rust', label: 'Rust', load: () => import('@codemirror/lang-rust').then((m) => m.rust()) },
  go: { id: 'go', label: 'Go', load: () => import('@codemirror/lang-go').then((m) => m.go()) },
  java: { id: 'java', label: 'Java', load: () => import('@codemirror/lang-java').then((m) => m.java()) },
  cpp: { id: 'cpp', label: 'C / C++', load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) },
  php: { id: 'php', label: 'PHP', load: () => import('@codemirror/lang-php').then((m) => m.php()) },
  shell: { id: 'shell', label: 'Shell', load: () => stream(() => import('@codemirror/legacy-modes/mode/shell').then((m) => m.shell)) },
  toml: { id: 'toml', label: 'TOML', load: () => stream(() => import('@codemirror/legacy-modes/mode/toml').then((m) => m.toml)) },
  properties: { id: 'properties', label: 'INI / .env', load: () => stream(() => import('@codemirror/legacy-modes/mode/properties').then((m) => m.properties)) },
  dockerfile: { id: 'dockerfile', label: 'Dockerfile', load: () => stream(() => import('@codemirror/legacy-modes/mode/dockerfile').then((m) => m.dockerFile)) },
  ruby: { id: 'ruby', label: 'Ruby', load: () => stream(() => import('@codemirror/legacy-modes/mode/ruby').then((m) => m.ruby)) },
  swift: { id: 'swift', label: 'Swift', load: () => stream(() => import('@codemirror/legacy-modes/mode/swift').then((m) => m.swift)) },
  kotlin: { id: 'kotlin', label: 'Kotlin', load: () => stream(() => import('@codemirror/legacy-modes/mode/clike').then((m) => m.kotlin)) },
  csharp: { id: 'csharp', label: 'C#', load: () => stream(() => import('@codemirror/legacy-modes/mode/clike').then((m) => m.csharp)) },
  diff: { id: 'diff', label: 'Diff', load: () => stream(() => import('@codemirror/legacy-modes/mode/diff').then((m) => m.diff)) },
  plaintext: { id: 'plaintext', label: 'Plain Text', load: async () => [] },
};

const EXT: Record<string, string> = {
  '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'jsx',
  '.json': 'json', '.jsonc': 'json', '.json5': 'json', '.webmanifest': 'json',
  '.yml': 'yaml', '.yaml': 'yaml', '.css': 'css', '.scss': 'css', '.less': 'css',
  '.html': 'html', '.htm': 'html', '.vue': 'html', '.svelte': 'html',
  '.xml': 'xml', '.svg': 'xml', '.plist': 'xml', '.md': 'markdown', '.mdx': 'markdown', '.markdown': 'markdown',
  '.py': 'python', '.sql': 'sql', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.c': 'cpp', '.h': 'cpp', '.cc': 'cpp', '.cpp': 'cpp', '.hpp': 'cpp', '.m': 'cpp', '.mm': 'cpp', '.php': 'php',
  '.sh': 'shell', '.zsh': 'shell', '.bash': 'shell', '.toml': 'toml', '.ini': 'properties', '.env': 'properties', '.properties': 'properties', '.conf': 'properties',
  '.rb': 'ruby', '.swift': 'swift', '.kt': 'kotlin', '.kts': 'kotlin', '.cs': 'csharp', '.diff': 'diff', '.patch': 'diff',
};

const NAMES: Record<string, string> = {
  Dockerfile: 'dockerfile', Makefile: 'shell', '.zshrc': 'shell', '.bashrc': 'shell', '.zprofile': 'shell', '.profile': 'shell',
  '.gitignore': 'shell', '.npmrc': 'properties', '.editorconfig': 'properties', '.prettierrc': 'json', '.eslintrc': 'json', 'Gemfile': 'ruby', 'Podfile': 'ruby',
};

export function languageOf(name: string): Lang {
  if (NAMES[name]) return LANGS[NAMES[name]];
  if (/^\.env(\..+)?$/.test(name)) return LANGS.properties;
  if (/^Dockerfile\./.test(name)) return LANGS.dockerfile;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return LANGS[EXT[ext] ?? 'plaintext'];
}

const cache = new Map<string, Promise<Extension>>();
export function loadLanguage(id: string): Promise<Extension> {
  let p = cache.get(id);
  if (!p) {
    p = (LANGS[id] ?? LANGS.plaintext).load().catch(() => []);
    cache.set(id, p);
  }
  return p;
}
