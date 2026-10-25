/**
 * Everything that needs CodeMirror lives here and is imported on demand, so the editor costs
 * nothing until the first file is opened.
 */
import { Compartment, EditorState, Text, Transaction, type Extension } from '@codemirror/state';
import {
  crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { materialTheme } from './theme';
import { loadLanguage } from './languages';

export { EditorView, EditorState, Text };

export interface Hooks {
  /** Every transaction; `changed` when the document text changed. */
  onUpdate: (state: EditorState, changed: boolean, remote: boolean) => void;
  onSave: () => void;
}

const language = new Compartment();
const readOnly = new Compartment();
const remote = Transaction.userEvent.of('remote');

/** Indentation the file already uses: tabs, or the smallest common run of leading spaces. */
export function detectIndent(text: string): { unit: string; size: number } {
  let tabs = 0; let spaces = 0; const widths = new Map<number, number>();
  let n = 0;
  for (const line of text.split('\n', 2000)) {
    if (!line.trim()) continue;
    if (line[0] === '\t') tabs++;
    else if (line[0] === ' ') {
      const w = line.length - line.trimStart().length;
      if (w > 1 && w <= 8) { spaces++; widths.set(w, (widths.get(w) ?? 0) + 1); }
    }
    if (++n > 1000) break;
  }
  if (tabs > spaces) return { unit: '\t', size: 4 };
  if (!spaces) return { unit: '  ', size: 2 };
  // The step between indentation levels: 2 when lines at 2/4/6 appear, 4 for 4/8, etc.
  const size = [2, 4, 8].find((s) => [...widths.keys()].every((w) => w % s === 0) && widths.has(s)) ?? Math.min(...widths.keys());
  return { unit: ' '.repeat(size), size };
}

// CodeMirror's own UI strings (search panel, folding) for the Korean UI.
const KO: Record<string, string> = {
  Find: '찾기', Replace: '바꾸기', next: '다음', previous: '이전', all: '모두', 'match case': '대소문자 구분', regexp: '정규식',
  'by word': '단어 단위', replace: '바꾸기', 'replace all': '모두 바꾸기', close: '닫기', 'Go to line': '줄로 이동', go: '이동',
  'current match': '현재 일치', 'on line': '줄', 'replaced match on line $': '$번 줄의 일치 항목을 바꿨습니다', 'replaced $ matches': '$개를 바꿨습니다',
  'Folded lines': '접힌 줄', 'Unfolded lines': '펼친 줄', to: '~', 'folded code': '접힌 코드', unfold: '펼치기', 'Fold line': '줄 접기', 'Unfold line': '줄 펼치기',
  'Control character': '제어 문자', 'Selection deleted': '선택 영역 삭제됨',
};

export async function createState(content: string, opts: { lang: string; readOnly: boolean; hooks: Hooks }): Promise<EditorState> {
  const lang = await loadLanguage(opts.lang);
  const indent = detectIndent(content);
  const extensions: Extension[] = [
    lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(),
    drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true), indentOnInput(),
    bracketMatching(), closeBrackets(), rectangularSelection(), crosshairCursor(), highlightActiveLine(),
    highlightSelectionMatches(), search({ top: true }),
    indentUnit.of(indent.unit), EditorState.tabSize.of(indent.size),
    keymap.of([
      // stopPropagation: the panel's own ⌘S handler must not save a second time.
      { key: 'Mod-s', preventDefault: true, stopPropagation: true, run: () => { opts.hooks.onSave(); return true; } },
      ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
    ]),
    materialTheme,
    ...(document.documentElement.lang === 'ko' ? [EditorState.phrases.of(KO)] : []),
    language.of(lang),
    readOnly.of(opts.readOnly ? [EditorState.readOnly.of(true)] : []),
    EditorView.updateListener.of((u) => {
      // Every transaction, effect-only ones too (search panel, folding, language, scroll): the
      // store's copy of the state must never lag the view, or a later tab swap would restore it.
      if (!u.transactions.length) return;
      opts.hooks.onUpdate(u.state, u.docChanged, u.transactions.some((tr) => tr.isUserEvent('remote')));
    }),
  ];
  return EditorState.create({ doc: content, extensions });
}

export async function setLanguage(id: string) {
  return { effects: language.reconfigure(await loadLanguage(id)) };
}

export function setReadOnly(on: boolean) {
  return { effects: readOnly.reconfigure(on ? [EditorState.readOnly.of(true)] : []) };
}

/**
 * Replace the document with what is on disk as one minimal edit (common prefix and suffix kept),
 * so the cursor and scroll position survive an agent changing a few lines elsewhere. Kept out of
 * the undo history: ⌘Z must not resurrect the version the agent replaced.
 */
export function diskChange(doc: Text, disk: string) {
  // The document holds \n line breaks whatever the file uses; compare like with like.
  const next = disk.replace(/\r\n?/g, '\n');
  const cur = doc.toString();
  let p = 0;
  const max = Math.min(cur.length, next.length);
  while (p < max && cur.charCodeAt(p) === next.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && cur.charCodeAt(cur.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
  return {
    changes: { from: p, to: cur.length - s, insert: next.slice(p, next.length - s) },
    annotations: [Transaction.addToHistory.of(false), remote],
  };
}

export const textOf = (s: string) => Text.of(s.split(/\r\n?|\n/));

/** Dirty check that is O(1) for the common case (lengths differ) and exact otherwise. */
export const isDirty = (doc: Text, saved: Text) => doc.length !== saved.length || !doc.eq(saved);
