"use client";
// Pick several crew members and assign them to a flight in one request.
// The API saves them in a single transaction (all or nothing).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, ErrorNote, Label, SubmitButton } from "@/components/forms";
import { Badge } from "@/components/ui";

type Candidate = {
  crew_id: number; employee_code: string; crew_name: string; crew_role: string; home_base: string;
  has_rating: boolean; busy: boolean;
};

const ROLE_LABEL: Record<string, string> = { CAPTAIN: "Captains", FIRST_OFFICER: "First officers", CABIN_CREW: "Cabin crew" };

export function AssignCrewForm({ flightId, typeCode, candidates, defaultStart, defaultEnd }: {
  flightId: number; typeCode: string; candidates: Candidate[]; defaultStart: string; defaultEnd: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ error: string; constraint?: string | null } | null>(null);

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await callApi(`/api/flights/${flightId}/duties`, "POST", {
        crew_ids: selected,
        duty_start_utc: form.get("duty_start_utc"),
        duty_end_utc: form.get("duty_end_utc"),
      });
      setSelected([]);
      router.refresh();
    } catch (err) {
      setError(err as typeof error);
    } finally {
      setBusy(false);
    }
  }

  const groups = Object.keys(ROLE_LABEL).map((role) => ({ role, crew: candidates.filter((c) => c.crew_role === role) }));

  return (
    <form onSubmit={onSubmit} className="space-y-5 p-5">
      <div className="grid gap-5 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.role}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{ROLE_LABEL[g.role]}</p>
            <div className="space-y-1">
              {g.crew.length === 0 && <p className="text-sm text-muted">None available</p>}
              {g.crew.map((c) => (
                <label key={c.crew_id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-panel">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.crew_id)}
                    onChange={() => toggle(c.crew_id)}
                    className="mt-0.5 accent-accent"
                  />
                  <span className="text-sm">
                    {c.crew_name} <span className="text-muted">· {c.home_base}</span>
                    <span className="mt-0.5 flex gap-1">
                      {!c.has_rating && <Badge tone="amber">no valid {typeCode} rating</Badge>}
                      {c.busy && <Badge tone="red">overlapping duty</Badge>}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid max-w-lg grid-cols-2 gap-3">
        <Label text="Duty start (UTC)">
          <input name="duty_start_utc" type="datetime-local" defaultValue={defaultStart} className="field" />
        </Label>
        <Label text="Duty end (UTC)">
          <input name="duty_end_utc" type="datetime-local" defaultValue={defaultEnd} className="field" />
        </Label>
      </div>

      <ErrorNote error={error} />
      <div className="flex items-center gap-3">
        <SubmitButton busy={busy}>Assign {selected.length || ""} selected</SubmitButton>
        <span className="text-xs text-muted">Saved as one transaction: if any assignment is rejected, none are kept.</span>
      </div>
    </form>
  );
}
