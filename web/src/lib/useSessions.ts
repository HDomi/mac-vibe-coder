import { useCallback, useEffect, useRef, useState } from 'react';
import { agentClient, type AgentId, type Attachment, type PermissionModeId, type RewindResult, type ServerMessage } from './agent';
import { ACTIVITY_EVENTS, displayTitle, itemsFromHistory, reduceEvent, type ChatItem, type ChatSession } from './chatStore';
import { api } from './api';
import { t } from './i18n';

const LS_ACTIVE = 'vibe.sessions';

/** Session currently on screen; a result there needs no notification while the window is focused. */
let onScreenSession: string | null = null;
export function setOnScreenSession(id: string | null) { onScreenSession = id; }

function sessionName(s: ChatSession) { return displayTitle(s, 24) ?? s.cwd.split('/').pop() ?? s.agent; }

/**
 * Notify when the user is not looking at this session: the window is unfocused or hidden, or
 * another session/view is on screen. Native (Electron) when available, web Notification otherwise.
 */
function notifyIfAway(s: ChatSession, e: { kind: string; text?: string; toolName?: string; ok?: boolean; requestId?: string; canAlwaysAllow?: boolean; status?: string; command?: string }) {
  if (e.kind === 'approval.resolved' && e.requestId) { window.vibe?.closeNotification?.(e.requestId); return; }
  if (document.hasFocus() && document.visibilityState === 'visible' && onScreenSession === s.id) return;
  const name = sessionName(s);
  let title: string | null = null; let body = '';
  if (e.kind === 'result') { title = t(e.ok ? 'notif.sessionDone' : 'notif.sessionFailed', { name }); body = (e.text ?? '').slice(0, 120); }
  else if (e.kind === 'approval.request') { title = t('notif.approval'); body = `${name} · ${t('notif.allow', { tool: e.toolName ?? '' })}`; }
  else if (e.kind === 'question.request') { title = t('notif.question'); body = `${name} · ${t('notif.waiting')}`; }
  else if (e.kind === 'verify' && e.status === 'failed') { title = t('notif.verifyFailed', { name }); body = e.command ?? ''; }
  if (!title) return;
  if (window.vibe?.notify) {
    const approval = e.kind === 'approval.request' && e.requestId
      ? { requestId: e.requestId, canAlwaysAllow: !!e.canAlwaysAllow, labels: [t('items.allow'), t('items.alwaysAllow'), t('items.deny')] as [string, string, string] }
      : undefined;
    window.vibe.notify({ title, body, sessionId: s.id, approval });
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, silent: false });
    n.onclick = () => { window.focus(); window.dispatchEvent(new CustomEvent('vibe:notify-click', { detail: { sessionId: s.id } })); };
  } catch { /* ignore */ }
}

export function requestNotificationPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
}

interface Persisted { id: string; cwd: string; agent: AgentId; agentSessionId?: string; permissionMode?: PermissionModeId; model?: string; historyLen?: number; title?: string; pinned?: boolean; lastActivity?: number }
interface PendingStart { cwd: string; resolve: (id: string) => void; reject: (err: Error) => void; preload: ChatItem[]; historyLen?: number; replaces?: string; title?: string }
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
  const pendingRewind = useRef(new Map<string, (r: RewindResult) => void>());

  useEffect(() => {
    const off = agentClient.on((m: ServerMessage) => {
      if ('type' in m) {
        if (m.type === 'reconnected') {
          // The server lost this socket's subscriptions; re-attach every live session from where we left off.
          for (const s of Object.values(sessionsRef.current)) if (s.status !== 'closed') agentClient.send({ type: 'session.attach', sessionId: s.id, after: s.lastSeq || (skipReplay.current.has(s.id) ? Number.MAX_SAFE_INTEGER : 0) });
          return;
        }
        if (m.type === 'pong') return;
        if (m.type === 'session.rewindResult') {
          pendingRewind.current.get(m.requestId)?.(m.result);
          pendingRewind.current.delete(m.requestId);
          return;
        }
        if (m.type === 'session.attached') {
          setSessions((prev) => prev[m.sessionId]?.restoring ? { ...prev, [m.sessionId]: { ...prev[m.sessionId], restoring: undefined } } : prev);
          return;
        }
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
            items: p?.preload ?? [], historyLen: p?.historyLen, title: p?.title, totalCostUsd: 0, lastSeq: 0, lastActivity: Date.now(),
          };
          const old = p?.replaces;
          setSessions((prev) => {
            const was = old ? prev[old] : undefined;
            if (!old || !was) return { ...prev, [m.sessionId]: fresh };
            // Keep the tab where it was and the conversation on screen; history replay (Claude) wins when available.
            const items = fresh.items.length ? fresh.items : was.items.filter((it) => !it.id.startsWith('gone-')).map((it) =>
              it.kind === 'assistant' ? { ...it, streaming: false } : it.kind === 'tool' ? { ...it, done: true } : it);
            const revived: ChatSession = { ...fresh, title: fresh.title ?? was.title, pinned: was.pinned, lastActivity: was.lastActivity, permissionMode: was.permissionMode, model: was.model, agentSessionId: was.agentSessionId, items: [...items, { kind: 'system', id: `revived-${m.sessionId}`, text: t('session.revived') }] };
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
          startRef.current(s.cwd, { agent: s.agent, resume: s.agentSessionId, permissionMode: s.permissionMode, model: s.model, replaces: s.id, title: s.title })
            .catch(() => markLost(s.id))
            .finally(() => reviving.current.delete(s.id));
        }
        return;
      }
      const live = sessionsRef.current[m.sessionId];
      if (live) notifyIfAway(live, m.event);
      // The CLI writes its generated title a moment after a turn ends; pick it up so tabs match the history list.
      if (m.event.kind === 'result') setTimeout(() => refreshTitle(m.sessionId), 3000);
      setSessions((prev) => {
        const s = prev[m.sessionId];
        if (!s) return prev;
        if (m.seq > 0 && m.seq <= s.lastSeq) return prev;
        const next = reduceEvent(s, m.event, m.seq);
        if (ACTIVITY_EVENTS.has(m.event.kind) && m.ts > (next.lastActivity ?? 0)) next.lastActivity = m.ts;
        return { ...prev, [m.sessionId]: next };
      });
    });
    return off;
  }, []);

  const refreshTitle = (id: string) => {
    const s = sessionsRef.current[id];
    if (!s?.agentSessionId) return;
    api.history(s.cwd, s.agent).then((rows) => {
      const h = rows.find((r) => r.sessionId === s.agentSessionId);
      const title = h?.customTitle || h?.summary;
      if (!title) return;
      setSessions((prev) => prev[id] && prev[id].title !== title ? { ...prev, [id]: { ...prev[id], title } } : prev);
    }).catch(() => { /* title is cosmetic */ });
  };

  // Re-attach sessions remembered from a previous page load (same server lifetime).
  useEffect(() => {
    let saved: Persisted[] = [];
    try { saved = JSON.parse(localStorage.getItem(LS_ACTIVE) || '[]'); } catch { /* ignore */ }
    if (!saved.length) return;
    setSessions((prev) => {
      const next = { ...prev };
      for (const p of saved) if (!next[p.id]) next[p.id] = { id: p.id, agent: p.agent, cwd: p.cwd, agentSessionId: p.agentSessionId, historyLen: p.historyLen, title: p.title, pinned: p.pinned, lastActivity: p.lastActivity, permissionMode: p.permissionMode ?? 'default', model: p.model, status: 'idle', items: [], totalCostUsd: 0, lastSeq: 0, restoring: true };
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
      } catch (err) {
        // History is optional; the attach below still revives the session. Logged so a blank tab can be traced.
        console.warn(`[vibe] history for remembered session ${p.id} failed:`, (err as Error).message);
      }
    }
    await agentClient.ready;
    agentClient.send({ type: 'session.attach', sessionId: p.id, after });
  };

  useEffect(() => {
    const list: Persisted[] = Object.values(sessions).filter((s) => s.status !== 'closed').map((s) => ({ id: s.id, cwd: s.cwd, agent: s.agent, agentSessionId: s.agentSessionId, permissionMode: s.permissionMode, model: s.model, historyLen: s.historyLen, title: s.title, pinned: s.pinned, lastActivity: s.lastActivity }));
    try { localStorage.setItem(LS_ACTIVE, JSON.stringify(list)); } catch { /* ignore */ }
  }, [sessions]);

  const markLost = (id: string) => setSessions((prev) => {
    const s = prev[id];
    if (!s) return prev;
    const closed = reduceEvent(s, { kind: 'status', status: 'closed' }, 0);
    return { ...prev, [id]: { ...closed, items: [...closed.items, { kind: 'system', id: `gone-${id}`, text: t('session.lost') }] } };
  });

  const start = useCallback(async (cwd: string, opts: { resume?: string; permissionMode?: PermissionModeId; agent?: AgentId; model?: string | null; replaces?: string; title?: string } = {}) => {
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
      pendingStart.current.set(requestId, { cwd, resolve, reject, preload, historyLen, replaces: opts.replaces, title: opts.title });
      agentClient.send({ type: 'session.start', requestId, agent: opts.agent ?? 'claude', cwd, resume: opts.resume, permissionMode: opts.permissionMode, model: opts.model ?? undefined });
    });
  }, []);
  const startRef = useRef(start);

  const send = useCallback((sessionId: string, text: string, attachments: Attachment[]) => {
    const messageId = crypto.randomUUID();
    // Show the message immediately; the server's echo confirms it (see reducer) instead of adding a duplicate.
    setSessions((prev) => {
      const s = prev[sessionId];
      if (!s) return prev;
      return { ...prev, [sessionId]: { ...s, items: [...s.items, { kind: 'user', id: messageId, text, attachments, pending: true }], status: s.status === 'idle' ? 'running' : s.status, turnStartedAt: s.turnStartedAt ?? Date.now(), lastActivity: Date.now() } };
    });
    agentClient.send({ type: 'session.send', sessionId, text, attachments, messageId });
  }, []);
  const approve = useCallback((sessionId: string, requestId: string, decision: 'allow' | 'allow_always' | 'deny', message?: string) => {
    agentClient.send({ type: 'session.approve', sessionId, requestId, decision, message });
  }, []);
  const answer = useCallback((sessionId: string, requestId: string, answers: Record<string, string>, response?: string) => {
    agentClient.send({ type: 'session.answer', sessionId, requestId, answers, response });
  }, []);
  const interrupt = useCallback((sessionId: string) => agentClient.send({ type: 'session.interrupt', sessionId }), []);
  /** Stop one subagent / background task; the turn keeps going. Claude sessions only. */
  const stopTask = useCallback((sessionId: string, taskId: string) => agentClient.send({ type: 'session.stopTask', sessionId, taskId }), []);
  const setMode = useCallback((sessionId: string, mode: PermissionModeId) => agentClient.send({ type: 'session.mode', sessionId, mode }), []);
  const setModel = useCallback((sessionId: string, model: string | null) => agentClient.send({ type: 'session.model', sessionId, model }), []);
  /** Preview (dryRun) or undo the file changes made since a user message. Claude sessions only. */
  const rewind = useCallback((sessionId: string, messageId: string, dryRun: boolean) => new Promise<RewindResult>((resolve) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pendingRewind.current.delete(requestId); resolve({ canRewind: false, error: t('rewind.timeout') }); }, 30000);
    pendingRewind.current.set(requestId, (r) => {
      clearTimeout(timer);
      if (!dryRun && r.canRewind) {
        setSessions((prev) => {
          const s = prev[sessionId];
          return s ? { ...prev, [sessionId]: { ...s, items: [...s.items, { kind: 'system', id: `rewind-${requestId}`, text: t('rewind.done') }] } } : prev;
        });
      }
      resolve(r);
    });
    agentClient.send({ type: 'session.rewind', sessionId, requestId, messageId, dryRun });
  }), []);
  /** Run the project's verification command now (results arrive as `verify` events). */
  const verify = useCallback((sessionId: string) => agentClient.send({ type: 'session.verify', sessionId }), []);
  const setPinned = useCallback((sessionId: string, pinned: boolean) => {
    setSessions((prev) => prev[sessionId] ? { ...prev, [sessionId]: { ...prev[sessionId], pinned: pinned || undefined } } : prev);
  }, []);
  const close = useCallback((sessionId: string) => {
    agentClient.send({ type: 'session.close', sessionId });
    setSessions((prev) => { const n = { ...prev }; delete n[sessionId]; return n; });
  }, []);

  return { sessions, replaced, start, send, approve, answer, interrupt, stopTask, setMode, setModel, setPinned, rewind, verify, close };
}
