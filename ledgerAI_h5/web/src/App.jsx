import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { hasSession, signOut } from './auth.js';
import AuthScreen from './pages/AuthScreen.jsx';
import Home from './pages/Home.jsx';
import Account from './pages/Account.jsx';
import RegionSetup from './pages/RegionSetup.jsx';
import Privacy from './pages/Privacy.jsx';
import { ChartIcon, HomeIcon, PersonIcon } from './components/Icons.jsx';

const Analytics = lazy(() => import('./pages/Analytics.jsx')); // keeps recharts out of the initial bundle

const TABS = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'analytics', label: 'Analytics', Icon: ChartIcon },
  { id: 'account', label: 'Account', Icon: PersonIcon },
];

function MainApp() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(hasSession());
  const [tab, setTab] = useState('home');
  const [version, setVersion] = useState(0); // bump after any data change so screens refetch
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!hasSession()) return;
    api.me().then((r) => setUser(r.user)).catch(() => signOut()).finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('ledgerai:logout', onLogout);
    return () => window.removeEventListener('ledgerai:logout', onLogout);
  }, []);

  const logout = () => {
    signOut();
    setUser(null);
    setTab('home');
  };

  if (booting) return <div className="grid h-full place-items-center text-ios-secondary">Loading…</div>;
  if (!user) return <AuthScreen onAuth={setUser} />;
  if (!user.country) return <RegionSetup user={user} onSaved={(p) => { setUser((u) => ({ ...u, ...p })); bump(); }} onLogout={logout} />;

  return (
    <div className="mx-auto flex h-full max-w-md flex-col bg-ios-bg">
      <main className="flex-1 overflow-y-auto pb-28">
        {tab === 'home' && <Home user={user} version={version} onChanged={bump} />}
        {tab === 'analytics' && (
          <Suspense fallback={<p className="py-20 text-center text-ios-secondary">Loading…</p>}>
            <Analytics version={version} onChanged={bump} />
          </Suspense>
        )}
        {tab === 'account' && (
          <Account
            user={user}
            onLogout={logout}
            onProfileSaved={(p) => { setUser((u) => ({ ...u, ...p })); bump(); }}
          />
        )}
      </main>

      <nav
        className="ios-bar fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-md border-t-[0.5px] border-black/20"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 flex-col items-center gap-0.5 pb-1 pt-1.5 ${tab === id ? 'text-ios-blue' : 'text-[#999]'}`}
          >
            <span className="relative">
              <Icon width={27} height={27} />
              {id === 'account' && !user.country && <span className="absolute -right-0.5 top-0 h-2.5 w-2.5 rounded-full bg-ios-red ring-2 ring-white" />}
            </span>
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

const Admin = lazy(() => import('./pages/Admin.jsx')); // separate chunk: admins only

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/privacy') return <Privacy />;
  const isAdminPage = path === '/admin';
  if (!isAdminPage) return <MainApp />;
  return (
    <Suspense fallback={<div className="grid h-full place-items-center text-ios-secondary">Loading…</div>}>
      <Admin />
    </Suspense>
  );
}
