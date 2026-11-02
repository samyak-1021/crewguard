import Link from "next/link";
import { notFound } from "next/navigation";
import { runTone, ViolationsTable } from "@/components/compliance";
import { Badge, Card, Field, PageHeader, Stat } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { toId } from "@/lib/ids";
import { getRun, getRunRuleCounts } from "@/lib/repo/runs";
import { listViolations } from "@/lib/repo/violations";

export default async function RunDetailPage({ params }: PageProps<"/runs/[id]">) {
  const id = toId((await params).id);
  const run = id === null ? null : await getRun(id);
  if (id === null || !run) notFound();

  const [counts, violations] = await Promise.all([getRunRuleCounts(id), listViolations({ run: String(id) })]);

  return (
    <>
      <Link href="/runs" className="text-sm text-accent hover:underline">← Validation runs</Link>
      <PageHeader
        title={`Run #${run.run_id}`}
        subtitle={`${fmtDate(run.period_start)} – ${fmtDate(run.period_end)} · ${run.violations_found} violations`}
      />

      <Card className="p-5">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Status"><Badge tone={runTone(run.status)}>{run.status.toLowerCase()}</Badge></Field>
          <Field label="Triggered by">{run.triggered_by_name ?? "—"}</Field>
          <Field label="Started">{fmtDateTime(run.started_at)}</Field>
          <Field label="Duration">{run.duration_ms == null ? "—" : `${run.duration_ms} ms`}</Field>
        </dl>
      </Card>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {counts.map((c, i) => (
          <Stat key={c.rule_code} label={c.rule_code} value={c.violations} hint={c.rule_name}
                tone={(["blue", "violet", "amber", "green"] as const)[i % 4]} />
        ))}
      </div>

      <Card title="Violations" className="mt-6">
        <ViolationsTable rows={violations} />
      </Card>
    </>
  );
}
