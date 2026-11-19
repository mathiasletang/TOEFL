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
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[18px] bg-accent text-3xl font-black text-on-accent" aria-hidden>
            T
          </div>
          <div className="label">TOEFL iBT 2026</div>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Who is training?</h1>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(data ?? [{ id: "Virgile", display_name: "Virgile", target_band: 5, attempts: 0, last_activity: null }, { id: "Mathias", display_name: "Mathias", target_band: 6, attempts: 0, last_activity: null }]).map((u) => (
            <button
              key={u.id}
              autoFocus={u.id === last}
              onClick={() => navigate(`/u/${u.id}`)}
              className="card group rounded-tile p-6 text-left transition-colors hover:border-accent focus-visible:border-accent"
            >
              <div className="text-xl font-extrabold">{u.display_name}</div>
              <div className="mt-2 text-xs text-dim">
                Target {band(u.target_band)} · {u.attempts} attempts
              </div>
              <div className="text-xs text-dim">last activity {ago(u.last_activity)}</div>
            </button>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-dim">Local app · data stays on this computer</p>
      </div>
    </div>
  );
}
