import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AppFooter, AppFrame, AppHeader, AppMain, Notice } from '@bubltec/uiux';
import { usePreview } from '../lib/preview';
import { useSession } from '../lib/session';

const nav = [
  { to: '/', label: 'Index', end: true },
  { to: '/map', label: 'Map' },
  { to: '/activity', label: 'Log' },
  { to: '/about', label: 'About' },
];

export function Layout() {
  const { session } = useSession();
  const { preview, setPreview } = usePreview();
  const admin = useLocation().pathname.startsWith('/admin');
  useEffect(() => {
    if (!admin) return;
    let el = document.head.querySelector('meta[name="robots"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', 'robots');
      document.head.appendChild(el);
    }
    el.setAttribute('content', 'noindex, nofollow');
  }, [admin]);
  return (
    <AppFrame
      banner={
        preview && session?.editor ? (
          <Notice tone="preview">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
              <span>Preview · drafts are visible</span>
              <button className="underline" onClick={() => setPreview(false)}>
                Exit preview
              </button>
            </div>
          </Notice>
        ) : null
      }
    >
      <AppHeader
        brand={
          <NavLink to="/" className="no-underline" aria-label="GREED home">
            <span className="pixel text-lg text-snow sm:text-xl">
              GR<span className="text-bolt">EE</span>D
            </span>
            <span className="pixel ml-3 hidden text-[0.5rem] text-slate sm:inline">POWER · MONEY · OVERSIGHT</span>
          </NavLink>
        }
        nav={
          <>
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            ))}
            {session?.editor && (
              <NavLink
                to="/admin"
                className={({ isActive }) => (isActive ? 'bg-bolt text-void' : 'text-bolt hover:text-cream')}
              >
                Edit
              </NavLink>
            )}
          </>
        }
      />
      <AppMain>
        <Outlet />
      </AppMain>
      <AppFooter>
        <span>Every claim is sourced. Every entry is cross-linked.</span>
        <span className="flex gap-4">
          <a href="/api/export">Download data</a>
          <NavLink to="/admin">Editors</NavLink>
        </span>
      </AppFooter>
    </AppFrame>
  );
}
