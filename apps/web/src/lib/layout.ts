import type { GraphView } from './types';

export interface Placed {
  id: string;
  x: number;
  y: number;
}

/**
 * Small deterministic force layout: pairwise repulsion, springs on edges and a
 * pull to the centre, cooled over a fixed number of steps. O(n²) per step is
 * fine for a few hundred topics and avoids a charting dependency.
 */
export function forceLayout(graph: GraphView, steps = 400): Map<string, Placed> {
  const n = graph.nodes.length;
  const pos = graph.nodes.map((node, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2;
    const r = 200 + (i % 7) * 25;
    return { id: node.id, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 };
  });
  const index = new Map(pos.map((p, i) => [p.id, i]));
  const springs = graph.edges
    .map((e) => [index.get(e.from), index.get(e.to)] as const)
    .filter((pair): pair is readonly [number, number] => pair[0] !== undefined && pair[1] !== undefined);

  for (let step = 0; step < steps; step++) {
    const cool = 1 - step / steps;
    for (let i = 0; i < n; i++) {
      const a = pos[i]!;
      for (let j = i + 1; j < n; j++) {
        const b = pos[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = 0.1;
          dy = 0.1;
          d2 = 0.02;
        }
        const force = 2400 / d2;
        const d = Math.sqrt(d2);
        a.vx += (dx / d) * force;
        a.vy += (dy / d) * force;
        b.vx -= (dx / d) * force;
        b.vy -= (dy / d) * force;
      }
    }
    for (const [i, j] of springs) {
      const a = pos[i]!;
      const b = pos[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (d - 70) * 0.04;
      a.vx += (dx / d) * force;
      a.vy += (dy / d) * force;
      b.vx -= (dx / d) * force;
      b.vy -= (dy / d) * force;
    }
    for (const p of pos) {
      p.vx -= p.x * 0.01;
      p.vy -= p.y * 0.01;
      const limit = 12 * cool + 0.5;
      p.x += Math.max(-limit, Math.min(limit, p.vx));
      p.y += Math.max(-limit, Math.min(limit, p.vy));
      p.vx *= 0.5;
      p.vy *= 0.5;
    }
  }
  return new Map(pos.map((p) => [p.id, { id: p.id, x: p.x, y: p.y }]));
}
