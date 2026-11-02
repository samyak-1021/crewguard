import { REVIEW_STATUSES, SEVERITIES, ViolationsTable } from "@/components/compliance";
import { Card, FilterBar, PageHeader } from "@/components/ui";
import { listRules } from "@/lib/repo/rules";
import { listRuns } from "@/lib/repo/runs";
import { listViolations } from "@/lib/repo/violations";

export const metadata = { title: "Violations" };

export default async function ViolationsPage({ searchParams }: PageProps<"/violations">) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const [rows, rules, runs] = await Promise.all([listViolations(sp), listRules(), listRuns()]);

  return (
    <>
      <PageHeader title="Violations" subtitle={`${rows.length} shown · from the v_violation_report view`} />

      <FilterBar resetHref="/violations">
        <select name="rule" defaultValue={sp.rule ?? ""} className="field max-w-56">
          <option value="">All rules</option>
          {rules.map((r) => <option key={r.rule_code} value={r.rule_code}>{r.rule_code} · {r.rule_name}</option>)}
        </select>
        <select name="severity" defaultValue={sp.severity ?? ""} className="field max-w-40">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className="field max-w-40">
          <option value="">All statuses</option>
          {REVIEW_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </select>
        <select name="run" defaultValue={sp.run ?? ""} className="field max-w-36">
          <option value="">All runs</option>
          {runs.map((r) => <option key={r.run_id} value={r.run_id}>Run #{r.run_id}</option>)}
        </select>
        <input name="q" defaultValue={sp.q} placeholder="Crew name or code" className="field max-w-48" />
      </FilterBar>

      <Card>
        <ViolationsTable rows={rows} />
      </Card>
    </>
  );
}
