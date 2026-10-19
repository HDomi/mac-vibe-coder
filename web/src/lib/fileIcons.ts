import theme from 'material-icon-theme/dist/material-icons.json';

/** Resolves a file/folder name to a Material Icon Theme icon id, mirroring VS Code's matching order. */
interface Theme {
  iconDefinitions: Record<string, { iconPath: string }>;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
  file: string;
  folder: string;
}

const T = theme as unknown as Theme;

export function fileIconId(name: string, isDir: boolean): string {
  const lower = name.toLowerCase();
  if (isDir) return T.folderNames[lower] ?? T.folderNames[name] ?? T.folder;
  const byName = T.fileNames[lower] ?? T.fileNames[name];
  if (byName) return byName;
  // Longest multi-dot extension first: "foo.test.ts" tries "test.ts" then "ts".
  const parts = lower.split('.');
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join('.');
    const id = T.fileExtensions[ext];
    if (id) return id;
  }
  return T.file;
}

/** SVG file name (without directory) for an icon id, or null when the theme has no definition. */
export function fileIconSvg(id: string): string | null {
  const def = T.iconDefinitions[id];
  if (!def) return null;
  return def.iconPath.split('/').pop() ?? null;
}

export const DEFAULT_FILE_ICON = T.file;
export const DEFAULT_FOLDER_ICON = T.folder;
