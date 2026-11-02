import Link from "next/link";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { fmtHours } from "@/lib/format";
import { aircraftUsage, airportUsage } from "@/lib/repo/reference";

export const metadata = { title: "Airports & fleet" };

export default async function ReferencePage() {
  const [airports, types] = await Promise.all([airportUsage(), aircraftUsage()]);

  return (
    <>
      <PageHeader title="Airports & fleet" subtitle="Master data, with how much of the roster uses each row." />

      <Card title="Aircraft types">
        <Table head={["Type", "Manufacturer", "Description", "Flights", "Duty hours", "Pilots with a valid rating"]}>
          {types.map((t) => (
            <tr key={t.type_code}>
              <Td className="font-medium"><Link href={`/flights?type=${t.type_code}`} className="hover:text-accent">{t.type_code}</Link></Td>
              <Td>{t.manufacturer}</Td>
              <Td className="text-muted">{t.description}</Td>
              <Td>{t.flights}</Td>
              <Td>{fmtHours(t.duty_hours)}</Td>
              <Td>{t.rated_pilots}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Airports" className="mt-6">
        <Table head={["IATA", "Airport", "City", "Country", "Time zone", "Crew based", "Departures", "Arrivals"]}>
          {airports.map((a) => (
            <tr key={a.iata_code}>
              <Td className="font-medium"><Link href={`/flights?airport=${a.iata_code}`} className="hover:text-accent">{a.iata_code}</Link></Td>
              <Td>{a.name}</Td>
              <Td>{a.city}</Td>
              <Td>{a.country}</Td>
              <Td className="text-muted">{a.timezone}</Td>
              <Td>{a.crew_based}</Td>
              <Td>{a.departures}</Td>
              <Td>{a.arrivals}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
