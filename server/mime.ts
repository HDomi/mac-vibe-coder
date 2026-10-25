const MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif', '.heic': 'image/heic',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.html': 'text/html',
  '.css': 'text/css', '.js': 'text/javascript', '.ts': 'text/typescript',
};

export function mimeOf(ext: string): string {
  return MAP[ext.toLowerCase()] ?? 'application/octet-stream';
}

export type PreviewKind = 'markdown' | 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'binary';

const TEXT_EXT = new Set([
  '.txt', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.vue', '.svelte',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.cs',
  '.sh', '.zsh', '.bash', '.yml', '.yaml', '.toml', '.ini', '.env', '.xml', '.sql', '.graphql',
  '.csv', '.tsv', '.log', '.gitignore', '.editorconfig', '.prettierrc', '.lock', '.mjs', '.cjs',
]);

/** Images the browser cannot decode but macOS ImageIO can; previewed as PNG via /api/image/png. */
export const IMAGEIO_EXT = new Set([
  '.heic', '.heif', '.heics', '.avci', '.tif', '.tiff', '.psd', '.jp2', '.j2k', '.tga', '.exr', '.icns', '.jxl', '.pict', '.pct',
  '.sgi', '.pbm', '.pgm', '.ppm', '.astc', '.ktx', '.pvr', '.hdr', '.dds', '.mpo', '.dcm',
  '.dng', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.raf', '.orf', '.rw2', '.pef', '.srw', '.erf', '.3fr', '.iiq', '.rwl', '.mos', '.mrw', '.dcr',
]);

export function previewKind(ext: string, name: string): PreviewKind {
  const e = ext.toLowerCase();
  if (IMAGEIO_EXT.has(e)) return 'image';
  if (e === '.md' || e === '.mdx' || e === '.markdown') return 'markdown';
  const mime = mimeOf(e);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (TEXT_EXT.has(e) || /^(Makefile|Dockerfile|LICENSE|README|CLAUDE|AGENTS)$/i.test(name)) return 'text';
  return 'binary';
}
