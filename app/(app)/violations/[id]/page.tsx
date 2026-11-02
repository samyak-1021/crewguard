import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtExact, REVIEW_STATUSES, reviewTone, severityTone } from "@/components/compliance";
import { EvidencePanel } from "@/components/evidence";
import { ApiForm, Label } from "@/components/forms";
import { Badge, Card, Field, PageHeader, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDateTime, fmtRole } from "@/lib/format";
import { toId } from "@/lib/ids";
import { getEvidence } from "@/lib/repo/evidence";
import { getViolation, getViolationDuties } from "@/lib/repo/violations";

// What each number on the page means, per rule.
const LIMITS: Record<string, { observed: string; limit: string }> = {
  RST: { observed: "Rest received", limit: "Minimum rest" },
  FDP: { observed: "Duty length", limit: "Maximum duty" },
  WDH: { observed: "Hours in window", limit: "Maximum hours" },
};

export default async function ViolationDetailPage({ params }: PageProps<"/violations/[id]">) {
  const id = toId((await params).id);
  const v = id === null ? null : await getViolation(id);
  if (id === null || !v) notFound();

  const [session, duties, evidence] = await Promise.all([
    requireSession(), getViolationDuties(id), getEvidence(v.evidence_doc_id),
  ]);
  const totalHours = duties.reduce((sum, d) => sum + d.contribution_value, 0);
  const labels = LIMITS[v.rule_code];

  return (
    <>
      <Link href={`/runs/${v.run_id}`} className="text-sm text-accent hover:underline">← Run #{v.run_id}</Link>
      <PageHeader
        title={`${v.rule_code} · ${v.crew_name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/crew/${v.crew_id}`} className="hover:text-accent">{v.employee_code}</Link>
            · {fmtRole(v.crew_role)}
            <Badge tone={severityTone(v.severity)}>{v.severity.toLowerCase()}</Badge>
            <Badge tone={reviewTone(v.review_status)}>{v.review_status.toLowerCase()}</Badge>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={v.rule_name}>
          <div className="space-y-4 p-5">
            <p className="text-sm leading-relaxed">{v.description}</p>
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Regulation">{v.regulation_ref ?? "—"}</Field>
              <Field label="Breach window">{fmtDateTime(v.window_start)} to {fmtDateTime(v.window_end)}</Field>
            </dl>
          </div>
        </Card>

        <Card title="What went wrong">
          {labels ? (
            <div className="grid grid-cols-2 divide-x divide-line p-5 text-center">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{labels.observed}</p>
                <p className="mt-2 text-4xl font-semibold tracking-tight text-red-600">{fmtExact(v.observed_value)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{labels.limit}</p>
                <p className="mt-2 text-4xl font-semibold tracking-tight">{fmtExact(v.threshold_value)}</p>
              </div>
            </div>
          ) : (
            <p className="p-5 text-sm leading-relaxed">
              This pilot flew an aircraft type without a type rating that was valid on the day of the duty.
              The evidence below shows the ratings they hold.
            </p>
          )}
        </Card>
      </div>

      <Card title={`Contributing duties · ${duties.length}`} className="mt-6 overflow-hidden">
        <Table head={["Flight", "Sector", "Aircraft", "Duty start", "Duty end", "Hours"]} empty={duties.length === 0}>
          {duties.map((d) => (
            <tr key={d.assignment_id}>
              <Td><Link href={`/flights/${d.flight_id}`} className="font-medium hover:text-accent">{d.flight_number}</Link></Td>
              <Td>{d.dep_airport} → {d.arr_airport}</Td>
              <Td>{d.type_code}</Td>
              <Td>{fmtDateTime(d.duty_start_utc)}</Td>
              <Td>{fmtDateTime(d.duty_end_utc)}</Td>
              <Td>{fmtExact(d.contribution_value)}</Td>
            </tr>
          ))}
          <tr className="bg-zinc-50 font-medium">
            <Td className="text-muted">Total duty hours</Td>
            <Td>{""}</Td>
            <Td>{""}</Td>
            <Td>{""}</Td>
            <Td>{""}</Td>
            <Td>{fmtExact(totalHours)}</Td>
          </tr>
        </Table>
      </Card>

      <Card
        title="Evidence"
        action={v.evidence_doc_id && <span className="font-mono text-xs text-muted">MongoDB · {v.evidence_doc_id}</span>}
        className="mt-6"
      >
        <EvidencePanel doc={evidence} />
      </Card>

      <Card title="Review" className="mt-6">
        <div className="p-5">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Status"><Badge tone={reviewTone(v.review_status)}>{v.review_status.toLowerCase()}</Badge></Field>
            <Field label="Reviewed by">{v.reviewer ?? "—"}</Field>
            <Field label="Status changed">{fmtDateTime(v.reviewed_at)}</Field>
          </dl>
          {v.review_note && <p className="mt-4 text-sm leading-relaxed">{v.review_note}</p>}

          {session.role === "AUDITOR" && (
            <ApiForm action={`/api/violations/${id}`} method="PATCH" submitLabel="Save review" className="mt-5 max-w-xl border-t border-line pt-5">
              <Label text="Status">
                <select name="review_status" defaultValue={v.review_status} className="field">
                  {REVIEW_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
                </select>
              </Label>
              <Label text="Note (required to resolve)">
                <textarea name="review_note" defaultValue={v.review_note ?? ""} rows={3} className="field" />
              </Label>
            </ApiForm>
          )}
        </div>
      </Card>
    </>
  );
}
