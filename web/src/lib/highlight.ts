import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import sql from 'highlight.js/lib/languages/sql';
import ini from 'highlight.js/lib/languages/ini';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import makefile from 'highlight.js/lib/languages/makefile';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';

/** Languages offered in the preview dropdown; id is the highlight.js name. */
export const LANGUAGES: { id: string; label: string }[] = [
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'json', label: 'JSON' },
  { id: 'bash', label: 'Shell' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'yaml', label: 'YAML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'swift', label: 'Swift' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'sql', label: 'SQL' },
  { id: 'ini', label: 'INI / TOML' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'php', label: 'PHP' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'makefile', label: 'Makefile' },
  { id: 'diff', label: 'Diff' },
  { id: 'plaintext', label: 'Plain text' },
];

const REGISTRY: Record<string, unknown> = {
  typescript, javascript, python, json, bash, css, scss, xml, yaml, markdown, go, rust, java, kotlin, swift, c, cpp, csharp, sql, ini, ruby, php, dockerfile, makefile, diff, plaintext,
};
for (const [name, def] of Object.entries(REGISTRY)) hljs.registerLanguage(name, def as never);

const EXT_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.json': 'json', '.sh': 'bash', '.zsh': 'bash', '.bash': 'bash',
  '.html': 'xml', '.htm': 'xml', '.xml': 'xml', '.svg': 'xml', '.vue': 'xml', '.svelte': 'xml',
  '.css': 'css', '.scss': 'scss', '.yml': 'yaml', '.yaml': 'yaml', '.md': 'markdown',
  '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp', '.cs': 'csharp',
  '.sql': 'sql', '.ini': 'ini', '.toml': 'ini', '.env': 'bash', '.rb': 'ruby', '.php': 'php',
  '.diff': 'diff', '.patch': 'diff', '.txt': 'plaintext', '.log': 'plaintext', '.csv': 'plaintext',
};
const NAME_MAP: Record<string, string> = { Dockerfile: 'dockerfile', Makefile: 'makefile' };

const LS_PREFIX = 'vibe.previewLang:';

/** Language for a file: the user's saved choice for that extension, else the extension default, else TypeScript. */
export function languageFor(name: string, ext: string): string {
  const key = ext || name;
  try { const saved = localStorage.getItem(LS_PREFIX + key); if (saved) return saved; } catch { /* ignore */ }
  return NAME_MAP[name] ?? EXT_MAP[ext.toLowerCase()] ?? 'typescript';
}

export function rememberLanguage(name: string, ext: string, lang: string) {
  try { localStorage.setItem(LS_PREFIX + (ext || name), lang); } catch { /* ignore */ }
}

export function highlight(code: string, lang: string): string {
  try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; }
  catch { return hljs.highlight(code, { language: 'plaintext' }).value; }
}

/** Carry highlight.js spans across row boundaries without reparsing escaped source text. */
export function highlightedLines(html: string): string[] {
  const open: string[] = [];
  return html.split('\n').map((line) => {
    const prefix = open.join('');
    for (const match of line.matchAll(/<span\b[^>]*>|<\/span>/g)) {
      if (match[0] === '</span>') open.pop(); else open.push(match[0]);
    }
    return prefix + line + '</span>'.repeat(open.length);
  });
}
