/** DOM input events -> CDP Input.dispatch* parameters for the Browser panel. */

type Mods = { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function mouseModifiers(e: Mods): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

export function mouseButton(button: number): 'left' | 'middle' | 'right' | 'none' {
  return button === 0 ? 'left' : button === 1 ? 'middle' : button === 2 ? 'right' : 'none';
}

const VK: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34,
  End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Meta: 91,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};

/** Windows virtual key code Chrome expects for `key` (letters and digits use their upper-case char code). */
export function virtualKeyCode(key: string, code = ''): number {
  if (VK[key] !== undefined) return VK[key];
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  if (key.length === 1) { const c = key.toUpperCase().charCodeAt(0); if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90)) return c; }
  return 0;
}

/**
 * keyDown carries `text` for printable keys and Enter so the page receives input and keypress;
 * other keys go as rawKeyDown, which is how Chrome itself sends editing and navigation keys.
 */
export function keyEventFor(e: Mods & { key: string; code: string; location?: number }, phase: 'keyDown' | 'keyUp') {
  const text = e.key === 'Enter' ? '\r' : e.key.length === 1 && !e.ctrlKey && !e.metaKey ? e.key : undefined;
  return {
    type: phase === 'keyUp' ? 'keyUp' : text ? 'keyDown' : 'rawKeyDown',
    key: e.key, code: e.code, windowsVirtualKeyCode: virtualKeyCode(e.key, e.code), nativeVirtualKeyCode: virtualKeyCode(e.key, e.code),
    modifiers: mouseModifiers(e), location: e.location ?? 0,
    ...(phase === 'keyDown' && text ? { text, unmodifiedText: text } : {}),
  };
}

/** Address bar text -> URL (same rules as the server's normalizeUrl, kept here for the native view). */
export function normalizeAddress(input: string): string {
  const s = input.trim();
  if (!s) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(localhost|[\w.-]+):\d+/i.test(s)) return s;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(s) || /^\d+\.\d+\.\d+\.\d+(:\d+)?(\/|$)/.test(s)) return `http://${s}`;
  if (/^:\d+(\/|$)/.test(s)) return `http://localhost${s}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}
