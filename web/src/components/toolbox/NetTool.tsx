import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ListeningPort, type NetInfo } from '../../lib/api';
import { contains, parseSubnet } from '../../lib/toolbox/cidr';
import { t } from '../../lib/i18n';
import { CopyButton, Rows, Section, btn, errText, input, mono, usePersisted } from './ui';
import { openTool } from './bus';

export default function NetTool() {
  return (
    <div className="h-full flex flex-col gap-5 min-h-0 overflow-y-auto pr-1">
      <ThisMac />
      <Ports />
      <Cidr />
    </div>
  );
}

function ThisMac() {
  const [info, setInfo] = useState<NetInfo | null>(null);
  const [pub, setPub] = useState<string | null>(null);
  const [pubErr, setPubErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.netInfo().then(setInfo).catch(() => {}); }, []);
  const lookup = async () => {
    setBusy(true); setPubErr(null);
    try {
      const r = await api.netHttp({ method: 'GET', url: 'https://api.ipify.org?format=json', timeoutMs: 8000 });
      if (!r.ok) throw new Error(r.error);
      setPub(JSON.parse(r.body).ip);
    } catch (e) { setPubErr(errText(e)); } finally { setBusy(false); }
  };
  const external = info?.interfaces.filter((i) => !i.internal && !i.address.startsWith('fe80')) ?? [];
  return (
    <Section title={t('tb.net.thisMac')} actions={<button className={btn} disabled={busy} onClick={lookup}>{t('tb.net.publicIp')}</button>}>
      {info && <Rows rows={[
        { label: t('tb.net.hostname'), value: info.hostname },
        ...(info.lan ? [{ label: t('tb.net.lanIp'), value: info.lan, hint: t('tb.net.lanHint') }] : []),
        ...(pub ? [{ label: t('tb.net.publicIpLabel'), value: pub }] : []),
        ...external.filter((i) => i.address !== info.lan).map((i) => ({ label: `${i.name} · ${i.family}`, value: i.address, hint: i.cidr ?? undefined })),
      ]} />}
      {pubErr && <div className="text-[11px] text-red-400">{pubErr}</div>}
      <div className="text-[11px] text-zinc-600">{t('tb.net.publicNote')}</div>
    </Section>
  );
}

function Ports() {
  const [list, setList] = useState<ListeningPort[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = usePersisted('net.filter', '');
  const [stopped, setStopped] = useState<Record<number, 'term' | 'kill'>>({});
  const [lan, setLan] = useState<string | null>(null);
  const load = useCallback(() => { api.netPorts().then((l) => { setList(l); setErr(null); }).catch((e) => setErr(errText(e))); }, []);
  useEffect(() => { load(); api.netInfo().then((i) => setLan(i.lan)).catch(() => {}); }, [load]);
  const home = useMemo(() => list?.find((p) => p.cwd?.startsWith('/Users/'))?.cwd?.split('/').slice(0, 3).join('/') ?? '', [list]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    // One row per (pid, port); the address column lists every bound interface.
    const groups = new Map<string, ListeningPort & { addresses: string[] }>();
    for (const p of list ?? []) {
      const key = `${p.pid}:${p.port}`;
      const g = groups.get(key);
      if (g) g.addresses.push(p.address); else groups.set(key, { ...p, addresses: [p.address] });
    }
    return [...groups.values()].filter((p) => !f || String(p.port).includes(f) || p.command.toLowerCase().includes(f) || String(p.pid) === f || (p.cwd ?? '').toLowerCase().includes(f));
  }, [list, filter]);
  const stop = async (p: ListeningPort, force: boolean) => {
    if (!window.confirm(t(force ? 'tb.net.confirmKill' : 'tb.net.confirmStop', { name: p.command, pid: p.pid, port: p.port }))) return;
    try { await api.netKill(p.pid, force); setStopped((s) => ({ ...s, [p.pid]: force ? 'kill' : 'term' })); setTimeout(load, 800); }
    catch (e) { window.alert(errText(e)); }
  };
  const local = (a: string[]) => a.every((x) => x === '127.0.0.1' || x === '::1' || x === 'localhost');
  return (
    <Section title={t('tb.net.ports')} actions={<>
      <input className={`${input} w-44 py-0.5`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('tb.net.filter')} spellCheck={false} />
      <button className={btn} onClick={load}>{t('common.refresh')}</button>
    </>}>
      {err && <div className="text-[11px] text-red-400">{err}</div>}
      <div className="rounded-md border border-white/10 overflow-hidden text-[12px]">
        <div className="grid grid-cols-[64px_100px_1fr_64px_1.2fr_240px] gap-3 px-2.5 py-1.5 bg-white/[.03] text-[11px] text-zinc-500">
          <span>{t('tb.net.port')}</span><span>{t('tb.net.bind')}</span><span>{t('tb.net.process')}</span><span>PID</span><span>{t('tb.net.folder')}</span><span />
        </div>
        {list === null && <div className="px-2.5 py-2 text-zinc-500">{t('common.loading')}</div>}
        {list && !shown.length && <div className="px-2.5 py-2 text-zinc-500">{t('tb.net.noPorts')}</div>}
        {shown.map((p) => (
          <div key={`${p.pid}:${p.port}`} className={`grid grid-cols-[64px_100px_1fr_64px_1.2fr_240px] gap-3 items-center px-2.5 py-1 border-t border-white/5 ${stopped[p.pid] ? 'opacity-40' : ''}`}>
            <span className={`${mono} text-zinc-100`}>{p.port}</span>
            <span className={`text-[11px] ${local(p.addresses) ? 'text-zinc-500' : 'text-amber-300'}`} title={p.addresses.join(', ')}>{local(p.addresses) ? t('tb.net.localOnly') : t('tb.net.allIfaces')}</span>
            <span className="truncate text-zinc-300" title={p.command}>{p.command}{p.self && <span className="ml-1.5 text-[10px] text-blue-300">{t('tb.net.thisApp')}</span>}</span>
            <span className={`${mono} text-zinc-500`}>{p.pid}</span>
            <span className="truncate text-[11px] text-zinc-500" title={p.cwd ?? ''}>{p.cwd ? (home && p.cwd.startsWith(home) ? `~${p.cwd.slice(home.length)}` : p.cwd) : '—'}</span>
            <span className="flex items-center justify-end gap-1.5">
              <CopyButton text={`http://localhost:${p.port}`} label="URL" />
              <button className={btn} onClick={() => openTool('http', { request: { method: 'GET', url: `http://localhost:${p.port}/`, headers: [] } })}>{t('tb.net.request')}</button>
              {lan && !local(p.addresses) && <button className={btn} title={t('tb.net.qrHint')} onClick={() => openTool('qr', { text: `http://${lan}:${p.port}/` })}>QR</button>}
              {!p.self && (stopped[p.pid] === 'term'
                ? <button className={`${btn} text-red-300`} onClick={() => stop(p, true)}>{t('tb.net.forceKill')}</button>
                : <button className={`${btn} text-red-300`} onClick={() => stop(p, false)}>{t('tb.net.stop')}</button>)}
            </span>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-zinc-600 leading-relaxed">{t('tb.net.portsNote')}</div>
    </Section>
  );
}

function Cidr() {
  const [text, setText] = usePersisted('net.cidr', '192.168.0.10/24');
  const [probe, setProbe] = usePersisted('net.probe', '');
  const r = useMemo(() => { try { return { ok: true as const, s: parseSubnet(text) }; } catch (e) { return { ok: false as const, msg: errText(e) }; } }, [text]);
  const inside = useMemo(() => { if (!r.ok || !probe.trim()) return null; try { return contains(r.s, probe); } catch { return undefined; } }, [r, probe]);
  return (
    <Section title={t('tb.net.cidr')}>
      <div className="flex items-center gap-3">
        <input className={`${input} w-64 ${!r.ok ? 'border-red-500/50' : ''}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="10.0.0.0/16 · 10.0.0.1 255.255.0.0" spellCheck={false} />
        <span className="text-[11px] text-zinc-500">{t('tb.net.contains')}</span>
        <input className={`${input} w-40`} value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="10.0.3.7" spellCheck={false} />
        {inside === true && <span className="text-[11px] text-emerald-300">{t('tb.net.inside')}</span>}
        {inside === false && <span className="text-[11px] text-red-300">{t('tb.net.outside')}</span>}
        {inside === undefined && <span className="text-[11px] text-red-400">{t('tb.net.badIp')}</span>}
      </div>
      {!r.ok ? <div className="text-[11px] text-red-400">{r.msg}</div> : (
        <Rows rows={[
          { label: t('tb.net.network'), value: `${r.s.network}/${r.s.prefix}`, hint: t(`tb.net.kind.${r.s.kind}`) },
          { label: t('tb.net.mask'), value: r.s.mask, hint: `${t('tb.net.wildcard')} ${r.s.wildcard}` },
          { label: t('tb.net.range'), value: `${r.s.first} – ${r.s.last}` },
          { label: t('tb.net.broadcast'), value: r.s.broadcast },
          { label: t('tb.net.hosts'), value: r.s.hosts.toLocaleString(), hint: `${t('tb.net.total')} ${r.s.total.toLocaleString()}` },
        ]} />
      )}
    </Section>
  );
}
