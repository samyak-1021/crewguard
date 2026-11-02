// Shared pieces of the compliance and analytics pages (server-safe: no hooks).
import Link from "next/link";
import { Badge, Table, Td, type Tone } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { ViolationRow } from "@/lib/repo/violations";

export const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export const REVIEW_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED"] as const;

export const severityTone = (s: string): Tone =>
  s === "CRITICAL" ? "red" : s === "HIGH" ? "amber" : s === "MEDIUM" ? "blue" : "gray";

export const reviewTone = (s: string): Tone =>
  s === "RESOLVED" ? "green" : s === "ACKNOWLEDGED" ? "blue" : "amber";

export const runTone = (s: string): Tone =>
  s === "COMPLETED" ? "green" : s === "FAILED" ? "red" : s === "RUNNING" ? "blue" : "gray";

// Two decimals: fmtHours rounds to one, which would turn a 9.83 h rest into 9.8 h.
export const fmtExact = (h: number | null) => (h == null ? "—" : `${h.toFixed(2)} h`);

export function ViolationsTable({ rows }: { rows: ViolationRow[] }) {
  return (
    <Table
      head={["#", "Rule", "Crew member", "Severity", "Observed", "Limit", "Window start", "Duties", "Review"]}
      empty={rows.length === 0}
    >
      {rows.map((v) => (
        <tr key={v.violation_id} className="hover:bg-zinc-50">
          <Td>
            <Link href={`/violations/${v.violation_id}`} className="font-medium text-accent hover:underline">
              {v.violation_id}
            </Link>
          </Td>
          <Td><span className="font-medium">{v.rule_code}</span> <span className="text-muted">{v.rule_name}</span></Td>
          <Td>
            <Link href={`/crew/${v.crew_id}`} className="font-medium hover:text-accent">{v.crew_name}</Link>
            <span className="ml-2 text-muted">{v.employee_code}</span>
          </Td>
          <Td><Badge tone={severityTone(v.severity)}>{v.severity.toLowerCase()}</Badge></Td>
          <Td>{fmtExact(v.observed_value)}</Td>
          <Td className="text-muted">{fmtExact(v.threshold_value)}</Td>
          <Td>{fmtDateTime(v.window_start)}</Td>
          <Td>{v.duty_count}</Td>
          <Td><Badge tone={reviewTone(v.review_status)}>{v.review_status.toLowerCase()}</Badge></Td>
        </tr>
      ))}
    </Table>
  );
}

// Simple horizontal bars, in the same style as "Busiest crew" on the Overview page.
export function Bars({ items }: { items: { label: string; value: number; href?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="px-5 py-10 text-center text-sm text-muted">Nothing to show.</p>;
  return (
    <div className="space-y-3 px-5 py-4">
      {items.map((i) => {
        const row = (
          <>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{i.label}</span>
              <span className="text-muted">{i.value}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-zinc-100">
              <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(i.value / max) * 100}%` }} />
            </div>
          </>
        );
        return i.href
          ? <Link key={i.label} href={i.href} className="block hover:opacity-70">{row}</Link>
          : <div key={i.label}>{row}</div>;
      })}
    </div>
  );
}
