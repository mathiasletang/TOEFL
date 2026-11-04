import { useApi } from "../lib/useApi";
import { useRouter } from "../lib/router";
import { ago, band } from "../lib/format";

interface U {
  id: string;
  display_name: string;
  target_band: number;
  attempts: number;
  last_activity: string | null;
}

export function UserSelect() {
  const { data } = useApi<U[]>("/api/users");
  const { navigate } = useRouter();
  let last: string | null = null;
  try {
    last = localStorage.getItem("toefl.lastUser");
  } catch {
    last = null;
  }
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-2 inline-block rounded bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white">TOEFL iBT 2026</div>
          <h1 className="text-2xl font-semibold tracking-tight">Who is training?</h1>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(data ?? [{ id: "User_1", display_name: "User_1", target_band: 6, attempts: 0, last_activity: null }, { id: "Mathias", display_name: "Mathias", target_band: 6, attempts: 0, last_activity: null }]).map((u) => (
            <button
              key={u.id}
              autoFocus={u.id === last}
              onClick={() => navigate(`/u/${u.id}`)}
              className="card group p-6 text-left transition-colors hover:border-zinc-900 focus-visible:border-zinc-900"
            >
              <div className="text-lg font-semibold">{u.display_name}</div>
              <div className="mt-2 text-xs text-zinc-500">
                Target {band(u.target_band)} · {u.attempts} attempts
              </div>
              <div className="text-xs text-zinc-400">last activity {ago(u.last_activity)}</div>
            </button>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-zinc-400">Local app · data stays on this computer</p>
      </div>
    </div>
  );
}
