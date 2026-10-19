import { useCallback, useEffect, useRef, useState } from 'react';
import { agentClient, type AgentId, type Attachment, type PermissionModeId, type ServerMessage } from './agent';
import { itemsFromHistory, reduceEvent, type ChatItem, type ChatSession } from './chatStore';
import { api } from './api';
import { t } from './i18n';

const LS_ACTIVE = 'vibe.sessions';

function notifyIfHidden(e: { kind: string; text?: string; toolName?: string; ok?: boolean }) {
  if (typeof Notification === 'undefined' || document.visibilityState === 'visible') return;
  if (Notification.permission !== 'granted') return;
  let title: string | null = null; let body = '';
  if (e.kind === 'result') { title = e.ok ? t('notif.finished') : t('notif.failed'); body = (e.text ?? '').slice(0, 120); }
  else if (e.kind === 'approval.request') { title = t('notif.approval'); body = t('notif.allow', { tool: e.toolName ?? '' }); }
  else if (e.kind === 'question.request') { title = t('notif.question'); body = t('notif.waiting'); }
  if (!title) return;
  try { new Notification(title, { body, silent: false }); } catch { /* ignore */ }
}

export function requestNotificationPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
}

interface Persisted { id: string; cwd: string; agent: AgentId; agentSessionId?: string }

export function useSessions() {
  const [sessions, setSessions] = useState<Record<string, ChatSession>>({});
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  const pendingStart = useRef(new Map<string, { cwd: string; resolve: (id: string) => void; preload: ChatItem[] }[]>());

  useEffect(() => {
    const off = agentClient.on((m: ServerMessage) => {
      if ('type' in m) {
        if (m.type === 'reconnected') {
          // The server lost this socket's subscriptions; re-attach every live session from where we left off.
          for (const s of Object.values(sessionsRef.current)) if (s.status !== 'closed') agentClient.send({ type: 'session.attach', sessionId: s.id, after: s.lastSeq });
          return;
        }
        if (m.type === 'pong') return;
        if (m.type === 'session.started') {
          const queue = pendingStart.current.get(m.requestCwd) ?? [];
          const p = queue.shift();
          if (queue.length === 0) pendingStart.current.delete(m.requestCwd);
          setSessions((prev) => ({
            ...prev,
            [m.sessionId]: {
              id: m.sessionId, agent: m.agent ?? 'claude', cwd: m.requestCwd, permissionMode: 'default', status: 'starting',
              items: p?.preload ?? [], totalCostUsd: 0, lastSeq: 0,
            },
          }));
          p?.resolve(m.sessionId);
        } else if (m.type === 'session.missing') {
          setSessions((prev) => {
            const s = prev[m.sessionId];
            if (!s) return prev;
            return { ...prev, [m.sessionId]: { ...s, status: 'closed', items: [...s.items, { kind: 'system', id: `gone-${m.sessionId}`, text: t('session.lost') }] } };
          });
        }
        return;
      }
      notifyIfHidden(m.event);
      setSessions((prev) => {
        const s = prev[m.sessionId];
        if (!s) return prev;
        if (m.seq <= s.lastSeq) return prev;
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
      for (const p of saved) if (!next[p.id]) next[p.id] = { id: p.id, agent: p.agent, cwd: p.cwd, agentSessionId: p.agentSessionId, permissionMode: 'default', status: 'idle', items: [], totalCostUsd: 0, lastSeq: 0 };
      return next;
    });
    agentClient.ready.then(() => { for (const p of saved) agentClient.send({ type: 'session.attach', sessionId: p.id }); });
  }, []);

  useEffect(() => {
    const list: Persisted[] = Object.values(sessions).filter((s) => s.status !== 'closed').map((s) => ({ id: s.id, cwd: s.cwd, agent: s.agent, agentSessionId: s.agentSessionId }));
    try { localStorage.setItem(LS_ACTIVE, JSON.stringify(list)); } catch { /* ignore */ }
  }, [sessions]);

  const start = useCallback(async (cwd: string, opts: { resume?: string; permissionMode?: PermissionModeId; agent?: AgentId; model?: string | null } = {}) => {
    let preload: ChatItem[] = [];
    if (opts.resume && (opts.agent ?? 'claude') === 'claude') {
      try { preload = itemsFromHistory(await api.historyMessages(cwd, opts.resume)); } catch { /* history is optional */ }
    }
    return new Promise<string>((resolve) => {
      const queue = pendingStart.current.get(cwd) ?? [];
      queue.push({ cwd, resolve, preload });
      pendingStart.current.set(cwd, queue);
      agentClient.send({ type: 'session.start', agent: opts.agent ?? 'claude', cwd, resume: opts.resume, permissionMode: opts.permissionMode, model: opts.model ?? undefined });
    });
  }, []);

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

  return { sessions, start, send, approve, answer, interrupt, setMode, setModel, close };
}
