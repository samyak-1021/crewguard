import { severityTone } from "@/components/compliance";
import { Badge, Card, Field, FilterBar, PageHeader } from "@/components/ui";
import { listRules, searchRules } from "@/lib/repo/rules";

export const metadata = { title: "Rules" };

// ts_headline marks matches with <b> tags. Splitting on them and rendering React
// elements shows the bold text without ever injecting raw HTML into the page.
function Snippet({ text }: { text: string }) {
  return <>{text.split(/<\/?b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</>;
}

export default async function RulesPage({ searchParams }: PageProps<"/rules">) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const q = sp.q?.trim();
  const [rules, results] = await Promise.all([listRules(), q ? searchRules(q) : null]);

  return (
    <>
      <PageHeader title="Rules" subtitle="The regulations the validator checks. Thresholds live here, not in the code." />

      <FilterBar resetHref="/rules">
        <input name="q" defaultValue={q} placeholder="Search the rules, e.g. rest period" className="field max-w-80" />
      </FilterBar>

      {results && (
        <Card title={`${results.length} result${results.length === 1 ? "" : "s"} for “${q}”`} className="mb-6">
          {results.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">No rule matches that search.</p>
          ) : (
            <ul className="divide-y divide-line">
              {results.map((r) => (
                <li key={r.rule_code} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{r.rule_code} · {r.rule_name}</p>
                    <span className="font-mono text-xs text-muted">rank {r.rank.toFixed(3)}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted"><Snippet text={r.snippet} /></p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {rules.map((r) => (
          <Card key={r.rule_code} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[15px] font-semibold">{r.rule_code} · {r.rule_name}</h2>
              <span className="flex shrink-0 gap-1.5">
                {!r.is_active && <Badge>inactive</Badge>}
                <Badge tone={severityTone(r.severity)}>{r.severity.toLowerCase()}</Badge>
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{r.description}</p>
            <dl className="mt-4 grid grid-cols-3 gap-4">
              <Field label="Threshold">
                {r.threshold_value == null ? "—" : `${r.threshold_value} ${r.threshold_unit?.toLowerCase() ?? ""}`}
              </Field>
              <Field label="Window">{r.window_days == null ? "—" : `${r.window_days} days`}</Field>
              <Field label="Regulation">{r.regulation_ref ?? "—"}</Field>
            </dl>
          </Card>
        ))}
      </div>
    </>
  );
}
