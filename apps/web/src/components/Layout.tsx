import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../lib/session';

const nav = [
  { to: '/', label: 'Index', end: true },
  { to: '/map', label: 'Map' },
  { to: '/activity', label: 'Log' },
  { to: '/about', label: 'About' },
];

export function Layout() {
  const { session } = useSession();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-mega py-5">
        <NavLink to="/" className="no-underline" aria-label="GREED home">
          <span className="pixel text-lg text-snow sm:text-xl">
            GR<span className="text-sky">EE</span>D
          </span>
          <span className="pixel ml-3 hidden text-[0.5rem] text-slate sm:inline">
            POWER · MONEY · OVERSIGHT
          </span>
        </NavLink>
        <nav className="flex flex-wrap items-center gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `pixel px-2 py-1 text-[0.5625rem] no-underline ${isActive ? 'bg-mega text-snow' : 'text-ice hover:text-snow'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
          {session?.editor && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `pixel px-2 py-1 text-[0.5625rem] no-underline ${isActive ? 'bg-bolt text-void' : 'text-bolt hover:text-cream'}`
              }
            >
              Edit
            </NavLink>
          )}
        </nav>
      </header>
      <main className="flex-1 py-8">
        <Outlet />
      </main>
      <footer className="flex flex-wrap justify-between gap-3 border-t-2 border-deep py-5 text-xs text-slate">
        <span>Every claim is sourced. Contested points are marked, not hidden.</span>
        <span className="flex gap-4">
          <a href="/api/export">Download data</a>
          <NavLink to="/admin">Editors</NavLink>
        </span>
      </footer>
    </div>
  );
}
