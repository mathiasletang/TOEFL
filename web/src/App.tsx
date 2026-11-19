import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { RouterProvider, useRouter, match, Link } from "./lib/router";
import { UserSelect } from "./pages/UserSelect";
import { Dashboard } from "./pages/Dashboard";
import { Practice, PracticeTask } from "./pages/Practice";
import { Drill } from "./pages/Drill";
import { ReviewPage } from "./pages/ReviewPage";
import { Focus } from "./pages/Focus";
import { SimulationLauncher, SimulationRunner, SimulationResults } from "./pages/Simulation";
import { Progress } from "./pages/Progress";
import { Settings } from "./pages/Settings";
import { Shadowing } from "./pages/Shadowing";
import { applyTheme, readTheme } from "./lib/theme";
import { IconSwap } from "./components/icons";
import { ThemeToggle } from "./components/ThemeToggle";
import { VocabBank, VocabEntryPage, VocabSession, VocabStats, VocabTriage } from "./pages/Vocabulary";

const USERS = ["Virgile", "Mathias"];


function Shell({ user, children, wide }: { user: string; children: ReactNode; wide?: boolean }) {
  const { path, navigate } = useRouter();
  const nav = [
    ["Dashboard", `/u/${user}`],
    ["Practice", `/u/${user}/practice`],
    ["Focus weaknesses", `/u/${user}/focus`],
    ["Vocabulary", `/u/${user}/vocab`],
    ["Simulation", `/u/${user}/simulate`],
    ["Progress", `/u/${user}/progress`],
    ["Settings", `/u/${user}/settings`],
  ] as const;
  const other = USERS.find((u) => u !== user)!;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-5 px-4">
          <Link to={`/u/${user}`} className="flex min-h-11 items-center gap-2.5 rounded-btn text-[15px] font-black tracking-tight" aria-label="TOEFL 2026 Trainer, dashboard">
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-accent text-lg font-black text-on-accent" aria-hidden>
              T
            </span>
            <span className="hidden lg:inline">TOEFL 2026</span>
          </Link>
          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-2" aria-label="Main">
            {nav.map(([label, to]) => {
              const active = to === `/u/${user}` ? path === to : path.startsWith(to);
              return (
                <Link key={to} to={to} aria-current={active ? "page" : undefined} className={`tab ${active ? "tab-active" : ""}`}>
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="hidden font-extrabold text-text sm:inline">{user}</span>
            <button className="btn btn-ghost text-[13px] text-dim" title={`Switch to ${other}`} onClick={() => navigate(`/u/${other}`)}>
              <IconSwap size={16} /> {other}
            </button>
            <ThemeToggle user={user} />
          </div>
        </div>
      </header>
      <main className={`mx-auto px-4 py-8 ${wide ? "max-w-7xl" : "max-w-6xl"}`}>{children}</main>
    </div>
  );
}

function Routes() {
  const { path, navigate } = useRouter();
  const userMatch = path.match(/^\/u\/([^/]+)/);
  const user = userMatch ? decodeURIComponent(userMatch[1]!) : null;
  // Each profile has its own theme: apply it when the profile changes, before paint.
  useLayoutEffect(() => {
    applyTheme(readTheme(user && USERS.includes(user) ? user : null));
  }, [user]);
  useEffect(() => {
    if (user && USERS.includes(user)) {
      try {
        localStorage.setItem("toefl.lastUser", user);
      } catch {
        /* storage unavailable */
      }
    }
  }, [user]);
  if (!user) return <UserSelect />;
  if (!USERS.includes(user)) {
    navigate("/", true);
    return null;
  }
  let m: Record<string, string> | null;
  if ((m = match("/u/:user", path))) return <Shell user={user}><Dashboard user={user} /></Shell>;
  if ((m = match("/u/:user/practice", path))) return <Shell user={user}><Practice user={user} /></Shell>;
  if ((m = match("/u/:user/practice/:task", path))) return <Shell user={user}><PracticeTask user={user} task={m.task!} /></Shell>;
  if ((m = match("/u/:user/drill/:ex", path))) return <Shell user={user} wide><Drill user={user} exerciseId={m.ex!} /></Shell>;
  if ((m = match("/u/:user/review/:attempt", path))) return <Shell user={user} wide><ReviewPage user={user} attemptId={m.attempt!} /></Shell>;
  if ((m = match("/u/:user/focus", path))) return <Shell user={user}><Focus user={user} /></Shell>;
  if ((m = match("/u/:user/vocab", path))) return <Shell user={user}><VocabBank user={user} /></Shell>;
  if ((m = match("/u/:user/vocab/triage", path))) return <Shell user={user}><VocabTriage user={user} /></Shell>;
  if ((m = match("/u/:user/vocab/session", path))) return <Shell user={user}><VocabSession user={user} /></Shell>;
  if ((m = match("/u/:user/vocab/stats", path))) return <Shell user={user}><VocabStats user={user} /></Shell>;
  if ((m = match("/u/:user/vocab/entry/:entry", path))) return <Shell user={user}><VocabEntryPage user={user} entryId={m.entry!} /></Shell>;
  if ((m = match("/u/:user/shadowing", path))) return <Shell user={user}><Shadowing user={user} /></Shell>;
  if ((m = match("/u/:user/simulate", path))) return <Shell user={user}><SimulationLauncher user={user} /></Shell>;
  if ((m = match("/u/:user/sim/:sim", path))) return <Shell user={user} wide><SimulationRunner user={user} simId={m.sim!} /></Shell>;
  if ((m = match("/u/:user/sim/:sim/results", path))) return <Shell user={user}><SimulationResults user={user} simId={m.sim!} /></Shell>;
  if ((m = match("/u/:user/progress", path))) return <Shell user={user}><Progress user={user} /></Shell>;
  if ((m = match("/u/:user/settings", path))) return <Shell user={user}><Settings user={user} /></Shell>;
  return (
    <Shell user={user}>
      <p className="text-sm text-dim">
        Page not found. <Link to={`/u/${user}`} className="text-accent underline">Dashboard</Link>
      </p>
    </Shell>
  );
}

export function App() {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  );
}
