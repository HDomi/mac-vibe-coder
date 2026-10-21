import type { TaskInfo } from './agent';

/** One box of the task relation graph: the session at the top, every task it (or a task) spawned below. */
export interface GraphNode {
  id: string;
  /** 'root' for the parent session; else the task. */
  task: TaskInfo | null;
  depth: number;
  /** Top-left corner in graph units. */
  x: number;
  y: number;
}

export interface GraphEdge { from: string; to: string }

export interface GraphLayout { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number }

export const NODE_W = 150;
export const NODE_H = 46;
const GAP_X = 14;
const GAP_Y = 42;

export const ROOT_ID = '__session__';

/**
 * Tidy top-down tree (what `graph TD` in mermaid draws): leaves take one column each in start
 * order, a parent sits centred over its children. A task whose parent is unknown (ended before
 * we saw it, or launched by a teammate) hangs off the session root so nothing is lost.
 */
export function layoutTaskTree(tasks: TaskInfo[]): GraphLayout {
  const known = new Set(tasks.map((t) => t.id));
  const children = new Map<string, TaskInfo[]>();
  for (const t of tasks) {
    const parent = t.parentId && known.has(t.parentId) && t.parentId !== t.id ? t.parentId : ROOT_ID;
    const l = children.get(parent) ?? [];
    l.push(t);
    children.set(parent, l);
  }
  for (const l of children.values()) l.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let maxDepth = 0;
  // Leaf columns are handed out left to right; a parent's column is the middle of its children's span.
  let nextCol = 0;
  const seen = new Set<string>();
  const place = (id: string, task: TaskInfo | null, depth: number): number => {
    seen.add(id);
    maxDepth = Math.max(maxDepth, depth);
    const kids = (children.get(id) ?? []).filter((k) => !seen.has(k.id));
    let col: number;
    if (!kids.length) col = nextCol++;
    else {
      const cols = kids.map((k) => { edges.push({ from: id, to: k.id }); return place(k.id, k, depth + 1); });
      col = (cols[0] + cols[cols.length - 1]) / 2;
    }
    nodes.push({ id, task, depth, x: col * (NODE_W + GAP_X), y: depth * (NODE_H + GAP_Y) });
    return col;
  };
  place(ROOT_ID, null, 0);
  // Keep parents before children for a natural tab / paint order.
  nodes.sort((a, b) => a.depth - b.depth || a.x - b.x);
  return { nodes, edges, width: Math.max(nextCol, 1) * (NODE_W + GAP_X) - GAP_X, height: (maxDepth + 1) * (NODE_H + GAP_Y) - GAP_Y };
}

/** Short label for a chip or node: the agent type for subagents, else what kind of task it is. */
export function taskKind(t: TaskInfo): string {
  if (t.subagentType) return t.subagentType;
  switch (t.type) {
    case 'local_agent': return 'agent';
    case 'local_bash': return 'shell';
    case 'local_workflow': return 'workflow';
    case 'monitor': return 'monitor';
    case 'mcp_task': return 'mcp';
    default: return t.type.replace(/^local_/, '');
  }
}

/** Compact "1.2k" / "35k" token count. */
export function shortTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
