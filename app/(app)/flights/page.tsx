import Link from "next/link";
import { Badge, ButtonLink, Card, FilterBar, PageHeader, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDateTime, fmtHours, fmtTime } from "@/lib/format";
import { listFlights } from "@/lib/repo/flights";
import { listAircraftTypes, listAirports } from "@/lib/repo/reference";

export const metadata = { title: "Flights" };

export default async function FlightsPage({ searchParams }: PageProps<"/flights">) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const [session, flights, airports, types] = await Promise.all([
    requireSession(), listFlights(sp), listAirports(), listAircraftTypes(),
  ]);

  return (
    <>
      <PageHeader
        title="Flights"
        subtitle={`${flights.length} flight${flights.length === 1 ? "" : "s"} · times UTC`}
        action={session.role === "SCHEDULER" && <ButtonLink href="/flights/new">Schedule flight</ButtonLink>}
      />

      <FilterBar resetHref="/flights">
        <input name="date" type="date" defaultValue={sp.date} className="field w-auto" />
        <select name="airport" defaultValue={sp.airport ?? ""} className="field w-auto">
          <option value="">Any airport</option>
          {airports.map((a) => <option key={a.iata_code} value={a.iata_code}>{a.iata_code} · {a.city}</option>)}
        </select>
        <select name="type" defaultValue={sp.type ?? ""} className="field w-auto">
          <option value="">Any aircraft</option>
          {types.map((t) => <option key={t.type_code} value={t.type_code}>{t.type_code}</option>)}
        </select>
      </FilterBar>

      <Card>
        <Table head={["Flight", "Route", "Aircraft", "Departs", "Arrives", "Block", "Crew"]} empty={flights.length === 0}>
          {flights.map((f) => (
            <tr key={f.flight_id}>
              <Td><Link href={`/flights/${f.flight_id}`} className="font-medium hover:text-accent">{f.flight_number}</Link></Td>
              <Td>{f.dep_airport} → {f.arr_airport}</Td>
              <Td>{f.type_code}</Td>
              <Td>{fmtDateTime(f.sched_dep_utc)}</Td>
              <Td>{fmtTime(f.sched_arr_utc)}</Td>
              <Td>{fmtHours(f.block_hours)}</Td>
              <Td>
                {f.crew_count === 0
                  ? <Badge tone="amber">unstaffed</Badge>
                  : <span>{f.crew_count} <span className="text-muted">({f.pilot_count} pilots)</span></span>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
