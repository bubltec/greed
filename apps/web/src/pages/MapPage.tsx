import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TOPIC_KINDS } from '@greed/domain';
import { ErrorBox, Loading } from '../components/bits';
import { api } from '../lib/api';
import { KIND_COLOR, KIND_LABEL } from '../lib/labels';
import { forceLayout } from '../lib/layout';
import { useAsync } from '../lib/useAsync';
import { useTitle } from '../lib/useTitle';

export function MapPage() {
  useTitle('Map');
  const { data, error, loading } = useAsync(() => api.graph(), []);
  const [focus, setFocus] = useState<string | null>(null);
  const navigate = useNavigate();

  const layout = useMemo(() => (data ? forceLayout(data) : undefined), [data]);
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of data?.edges ?? []) {
      if (!map.has(e.from)) map.set(e.from, new Set());
      if (!map.has(e.to)) map.set(e.to, new Set());
      map.get(e.from)!.add(e.to);
      map.get(e.to)!.add(e.from);
    }
    return map;
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data || !layout) return null;

  const xs = [...layout.values()].map((p) => p.x);
  const ys = [...layout.values()].map((p) => p.y);
  const pad = 40;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - minX + pad;
  const height = Math.max(...ys) - minY + pad;
  const lit = (id: string) => !focus || id === focus || neighbours.get(focus)?.has(id);
  const focused = focus ? data.nodes.find((n) => n.id === focus) : undefined;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="pixel mb-2 text-sm text-snow">Map</h1>
          <p className="text-sm text-steel">
            {data.nodes.length} entries, {data.edges.length} links. Hover to trace, click to open.
          </p>
        </div>
        <ul className="flex flex-wrap gap-3">
          {TOPIC_KINDS.filter((k) => data.nodes.some((n) => n.kind === k)).map((k) => (
            <li key={k} className="pixel flex items-center gap-2 text-[0.5rem]" style={{ color: KIND_COLOR[k] }}>
              <span className="inline-block h-2.5 w-2.5" style={{ background: KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
            </li>
          ))}
        </ul>
      </div>
      <p className="mb-2 h-6 truncate text-sm text-bolt" aria-live="polite">
        {focused ? `${focused.title} · ${focused.degree} links` : ' '}
      </p>
      <div className="panel overflow-hidden">
        <svg
          viewBox={`${minX} ${minY} ${width} ${height}`}
          className="block h-[70vh] w-full"
          role="img"
          aria-label="Network of linked topics"
          onMouseLeave={() => setFocus(null)}
        >
          <g>
            {data.edges.map((e) => {
              const a = layout.get(e.from)!;
              const b = layout.get(e.to)!;
              const on = focus && (e.from === focus || e.to === focus);
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={on ? '#f8b800' : '#0000bc'}
                  strokeWidth={on ? 2 : 1}
                  opacity={focus && !on ? 0.25 : 1}
                />
              );
            })}
          </g>
          <g>
            {data.nodes.map((node) => {
              const p = layout.get(node.id)!;
              const r = 4 + Math.min(node.degree, 12) * 0.9;
              const on = lit(node.id);
              return (
                <g
                  key={node.id}
                  transform={`translate(${p.x} ${p.y})`}
                  className="cursor-pointer"
                  opacity={on ? 1 : 0.2}
                  tabIndex={0}
                  role="link"
                  aria-label={node.title}
                  onMouseEnter={() => setFocus(node.id)}
                  onFocus={() => setFocus(node.id)}
                  onClick={() => navigate(`/t/${node.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/t/${node.id}`)}
                >
                  <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={KIND_COLOR[node.kind]} />
                  {(node.degree >= 8 || node.id === focus) && (
                    <text
                      y={-r - 5}
                      textAnchor="middle"
                      fontSize={node.id === focus ? 12 : 9}
                      fill="#fcfcfc"
                      stroke="#000"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {node.title.length > 48 ? `${node.title.slice(0, 46)}…` : node.title}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
