import Link from "next/link";
import { Badge, Card, certTone, PageHeader, Stat, Table, Td } from "@/components/ui";
import { fmtDate, fmtHours, fmtRole } from "@/lib/format";
import { getCertAlerts, getDutiesPerDay, getStats, getWorkload } from "@/lib/repo/overview";
import { countOpenViolations } from "@/lib/repo/violations";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const [stats, alerts, workload, perDay, openViolations] = await Promise.all([
    getStats(), getCertAlerts(), getWorkload(), getDutiesPerDay(), countOpenViolations(),
  ]);
  const maxHours = Math.max(1, ...workload.map((w) => w.total_duty_hours));
  const maxDay = Math.max(1, ...perDay.map((d) => d.duties));

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Roster period ${fmtDate(stats.period_start)} – ${fmtDate(stats.period_end)} · all times UTC`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Active crew" value={stats.active_crew} />
        <Stat label="Flights" value={stats.flights} tone="violet" />
        <Stat label="Duties rostered" value={stats.duties} tone="amber" />
        <Stat label="Duty hours" value={Math.round(stats.duty_hours)} hint="across the whole roster" tone="green" />
        <Link href="/violations?status=OPEN" className="block transition hover:opacity-70">
          <Stat label="Open violations" value={openViolations} hint="waiting for review" tone="red" />
        </Link>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Duties per day">
          <div className="flex h-[286px] items-end gap-1.5 px-5 pb-4 pt-6">
            {perDay.map((d) => (
              <div key={String(d.day)} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="text-[10px] text-muted">{d.duties}</span>
                <div className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-violet-500" style={{ height: `${(d.duties / maxDay) * 200}px` }} />
                <span className="text-[10px] text-muted">{new Date(d.day).getUTCDate()}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Busiest crew">
          <div className="space-y-3 px-5 py-4">
            {workload.map((w) => (
              <Link key={w.crew_id} href={`/crew/${w.crew_id}`} className="block group">
                <div className="flex justify-between text-sm">
                  <span className="font-medium group-hover:text-accent">
                    {w.crew_name} <span className="font-normal text-muted">· {fmtRole(w.crew_role)}</span>
                  </span>
                  <span className="text-muted">{fmtHours(w.total_duty_hours)} · {w.duty_count} duties</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${(w.total_duty_hours / maxHours) * 100}%` }} />
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Type ratings needing attention" className="mt-6">
        <Table head={["Crew member", "Aircraft type", "Expires", "Status"]} empty={alerts.length === 0}>
          {alerts.map((a) => (
            <tr key={`${a.crew_id}-${a.type_code}`}>
              <Td>
                <Link href={`/crew/${a.crew_id}`} className="font-medium hover:text-accent">{a.crew_name}</Link>
                <span className="ml-2 text-muted">{a.employee_code}</span>
              </Td>
              <Td>{a.type_code}</Td>
              <Td>{fmtDate(a.expires_on)}</Td>
              <Td><Badge tone={certTone(a.status)}>{a.status.toLowerCase()}</Badge></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
