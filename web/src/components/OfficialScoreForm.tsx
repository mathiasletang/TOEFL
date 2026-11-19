import { useState } from "react";
import { api } from "../lib/api";
import { SECTION_ORDER, SECTION_LABEL } from "../lib/format";
import { localToday } from "../lib/today";

const BANDS = [6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1];

/** Four section bands of an official ETS test, stored as an anchor (POST /api/users/:id/official-scores). */
export function OfficialScoreForm({ user, onSaved }: { user: string; onSaved: () => void }) {
  const [date, setDate] = useState("");
  const [b, setB] = useState<Record<string, string>>({ reading: "", listening: "", writing: "", speaking: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const complete = !!date && SECTION_ORDER.every((s) => b[s]);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/users/${user}/official-scores`, { taken_on: date, ...Object.fromEntries(SECTION_ORDER.map((s) => [s, Number(b[s])])) });
      setDate("");
      setB({ reading: "", listening: "", writing: "", speaking: "" });
      onSaved();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="tile mt-5 space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) void save();
      }}
    >
      <label className="block text-sm font-bold">
        Test date
        <input type="date" className="input mt-1 block w-full" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {SECTION_ORDER.map((s) => (
          <label key={s} className="block text-sm font-bold">
            {SECTION_LABEL[s]}
            <select className="input mt-1 block w-full" value={b[s]} onChange={(e) => setB({ ...b, [s]: e.target.value })} required>
              <option value="">Band…</option>
              {BANDS.map((x) => (
                <option key={x} value={x}>
                  {x.toFixed(1)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button className="btn btn-primary w-full" disabled={!complete || busy}>
        Save official scores
      </button>
      {err && <p className="text-sm font-semibold text-bad">{err}</p>}
      <p className="text-xs text-dim">Copied from your ETS score report and stored on this computer; this app does not verify them. Shown as an anchor on Progress.</p>
    </form>
  );
}
