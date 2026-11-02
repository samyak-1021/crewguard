import { Bars, fmtExact } from "@/components/compliance";
import { Card, PageHeader, Stat, Table, Td } from "@/components/ui";
import { getAnalytics, getComplianceStats, getViolationsByRuleSql } from "@/lib/repo/analytics";

export const metadata = { title: "Dashboard" };

function Source({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs text-muted">{children}</span>;
}

export default async function DashboardPage() {
  const [stats, sqlByRule, mongo] = await Promise.all([
    getComplianceStats(), getViolationsByRuleSql(), getAnalytics(),
  ]);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Compliance across every validation run, from both databases." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total violations" value={stats.total} />
        <Stat label="Open" value={stats.open} hint="waiting for review" tone="red" />
        <Stat label="Resolved" value={stats.resolved} tone="green" />
        <Stat label="Validation runs" value={stats.runs} tone="violet" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Violations by rule" action={<Source>PostgreSQL · GROUP BY</Source>}>
          <Table head={["Rule", "Violations", "Open"]}>
            {sqlByRule.map((r) => (
              <tr key={r.rule_code}>
                <Td><span className="font-medium">{r.rule_code}</span> <span className="text-muted">{r.rule_name}</span></Td>
                <Td>{r.violations}</Td>
                <Td>{r.open}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        {mongo ? (
          <Card title="Violations by rule" action={<Source>MongoDB · $group</Source>}>
            <Bars items={mongo.byRule.map((r) => ({
              label: String(r._id), value: r.count, href: `/violations?rule=${r._id}`,
            }))} />
          </Card>
        ) : (
          <Card title="MongoDB analytics">
            <p className="px-5 py-10 text-center text-sm text-muted">
              MongoDB is not reachable, so its aggregations are unavailable. PostgreSQL is the source of truth and is unaffected.
            </p>
          </Card>
        )}
      </div>

      {mongo && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="By severity" action={<Source>MongoDB · $group</Source>}>
            <Bars items={mongo.bySeverity.map((s) => ({
              label: String(s._id).toLowerCase(), value: s.count, href: `/violations?severity=${s._id}`,
            }))} color="bg-amber-500" />
          </Card>

          <Card title="Top 5 crew" action={<Source>MongoDB · $group, $sort, $limit</Source>}>
            <Bars items={mongo.topCrew.map((c) => ({ label: c.name, value: c.count, href: `/crew/${c._id}` }))} color="bg-violet-500" />
          </Card>

          <Card title="Violations per run" action={<Source>MongoDB · $group</Source>}>
            <Bars items={mongo.perRun.map((r) => ({ label: `Run #${r._id}`, value: r.count, href: `/runs/${r._id}` }))} color="bg-emerald-500" />
          </Card>

          <Card title="Logged actions per day" action={<Source>MongoDB · $dateToString</Source>}>
            <Bars items={mongo.auditPerDay.map((d) => ({ label: String(d._id), value: d.count }))} />
          </Card>

          <Stat
            label="Average hours in a WDH breach"
            value={mongo.wdh ? fmtExact(Math.round(mongo.wdh.avg_hours * 100) / 100) : "—"}
            hint={mongo.wdh ? `across ${mongo.wdh.count} breaches · MongoDB $match + $avg` : "no WDH breaches yet"}
          />
        </div>
      )}
    </>
  );
}
