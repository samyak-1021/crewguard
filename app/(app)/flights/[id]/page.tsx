import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignCrewForm } from "@/components/assign-crew-form";
import { DeleteButton } from "@/components/forms";
import { Card, Field, PageHeader, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDateTime, fmtHours, fmtRole, toInputUtc } from "@/lib/format";
import { getAssignableCrew, getFlight, getFlightCrew } from "@/lib/repo/flights";

export default async function FlightDetailPage({ params }: PageProps<"/flights/[id]">) {
  const id = Number((await params).id);
  const flight = await getFlight(id);
  if (!flight) notFound();

  const [session, crew, candidates] = await Promise.all([requireSession(), getFlightCrew(id), getAssignableCrew(id)]);
  const canEdit = session.role === "SCHEDULER";

  // default duty window: report 1 h before departure, release 30 min after arrival
  const dep = new Date(flight.sched_dep_utc);
  const arr = new Date(flight.sched_arr_utc);
  const defaultStart = toInputUtc(new Date(dep.getTime() - 60 * 60 * 1000));
  const defaultEnd = toInputUtc(new Date(arr.getTime() + 30 * 60 * 1000));

  return (
    <>
      <Link href="/flights" className="text-sm text-accent hover:underline">← Flights</Link>
      <PageHeader
        title={`${flight.flight_number} · ${flight.dep_airport} → ${flight.arr_airport}`}
        subtitle={`${flight.dep_city} to ${flight.arr_city} · ${flight.aircraft}`}
        action={canEdit && <DeleteButton url={`/api/flights/${id}`} redirectTo="/flights" label="Delete flight" />}
      />

      <Card className="p-5">
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Departure (UTC)">{fmtDateTime(flight.sched_dep_utc)}</Field>
          <Field label="Arrival (UTC)">{fmtDateTime(flight.sched_arr_utc)}</Field>
          <Field label="Block time">{fmtHours(flight.block_hours)}</Field>
          <Field label="Aircraft type">{flight.type_code}</Field>
        </dl>
      </Card>

      <Card title={`Crew on board · ${crew.length}`} className="mt-6">
        <Table head={["Crew member", "Role", "Duty start", "Duty end", "Duty hours", ""]} empty={crew.length === 0}>
          {crew.map((c) => (
            <tr key={c.assignment_id}>
              <Td>
                <Link href={`/crew/${c.crew_id}`} className="font-medium hover:text-accent">{c.crew_name}</Link>
                <span className="ml-2 text-muted">{c.employee_code}</span>
              </Td>
              <Td>{fmtRole(c.assigned_role)}</Td>
              <Td>{fmtDateTime(c.duty_start_utc)}</Td>
              <Td>{fmtDateTime(c.duty_end_utc)}</Td>
              <Td>{fmtHours(c.duty_hours)}</Td>
              <Td className="text-right">{canEdit && <DeleteButton url={`/api/duties/${c.assignment_id}`} label="Remove" />}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      {canEdit && (
        <Card title="Assign crew" className="mt-6">
          <AssignCrewForm
            flightId={id}
            typeCode={flight.type_code}
            candidates={candidates}
            defaultStart={defaultStart}
            defaultEnd={defaultEnd}
          />
        </Card>
      )}
    </>
  );
}
