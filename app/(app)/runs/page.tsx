import Link from "next/link";
import { runTone } from "@/components/compliance";
import { ApiForm, Label } from "@/components/forms";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDate, fmtEventTime } from "@/lib/format";
import { listRuns } from "@/lib/repo/runs";

export const metadata = { title: "Validation runs" };

export default async function RunsPage() {
  const [session, runs] = await Promise.all([requireSession(), listRuns()]);

  return (
    <>
      <PageHeader title="Validation runs" subtitle="Each run checks the roster against every active rule over a date range." />

      {session.role === "AUDITOR" && (
        <Card title="Run validation" className="mb-6">
          <div className="p-5">
            <ApiForm action="/api/runs" redirectTo="/runs/{id}" submitLabel="Run validation">
              <div className="grid max-w-md grid-cols-2 gap-4">
                <Label text="From"><input name="period_start" type="date" defaultValue="2026-11-02" className="field" /></Label>
                <Label text="To"><input name="period_end" type="date" defaultValue="2026-11-08" className="field" /></Label>
              </div>
            </ApiForm>
          </div>
        </Card>
      )}

      <Card>
        <Table
          head={["Run", "Period", "Triggered by", "Started", "Duration", "Status", "Violations"]}
          empty={runs.length === 0}
        >
          {runs.map((r) => (
            <tr key={r.run_id}>
              <Td><Link href={`/runs/${r.run_id}`} className="font-medium text-accent hover:underline">#{r.run_id}</Link></Td>
              <Td>{fmtDate(r.period_start)} – {fmtDate(r.period_end)}</Td>
              <Td>{r.triggered_by_name ?? "—"}</Td>
              <Td>{fmtEventTime(r.started_at)}</Td>
              <Td className="text-muted">{r.duration_ms == null ? "—" : `${r.duration_ms} ms`}</Td>
              <Td><Badge tone={runTone(r.status)}>{r.status.toLowerCase()}</Badge></Td>
              <Td>{r.violations_found}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
