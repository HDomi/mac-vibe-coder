import React, { useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { api } from '../lib/api';
import { t, useLang } from '../lib/i18n';
import { openLightbox } from './Lightbox';

interface Props {
  text: string;
  /** Directory used to resolve relative image/link paths (the .md file's folder or the session cwd). */
  baseDir?: string | null;
  className?: string;
}

const EXTERNAL_RE = /^(https?:|mailto:|tel:|data:|blob:)/i;
export const markdownSchema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, '*': [...(defaultSchema.attributes?.['*'] ?? []), 'align'], img: [...(defaultSchema.attributes?.img ?? []), 'width', 'height'] },
  protocols: { ...defaultSchema.protocols, href: ['http', 'https', 'mailto', 'file'], src: ['http', 'https', 'data'] },
};

function MarkdownImage({ url, label, alt, title }: { url: string; label: string; alt: string; title?: string }) {
  useLang();
  const [loaded, setLoaded] = useState(false);
  // Remote images in agent output may encode conversation data in their URL. Fetch only on click.
  if (/^(https?:)?\/\//i.test(url) && !loaded) return <button className="text-xs underline text-zinc-400" title={url} onClick={() => setLoaded(true)}>{t('preview.loadRemoteImage')}: {alt || label}</button>;
  return <img src={url || undefined} alt={alt} title={title} className="max-w-full rounded-md cursor-zoom-in" onClick={() => openLightbox(url, label)} />;
}

function resolveLocal(href: string, baseDir?: string | null): string | null {
  if (!href || EXTERNAL_RE.test(href) || href.startsWith('#')) return null;
  if (/^[a-z][\w+.-]*:/i.test(href) && !href.startsWith('file://')) return null;
  let p = href.startsWith('file://') ? href.slice(7) : href;
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

export function CopyButton({ text, className }: { text: string; className?: string }) {
  useLang();
  const [done, setDone] = useState(false);
  return (
    <button className={`text-[10px] rounded px-1.5 py-0.5 bg-white/10 hover:bg-white/20 text-zinc-300 ${className ?? ''}`}
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}>
      {done ? t('common.copied') : t('common.copy')}
    </button>
  );
}

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: React.ReactNode } }).props.children);
  return '';
}

export default function MarkdownView({ text, baseDir, className }: Props) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema], [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        urlTransform={(url, key) => key === 'src' && /^data:image\/(?:png|jpeg|gif|webp|avif);/i.test(url) || /^file:\/\//i.test(url) ? url : defaultUrlTransform(url)}
        components={{
          pre: ({ children }) => (
            <div className="relative group/code">
              <CopyButton text={textOf(children)} className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100" />
              <pre>{children}</pre>
            </div>
          ),
          img: ({ src, alt, title }) => {
            const local = resolveLocal(String(src ?? ''), baseDir);
            const url = local ? api.rawUrl(local) : String(src ?? '');
            return <MarkdownImage key={url} url={url} label={local ?? alt ?? ''} alt={alt ?? ''} title={title ?? local ?? undefined} />;
          },
          a: ({ href, children, title }) => {
            const h = String(href ?? '');
            const local = resolveLocal(h, baseDir);
            if (local) {
              return <a href="#" title={local} onClick={(e) => { e.preventDefault(); openLocalFile(local); }}>{children}</a>;
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
