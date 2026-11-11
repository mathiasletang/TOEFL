import { useEffect, type ReactNode } from "react";
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
import { VocabBank, VocabEntryPage, VocabSession, VocabStats } from "./pages/Vocabulary";

const USERS = ["User_1", "Mathias"];

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
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4">
          <Link to={`/u/${user}`} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] font-bold text-white">TOEFL</span>
            <span className="hidden sm:inline">2026 Trainer</span>
          </Link>
          <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto" aria-label="Main">
            {nav.map(([label, to]) => {
              const active = to === `/u/${user}` ? path === to : path.startsWith(to);
              return (
                <Link key={to} to={to} className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] ${active ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}>
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-medium text-zinc-900">{user}</span>
            <button className="btn btn-ghost px-2 py-1 text-[12px] text-zinc-500" title={`Switch to ${other}`} onClick={() => navigate(`/u/${other}`)}>
              ⇄ {other}
            </button>
          </div>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${wide ? "max-w-7xl" : "max-w-6xl"}`}>{children}</main>
    </div>
  );
}

function Routes() {
  const { path, navigate } = useRouter();
  const userMatch = path.match(/^\/u\/([^/]+)/);
  const user = userMatch ? decodeURIComponent(userMatch[1]!) : null;
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
  if ((m = match("/u/:user/vocab/session", path))) return <Shell user={user}><VocabSession user={user} /></Shell>;
  if ((m = match("/u/:user/vocab/stats", path))) return <Shell user={user}><VocabStats user={user} /></Shell>;
  if ((m = match("/u/:user/vocab/entry/:entry", path))) return <Shell user={user}><VocabEntryPage user={user} entryId={m.entry!} /></Shell>;
  if ((m = match("/u/:user/simulate", path))) return <Shell user={user}><SimulationLauncher user={user} /></Shell>;
  if ((m = match("/u/:user/sim/:sim", path))) return <Shell user={user} wide><SimulationRunner user={user} simId={m.sim!} /></Shell>;
  if ((m = match("/u/:user/sim/:sim/results", path))) return <Shell user={user}><SimulationResults user={user} simId={m.sim!} /></Shell>;
  if ((m = match("/u/:user/progress", path))) return <Shell user={user}><Progress user={user} /></Shell>;
  if ((m = match("/u/:user/settings", path))) return <Shell user={user}><Settings user={user} /></Shell>;
  return (
    <Shell user={user}>
      <p className="text-sm text-zinc-500">
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
