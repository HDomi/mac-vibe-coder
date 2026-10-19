import type { GitCommit } from './api';

export const GRAPH_COLORS = ['#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#e879f9'];
export const GRAPH_ROW_HEIGHT = 76;
export const GRAPH_LANE_WIDTH = 16;
export const graphX = (lane: number) => 14 + lane * GRAPH_LANE_WIDTH;

interface Lane { hash: string; color: number }
export interface GraphEdge { from: number; to: number; color: number; half?: 'top' | 'bottom' }
export interface GraphRow { lane: number; color: number; edges: GraphEdge[] }

/** Keep pending parents in lanes so pagination preserves every connection. */
export function layoutGitGraph(commits: Pick<GitCommit, 'hash' | 'parents'>[]) {
  let lanes: Lane[] = [];
  let nextColor = 0;
  let width = 1;
  const rows: GraphRow[] = [];
  for (const commit of commits) {
    let lane = lanes.findIndex((l) => l.hash === commit.hash);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push({ hash: commit.hash, color: nextColor++ % GRAPH_COLORS.length });
    }
    const before = [...lanes];
    const color = before[lane].color;
    const parents = [...new Set(commit.parents)];
    lanes.splice(lane, 1);
    parents.forEach((hash, i) => {
      if (lanes.some((l) => l.hash === hash)) return;
      const entry = { hash, color: i === 0 ? color : nextColor++ % GRAPH_COLORS.length };
      if (i === 0) lanes.splice(lane, 0, entry);
      else lanes.push(entry);
    });
    const edges: GraphEdge[] = [];
    before.forEach((entry, from) => {
      if (from === lane) {
        // A new branch tip has no incoming line.
        if (rows.length && rows[rows.length - 1].edges.some((e) => e.half !== 'top' && e.to === from)) {
          edges.push({ from, to: from, color, half: 'top' });
        }
        return;
      }
      const to = lanes.findIndex((l) => l.hash === entry.hash);
      edges.push({ from, to, color: entry.color });
    });
    parents.forEach((hash, i) => {
      const to = lanes.findIndex((l) => l.hash === hash);
      edges.push({ from: lane, to, color: i === 0 ? color : lanes[to].color, half: 'bottom' });
    });
    width = Math.max(width, before.length, lanes.length);
    rows.push({ lane, color, edges });
  }
  return { rows, width: graphX(width - 1) + 14 };
}
