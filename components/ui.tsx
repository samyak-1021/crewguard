// Small, shared presentational components (server-safe: no hooks).
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
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
    <section className={`overflow-hidden rounded-xl border border-line bg-white ${className}`}>
      {title && (
        <div className="flex items-center justify-between border-b border-line bg-panel px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// Colour per stat tile: a top stripe plus a tinted label.
const STAT_TONES = {
  blue: "border-t-blue-600 [&_.stat-label]:text-blue-700",
  violet: "border-t-violet-600 [&_.stat-label]:text-violet-700",
  amber: "border-t-amber-500 [&_.stat-label]:text-amber-700",
  green: "border-t-emerald-600 [&_.stat-label]:text-emerald-700",
  red: "border-t-red-600 [&_.stat-label]:text-red-700",
} as const;

export function Stat({ label, value, hint, tone = "blue" }: {
  label: string; value: ReactNode; hint?: string; tone?: keyof typeof STAT_TONES;
}) {
  return (
    <div className={`rounded-xl border border-line border-t-4 bg-white p-5 ${STAT_TONES[tone]}`}>
      <p className="stat-label text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const BADGE_TONES = {
  gray: "bg-slate-50 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
} as const;

export type Tone = keyof typeof BADGE_TONES;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}>
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
    : "bg-white text-ink border border-line hover:bg-panel";
  return (
    <Link href={href} className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${style}`}>
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
          <tr className="border-b border-line bg-panel/60 text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-5 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&_tr:hover]:bg-blue-50/40">{children}</tbody>
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
      <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">Apply</button>
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
