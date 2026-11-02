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
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent text-lg font-bold text-white">CG</span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign in to CrewGuard</h1>
          <p className="mt-1 text-sm text-muted">Crew roster compliance, checked against DGCA rules.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <Label text="Username">
            <input name="username" className="field" autoComplete="username" required autoFocus />
          </Label>
          <Label text="Password">
            <input name="password" type="password" className="field" autoComplete="current-password" required />
          </Label>
          <ErrorNote error={error} />
          <button
            disabled={busy}
            className="w-full rounded-full bg-accent py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted">
          Demo: <span className="font-mono">sched_sam</span> / <span className="font-mono">Sam@123</span> (scheduler) or{" "}
          <span className="font-mono">audit_shriram</span> / <span className="font-mono">Shriram@123</span> (auditor)
        </p>
      </div>
    </div>
  );
}
