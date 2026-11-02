// Small, shared presentational components (server-safe: no hooks).
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: {
  title?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl bg-white shadow-sm ring-1 ring-black/5 ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const BADGE_TONES = {
  gray: "bg-zinc-100 text-zinc-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
} as const;

export type Tone = keyof typeof BADGE_TONES;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export const certTone = (status: string): Tone =>
  status === "EXPIRED" ? "red" : status === "EXPIRING" ? "amber" : "green";

export function ButtonLink({ href, children, variant = "primary" }: {
  href: string; children: ReactNode; variant?: "primary" | "secondary";
}) {
  const style = variant === "primary"
    ? "bg-accent text-white hover:bg-accent-strong"
    : "bg-white text-ink ring-1 ring-line hover:bg-zinc-50";
  return (
    <Link href={href} className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${style}`}>
      {children}
    </Link>
  );
}

// Table primitives
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-5 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty && <p className="px-5 py-10 text-center text-sm text-muted">Nothing to show.</p>}
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-5 py-3 ${className}`}>{children}</td>;
}

// Search / filter bar: a plain GET form, so filters live in the URL
// (?q=...&role=...) and the server page reads them as searchParams.
export function FilterBar({ children, resetHref }: { children: ReactNode; resetHref: string }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
      {children}
      <button className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-black">Apply</button>
      <Link href={resetHref} className="px-2 text-sm text-muted hover:text-ink">Reset</Link>
    </form>
  );
}

// Label + value pair used on detail pages
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}
