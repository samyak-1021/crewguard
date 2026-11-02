"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, ErrorNote, Label } from "@/components/forms";

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ error: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await callApi("/api/auth/login", "POST", Object.fromEntries(new FormData(e.currentTarget)));
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err as { error: string });
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-gradient-to-br from-blue-700 via-blue-600 to-violet-600 p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 text-sm font-bold ring-1 ring-white/30">CG</span>
          <span className="text-lg font-semibold">CrewGuard</span>
        </div>
        <div>
          <h2 className="max-w-md text-3xl font-semibold leading-tight">Crew rosters, checked against DGCA duty-time rules.</h2>
          <ul className="mt-8 space-y-3 text-sm text-blue-50">
            {[
              ["RST", "At least 10 h rest between duties"],
              ["FDP", "At most 13 h in a single duty"],
              ["WDH", "At most 60 h in any 7 days"],
              ["CER", "Pilots hold a valid type rating"],
            ].map(([code, text]) => (
              <li key={code} className="flex items-center gap-3">
                <span className="w-12 rounded-md bg-white/15 py-0.5 text-center font-mono text-xs ring-1 ring-white/25">{code}</span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-blue-100">DBMS mini project · Group 22</p>
      </aside>

      <main className="grid place-items-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use one of the two demo accounts below.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <Label text="Username">
              <input name="username" className="field" autoComplete="username" required autoFocus />
            </Label>
            <Label text="Password">
              <input name="password" type="password" className="field" autoComplete="current-password" required />
            </Label>
            <ErrorNote error={error} />
            <button
              disabled={busy}
              className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-8 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-line border-l-4 border-l-blue-600 bg-panel p-3">
              <p className="font-semibold text-blue-700">Scheduler</p>
              <p className="mt-1 font-mono text-ink">sched_sam</p>
              <p className="font-mono text-muted">Sam@123</p>
            </div>
            <div className="rounded-lg border border-line border-l-4 border-l-violet-600 bg-panel p-3">
              <p className="font-semibold text-violet-700">Auditor</p>
              <p className="mt-1 font-mono text-ink">audit_shriram</p>
              <p className="font-mono text-muted">Shriram@123</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
