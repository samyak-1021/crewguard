import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiForm, DeleteButton, Label } from "@/components/forms";
import { Badge, Card, certTone, PageHeader, Stat, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtHours, fmtRole } from "@/lib/format";
import { getCertifications, getCrew, getCrewRoster, getWeeklyHours } from "@/lib/repo/crew";
import { listAircraftTypes, listAirports } from "@/lib/repo/reference";

const WEEKLY_LIMIT = 60; // WDH rule threshold, drawn as a reference line

export default async function CrewDetailPage({ params }: PageProps<"/crew/[id]">) {
  const id = Number((await params).id);
  const crew = await getCrew(id);
  if (!crew) notFound();

  const [session, certs, roster, weeks, airports, types] = await Promise.all([
    requireSession(), getCertifications(id), getCrewRoster(id), getWeeklyHours(id), listAirports(), listAircraftTypes(),
  ]);
  const canEdit = session.role === "SCHEDULER";
  const isPilot = crew.crew_role !== "CABIN_CREW";
  const maxWeek = Math.max(WEEKLY_LIMIT, ...weeks.map((w) => w.hours));

  return (
    <>
      <Link href="/crew" className="text-sm text-accent hover:underline">← Crew</Link>
      <PageHeader
        title={crew.crew_name}
        subtitle={
          <span className="flex items-center gap-2">
            {crew.employee_code} · {fmtRole(crew.crew_role)} · based {crew.home_base}
            <Badge tone={crew.is_active ? "green" : "gray"}>{crew.is_active ? "active" : "inactive"}</Badge>
          </span>
        }
        action={canEdit && <DeleteButton url={`/api/crew/${id}`} redirectTo="/crew" label="Delete crew member" />}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Duties" value={crew.duty_count} />
        <Stat label="Duty hours" value={fmtHours(crew.total_duty_hours)} />
        <Stat label="Valid ratings" value={isPilot ? crew.valid_certs : "n/a"} />
        <Stat label="Hired" value={<span className="text-xl">{fmtDate(crew.hire_date)}</span>} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Weekly duty hours" className="lg:col-span-1">
          <div className="space-y-3 px-5 py-4">
            {weeks.map((w) => (
              <div key={String(w.week_start)}>
                <div className="flex justify-between text-sm">
                  <span>Week of {fmtDate(w.week_start)}</span>
                  <span className={w.hours > WEEKLY_LIMIT ? "font-semibold text-red-600" : "text-muted"}>{fmtHours(w.hours)}</span>
                </div>
                <div className="relative mt-1.5 h-2 rounded-full bg-zinc-100">
                  <div
                    className={`h-2 rounded-full ${w.hours > WEEKLY_LIMIT ? "bg-red-500" : "bg-accent"}`}
                    style={{ width: `${(w.hours / maxWeek) * 100}%` }}
                  />
                  <div className="absolute -top-1 h-4 w-px bg-ink/40" style={{ left: `${(WEEKLY_LIMIT / maxWeek) * 100}%` }} />
                </div>
              </div>
            ))}
            <p className="text-xs text-muted">Line = {WEEKLY_LIMIT} h limit (rule WDH, checked over rolling 7 days by the validator).</p>
          </div>
        </Card>

        <Card title="Type ratings" className="lg:col-span-2">
          {isPilot ? (
            <>
              <Table head={["Aircraft", "Issued", "Expires", "Status", ""]} empty={certs.length === 0}>
                {certs.map((c) => (
                  <tr key={c.cert_id} className={c.is_current ? "" : "opacity-50"}>
                    <Td className="font-medium">{c.type_code}</Td>
                    <Td>{fmtDate(c.issued_on)}</Td>
                    <Td>{fmtDate(c.expires_on)}</Td>
                    <Td>
                      <Badge tone={certTone(c.status)}>{c.status.toLowerCase()}</Badge>
                      {!c.is_current && <span className="ml-2 text-xs text-muted">renewed</span>}
                    </Td>
                    <Td className="text-right">{canEdit && <DeleteButton url={`/api/certifications/${c.cert_id}`} />}</Td>
                  </tr>
                ))}
              </Table>
              {canEdit && (
                <div className="border-t border-line p-5">
                  <ApiForm action={`/api/crew/${id}/certifications`} submitLabel="Add rating">
                    <div className="grid grid-cols-3 gap-3">
                      <Label text="Aircraft type">
                        <select name="type_code" className="field">
                          {types.map((t) => <option key={t.type_code} value={t.type_code}>{t.type_code}</option>)}
                        </select>
                      </Label>
                      <Label text="Issued on"><input name="issued_on" type="date" className="field" /></Label>
                      <Label text="Expires on"><input name="expires_on" type="date" className="field" /></Label>
                    </div>
                  </ApiForm>
                </div>
              )}
            </>
          ) : (
            <p className="px-5 py-6 text-sm text-muted">Cabin crew do not need aircraft type ratings.</p>
          )}
        </Card>
      </div>

      <Card title={`Roster · ${roster.length} duties`} className="mt-6">
        <Table head={["Flight", "Sector", "Aircraft", "Role", "Duty start", "Duty end", "Hours", ""]} empty={roster.length === 0}>
          {roster.map((r) => (
            <tr key={r.assignment_id}>
              <Td><Link href={`/flights/${r.flight_id}`} className="font-medium hover:text-accent">{r.flight_number}</Link></Td>
              <Td>{r.sector}</Td>
              <Td>{r.type_code}</Td>
              <Td>{fmtRole(r.assigned_role)}</Td>
              <Td>{fmtDateTime(r.duty_start_utc)}</Td>
              <Td>{fmtDateTime(r.duty_end_utc)}</Td>
              <Td className={r.duty_hours > 13 ? "font-semibold text-red-600" : ""}>{fmtHours(r.duty_hours)}</Td>
              <Td className="text-right">{canEdit && <DeleteButton url={`/api/duties/${r.assignment_id}`} label="Remove" />}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      {canEdit && (
        <Card title="Edit details" className="mt-6">
          <div className="p-5">
            <ApiForm action={`/api/crew/${id}`} method="PATCH" submitLabel="Save changes">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Label text="First name"><input name="first_name" defaultValue={crew.first_name} className="field" /></Label>
                <Label text="Last name"><input name="last_name" defaultValue={crew.last_name} className="field" /></Label>
                <Label text="Home base">
                  <select name="home_base" defaultValue={crew.home_base} className="field">
                    {airports.map((a) => <option key={a.iata_code} value={a.iata_code}>{a.iata_code} · {a.city}</option>)}
                  </select>
                </Label>
                <Label text="Status">
                  <select name="is_active" defaultValue={String(crew.is_active)} className="field">
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </Label>
              </div>
            </ApiForm>
          </div>
        </Card>
      )}
    </>
  );
}
