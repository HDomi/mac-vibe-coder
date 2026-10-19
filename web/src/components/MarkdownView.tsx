import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../lib/api';

interface Props {
  text: string;
  /** Directory used to resolve relative image/link paths (the .md file's folder or the session cwd). */
  baseDir?: string | null;
  className?: string;
}

const EXTERNAL_RE = /^(https?:|mailto:|tel:|data:|blob:)/i;

function resolveLocal(href: string, baseDir?: string | null): string | null {
  if (!href || EXTERNAL_RE.test(href) || href.startsWith('#')) return null;
  let p = href.startsWith('file://') ? decodeURIComponent(href.slice(7)) : href;
  try { p = decodeURIComponent(p); } catch { /* keep as is */ }
  p = p.split('#')[0].split('?')[0];
  if (p.startsWith('~/')) return p;
  if (p.startsWith('/')) return p;
  if (!baseDir) return null;
  const parts = (baseDir + '/' + p).split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return '/' + out.join('/');
}

/** Ask the app to show a local file in the Preview tab. */
export function openLocalFile(path: string) {
  window.dispatchEvent(new CustomEvent('vibe:open-file', { detail: { path } }));
}

export default function MarkdownView({ text, baseDir, className }: Props) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={{
          img: ({ src, alt, title }) => {
            const local = resolveLocal(String(src ?? ''), baseDir);
            const url = local ? api.rawUrl(local) : String(src ?? '');
            return <img src={url} alt={alt ?? ''} title={title ?? local ?? undefined} className="max-w-full rounded-md cursor-zoom-in" onClick={() => local && openLocalFile(local)} />;
          },
          a: ({ href, children, title }) => {
            const h = String(href ?? '');
            const local = resolveLocal(h, baseDir);
            if (local) {
              return <a href={api.rawUrl(local)} title={local} onClick={(e) => { e.preventDefault(); openLocalFile(local); }}>{children}</a>;
            }
            if (h.startsWith('#')) return <a href={h} title={title}>{children}</a>;
            // External: let Electron's window-open handler send it to the default browser.
            return <a href={h} title={title} target="_blank" rel="noreferrer noopener">{children}</a>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
