import { format, type SqlLanguage, type KeywordCase } from 'sql-formatter';

export const SQL_DIALECTS: { id: SqlLanguage; label: string }[] = [
  { id: 'sql', label: 'Standard SQL' }, { id: 'postgresql', label: 'PostgreSQL' }, { id: 'mysql', label: 'MySQL' }, { id: 'mariadb', label: 'MariaDB' },
  { id: 'sqlite', label: 'SQLite' }, { id: 'transactsql', label: 'SQL Server' }, { id: 'plsql', label: 'Oracle PL/SQL' }, { id: 'bigquery', label: 'BigQuery' },
  { id: 'snowflake', label: 'Snowflake' }, { id: 'redshift', label: 'Redshift' }, { id: 'spark', label: 'Spark' }, { id: 'trino', label: 'Trino' },
];

export interface SqlOptions { dialect: SqlLanguage; keywordCase: KeywordCase; indent: number; linesBetween: number }

export function formatSql(text: string, o: SqlOptions): string {
  return format(text, { language: o.dialect, keywordCase: o.keywordCase, tabWidth: o.indent, linesBetweenQueries: o.linesBetween });
}

/** One line: comments dropped, whitespace outside quotes collapsed. Quoted text is kept byte for byte. */
export function minifySql(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  let space = false;
  while (i < n) {
    const ch = text[i];
    if (ch === '-' && text[i + 1] === '-') { while (i < n && text[i] !== '\n') i++; space = true; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; space = true; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < n) { if (text[j] === ch) { if (text[j + 1] === ch) { j += 2; continue; } break; } if (text[j] === '\\' && ch !== '"') j++; j++; }
      if (space && out && !/[(,]$/.test(out)) out += ' ';
      space = false;
      out += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (/\s/.test(ch)) { space = true; i++; continue; }
    if (space && out && !/[(,]$/.test(out) && !/[),;]/.test(ch)) out += ' ';
    space = false;
    out += ch; i++;
  }
  return out.trim();
}
