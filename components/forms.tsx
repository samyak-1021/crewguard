"use client";
// Client-side form helpers. Every write in the app goes through these, so
// they are the only place that talks to the /api route handlers.
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type ApiError = { error: string; constraint?: string | null };

export async function callApi(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data as ApiError;
  return data;
}

// Shows the database's own rejection, including the constraint that fired.
export function ErrorNote({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
      {error.error}
      {error.constraint && (
        <span className="mt-1 block font-mono text-xs text-red-500">rejected by PostgreSQL · {error.constraint}</span>
      )}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:bg-accent-strong disabled:opacity-50"
    >
      {busy ? "Saving…" : children}
    </button>
  );
}

// Generic form: sends its fields as JSON to `action`. On success it either
// goes to `redirectTo` ("{id}" is replaced by the id the API returns) or
// refreshes the current page so server data reloads.
export function ApiForm({ action, method = "POST", redirectTo, submitLabel, children, className = "" }: {
  action: string; method?: "POST" | "PATCH"; redirectTo?: string; submitLabel: string;
  children: ReactNode; className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    try {
      const data = await callApi(action, method, Object.fromEntries(new FormData(form)));
      if (redirectTo) router.push(redirectTo.replace("{id}", String(data.id)));
      else {
        if (method === "POST") form.reset();
        router.refresh();
      }
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={`space-y-4 ${className}`}>
      {children}
      <ErrorNote error={error} />
      <SubmitButton busy={busy}>{submitLabel}</SubmitButton>
    </form>
  );
}

// Two-step delete: first click asks, second click deletes.
export function DeleteButton({ url, redirectTo, label = "Delete" }: { url: string; redirectTo?: string; label?: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function onClick() {
    if (!armed) return setArmed(true);
    try {
      await callApi(url, "DELETE");
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } catch (err) {
      setError(err as ApiError);
      setArmed(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        onBlur={() => setArmed(false)}
        className={`text-sm font-medium transition ${armed ? "text-red-600" : "text-muted hover:text-red-600"}`}
      >
        {armed ? "Confirm?" : label}
      </button>
      {error && <span className="text-xs text-red-600">{error.error}</span>}
    </span>
  );
}

// Label wrapper for inputs
export function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{text}</span>
      {children}
    </label>
  );
}
