import { useCallback, useEffect, useRef, useState } from 'react';
import { agentClient, type AgentId, type Attachment, type PermissionModeId, type ServerMessage } from './agent';
import { itemsFromHistory, reduceEvent, sessionTitle, type ChatItem, type ChatSession } from './chatStore';
import { api } from './api';
import { t } from './i18n';

const LS_ACTIVE = 'vibe.sessions';

/** Session currently on screen; a result there needs no notification while the window is focused. */
let onScreenSession: string | null = null;
export function setOnScreenSession(id: string | null) { onScreenSession = id; }

function sessionName(s: ChatSession) { return sessionTitle(s.items, 24) ?? s.cwd.split('/').pop() ?? s.agent; }

/**
 * Notify when the user is not looking at this session: the window is unfocused or hidden, or
 * another session/view is on screen. Native (Electron) when available, web Notification otherwise.
 */
function notifyIfAway(s: ChatSession, e: { kind: string; text?: string; toolName?: string; ok?: boolean }) {
  if (document.hasFocus() && document.visibilityState === 'visible' && onScreenSession === s.id) return;
  const name = sessionName(s);
  let title: string | null = null; let body = '';
  if (e.kind === 'result') { title = t(e.ok ? 'notif.sessionDone' : 'notif.sessionFailed', { name }); body = (e.text ?? '').slice(0, 120); }
  else if (e.kind === 'approval.request') { title = t('notif.approval'); body = `${name} · ${t('notif.allow', { tool: e.toolName ?? '' })}`; }
  else if (e.kind === 'question.request') { title = t('notif.question'); body = `${name} · ${t('notif.waiting')}`; }
  if (!title) return;
  if (window.vibe?.notify) { window.vibe.notify({ title, body, sessionId: s.id }); return; }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, silent: false });
    n.onclick = () => { window.focus(); window.dispatchEvent(new CustomEvent('vibe:notify-click', { detail: { sessionId: s.id } })); };
  } catch { /* ignore */ }
}

export function requestNotificationPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
}

interface Persisted { id: string; cwd: string; agent: AgentId; agentSessionId?: string; permissionMode?: PermissionModeId; model?: string; historyLen?: number }
interface PendingStart { cwd: string; resolve: (id: string) => void; reject: (err: Error) => void; preload: ChatItem[]; historyLen?: number; replaces?: string }
/** A revived session that goes missing again this soon is reported lost instead of looping. */
const REVIVE_COOLDOWN_MS = 30000;

export function useSessions() {
  const [sessions, setSessions] = useState<Record<string, ChatSession>>({});
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const pendingStart = useRef(new Map<string, PendingStart>());
  /** Old session id -> the id that replaced it after the server restarted. Views follow this to keep their selection. */
  const [replaced, setReplaced] = useState<Record<string, string>>({});
  const reviving = useRef(new Set<string>());
  const revivedAt = useRef(new Map<string, number>());
  /** Sessions whose buffered events are already covered by the full saved history (legacy entries). */
  const skipReplay = useRef(new Set<string>());

  useEffect(() => {
    const off = agentClient.on((m: ServerMessage) => {
      if ('type' in m) {
        if (m.type === 'reconnected') {
          // The server lost this socket's subscriptions; re-attach every live session from where we left off.
          for (const s of Object.values(sessionsRef.current)) if (s.status !== 'closed') agentClient.send({ type: 'session.attach', sessionId: s.id, after: s.lastSeq || (skipReplay.current.has(s.id) ? Number.MAX_SAFE_INTEGER : 0) });
          return;
        }
        if (m.type === 'pong') return;
        if (m.type === 'session.startFailed') {
          const p = m.requestId ? pendingStart.current.get(m.requestId) : undefined;
          if (m.requestId) pendingStart.current.delete(m.requestId);
          p?.reject(new Error(m.message));
          return;
        }
        if (m.type === 'session.started') {
          const p = m.requestId ? pendingStart.current.get(m.requestId) : undefined;
          if (m.requestId) pendingStart.current.delete(m.requestId);
          const fresh: ChatSession = {
            id: m.sessionId, agent: m.agent ?? 'claude', cwd: m.requestCwd, permissionMode: 'default', status: 'starting',
            items: p?.preload ?? [], historyLen: p?.historyLen, totalCostUsd: 0, lastSeq: 0,
          };
          const old = p?.replaces;
          setSessions((prev) => {
            const was = old ? prev[old] : undefined;
            if (!old || !was) return { ...prev, [m.sessionId]: fresh };
            // Keep the tab where it was and the conversation on screen; history replay (Claude) wins when available.
            const items = fresh.items.length ? fresh.items : was.items.filter((it) => !it.id.startsWith('gone-')).map((it) =>
              it.kind === 'assistant' ? { ...it, streaming: false } : it.kind === 'tool' ? { ...it, done: true } : it);
            const revived: ChatSession = { ...fresh, permissionMode: was.permissionMode, model: was.model, agentSessionId: was.agentSessionId, items: [...items, { kind: 'system', id: `revived-${m.sessionId}`, text: t('session.revived') }] };
            return Object.fromEntries(Object.entries(prev).map(([k, v]) => k === old ? [m.sessionId, revived] : [k, v]));
          });
          if (old) {
            revivedAt.current.set(m.sessionId, Date.now());
            setReplaced((r) => ({ ...r, [old]: m.sessionId }));
          }
          p?.resolve(m.sessionId);
        } else if (m.type === 'session.missing') {
          const s = sessionsRef.current[m.sessionId];
          if (!s || reviving.current.has(s.id)) return;
          if (Date.now() - (revivedAt.current.get(s.id) ?? 0) < REVIVE_COOLDOWN_MS) { markLost(s.id); return; }
          // The server restarted (update, app relaunch): start the same conversation again instead of leaving a dead tab.
          reviving.current.add(s.id);
          startRef.current(s.cwd, { agent: s.agent, resume: s.agentSessionId, permissionMode: s.permissionMode, model: s.model, replaces: s.id })
            .catch(() => markLost(s.id))
            .finally(() => reviving.current.delete(s.id));
        }
        return;
      }
      const live = sessionsRef.current[m.sessionId];
      if (live) notifyIfAway(live, m.event);
      setSessions((prev) => {
        const s = prev[m.sessionId];
        if (!s) return prev;
        if (m.seq > 0 && m.seq <= s.lastSeq) return prev;
        return { ...prev, [m.sessionId]: reduceEvent(s, m.event, m.seq) };
      });
    });
    return off;
  }, []);

  // Re-attach sessions remembered from a previous page load (same server lifetime).
  useEffect(() => {
    let saved: Persisted[] = [];
    try { saved = JSON.parse(localStorage.getItem(LS_ACTIVE) || '[]'); } catch { /* ignore */ }
    if (!saved.length) return;
    setSessions((prev) => {
      const next = { ...prev };
      for (const p of saved) if (!next[p.id]) next[p.id] = { id: p.id, agent: p.agent, cwd: p.cwd, agentSessionId: p.agentSessionId, historyLen: p.historyLen, permissionMode: p.permissionMode ?? 'default', model: p.model, status: 'idle', items: [], totalCostUsd: 0, lastSeq: 0 };
      return next;
    });
    for (const p of saved) void reattach(p);
  }, []);

  /**
   * The server buffer only holds events since the session started, so a resumed Claude session
   * must get its earlier conversation from the saved history before the buffer is replayed.
   */
  const reattach = async (p: Persisted) => {
    let after = 0;
    if (p.agent === 'claude' && p.agentSessionId && p.historyLen !== 0) {
      try {
        const all = await api.historyMessages(p.cwd, p.agentSessionId);
        // Entries saved before historyLen existed: show the full history and skip the replay it already contains.
        const items = itemsFromHistory(p.historyLen === undefined ? all : all.slice(0, p.historyLen));
        if (p.historyLen === undefined) { after = Number.MAX_SAFE_INTEGER; skipReplay.current.add(p.id); }
        setSessions((prev) => prev[p.id] ? { ...prev, [p.id]: { ...prev[p.id], items: [...items, ...prev[p.id].items], historyLen: p.historyLen ?? all.length } } : prev);
      } catch { /* history is optional */ }
    }
    await agentClient.ready;
    agentClient.send({ type: 'session.attach', sessionId: p.id, after });
  };

  useEffect(() => {
    const list: Persisted[] = Object.values(sessions).filter((s) => s.status !== 'closed').map((s) => ({ id: s.id, cwd: s.cwd, agent: s.agent, agentSessionId: s.agentSessionId, permissionMode: s.permissionMode, model: s.model, historyLen: s.historyLen }));
    try { localStorage.setItem(LS_ACTIVE, JSON.stringify(list)); } catch { /* ignore */ }
  }, [sessions]);

  const markLost = (id: string) => setSessions((prev) => {
    const s = prev[id];
    if (!s) return prev;
    const closed = reduceEvent(s, { kind: 'status', status: 'closed' }, 0);
    return { ...prev, [id]: { ...closed, items: [...closed.items, { kind: 'system', id: `gone-${id}`, text: t('session.lost') }] } };
  });

  const start = useCallback(async (cwd: string, opts: { resume?: string; permissionMode?: PermissionModeId; agent?: AgentId; model?: string | null; replaces?: string } = {}) => {
    let preload: ChatItem[] = [];
    let historyLen: number | undefined;
    if ((opts.agent ?? 'claude') === 'claude') {
      historyLen = 0;
      if (opts.resume) {
        try { const msgs = await api.historyMessages(cwd, opts.resume); preload = itemsFromHistory(msgs); historyLen = msgs.length; } catch { /* history is optional */ }
      }
    }
    return new Promise<string>((resolve, reject) => {
      const requestId = crypto.randomUUID();
      pendingStart.current.set(requestId, { cwd, resolve, reject, preload, historyLen, replaces: opts.replaces });
      agentClient.send({ type: 'session.start', requestId, agent: opts.agent ?? 'claude', cwd, resume: opts.resume, permissionMode: opts.permissionMode, model: opts.model ?? undefined });
    });
  }, []);
  const startRef = useRef(start);

  const send = useCallback((sessionId: string, text: string, attachments: Attachment[]) => {
    // Show the message immediately; the server's echo confirms it (see reducer) instead of adding a duplicate.
    setSessions((prev) => {
      const s = prev[sessionId];
      if (!s) return prev;
      return { ...prev, [sessionId]: { ...s, items: [...s.items, { kind: 'user', id: `local-${Date.now()}`, text, attachments, pending: true }], status: s.status === 'idle' ? 'running' : s.status, turnStartedAt: s.turnStartedAt ?? Date.now() } };
    });
    agentClient.send({ type: 'session.send', sessionId, text, attachments });
  }, []);
  const approve = useCallback((sessionId: string, requestId: string, decision: 'allow' | 'allow_always' | 'deny', message?: string) => {
    agentClient.send({ type: 'session.approve', sessionId, requestId, decision, message });
  }, []);
  const answer = useCallback((sessionId: string, requestId: string, answers: Record<string, string>, response?: string) => {
    agentClient.send({ type: 'session.answer', sessionId, requestId, answers, response });
  }, []);
  const interrupt = useCallback((sessionId: string) => agentClient.send({ type: 'session.interrupt', sessionId }), []);
  const setMode = useCallback((sessionId: string, mode: PermissionModeId) => agentClient.send({ type: 'session.mode', sessionId, mode }), []);
  const setModel = useCallback((sessionId: string, model: string | null) => agentClient.send({ type: 'session.model', sessionId, model }), []);
  const close = useCallback((sessionId: string) => {
    agentClient.send({ type: 'session.close', sessionId });
    setSessions((prev) => { const n = { ...prev }; delete n[sessionId]; return n; });
  }, []);

  return { sessions, replaced, start, send, approve, answer, interrupt, setMode, setModel, close };
}
