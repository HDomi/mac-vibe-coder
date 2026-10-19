import type { AgentId } from '../lib/agent';

/** Small brand-ish marks for the two agents (Claude: terracotta starburst, Codex: monochrome hex knot). */
export default function AgentIcon({ agent, size = 16, className = '', title }: { agent: AgentId; size?: number; className?: string; title?: string }) {
  const label = title ?? (agent === 'claude' ? 'Claude Code' : 'Codex');
  if (agent === 'claude') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-label={label}>
        <title>{label}</title>
        <rect width="24" height="24" rx="6" fill="#D97757" />
        <g fill="#fff">
          <rect x="11" y="4" width="2" height="16" rx="1" />
          <rect x="4" y="11" width="16" height="2" rx="1" />
          <rect x="11" y="4" width="2" height="16" rx="1" transform="rotate(45 12 12)" />
          <rect x="11" y="4" width="2" height="16" rx="1" transform="rotate(-45 12 12)" />
          <rect x="11" y="6" width="2" height="12" rx="1" transform="rotate(22.5 12 12)" opacity=".7" />
          <rect x="11" y="6" width="2" height="12" rx="1" transform="rotate(-22.5 12 12)" opacity=".7" />
          <rect x="11" y="6" width="2" height="12" rx="1" transform="rotate(67.5 12 12)" opacity=".7" />
          <rect x="11" y="6" width="2" height="12" rx="1" transform="rotate(-67.5 12 12)" opacity=".7" />
        </g>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-label={label}>
      <title>{label}</title>
      <rect width="24" height="24" rx="6" fill="#0f0f10" stroke="#3f3f46" />
      <g fill="none" stroke="#e4e4e7" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M12 4.5 18.5 8.25v7.5L12 19.5 5.5 15.75v-7.5Z" />
        <path d="M12 8.2 15.3 10.1v3.8L12 15.8 8.7 13.9v-3.8Z" />
        <path d="M12 4.5v3.7M18.5 8.25l-3.2 1.85M18.5 15.75l-3.2-1.85M12 19.5v-3.7M5.5 15.75l3.2-1.85M5.5 8.25l3.2 1.85" />
      </g>
    </svg>
  );
}
