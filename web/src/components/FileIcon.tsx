import { DEFAULT_FILE_ICON, DEFAULT_FOLDER_ICON, fileIconId, fileIconSvg } from '../lib/fileIcons';

// Every theme SVG becomes an asset URL; cloned variants (*.clone.svg) are not shipped and fall back below.
const URLS = import.meta.glob('../../../node_modules/material-icon-theme/icons/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function urlFor(id: string): string | undefined {
  const svg = fileIconSvg(id);
  return svg ? URLS[`../../../node_modules/material-icon-theme/icons/${svg}`] : undefined;
}

export function fileIconUrl(name: string, isDir: boolean): string {
  return urlFor(fileIconId(name, isDir)) ?? urlFor(isDir ? DEFAULT_FOLDER_ICON : DEFAULT_FILE_ICON) ?? '';
}

export default function FileIcon({ name, isDir, className = 'w-4 h-4' }: { name: string; isDir: boolean; className?: string }) {
  return <img src={fileIconUrl(name, isDir)} alt="" draggable={false} className={`inline-block shrink-0 ${className}`} />;
}
