import { redirect } from "next/navigation";
import { ApiForm, Label } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { listAircraftTypes, listAirports } from "@/lib/repo/reference";

export const metadata = { title: "Schedule flight" };

export default async function NewFlightPage() {
  const session = await requireSession();
  if (session.role !== "SCHEDULER") redirect("/flights");
  const [airports, types] = await Promise.all([listAirports(), listAircraftTypes()]);

  const airportOptions = airports.map((a) => (
    <option key={a.iata_code} value={a.iata_code}>{a.iata_code} · {a.city}</option>
  ));

  return (
    <>
      <PageHeader title="Schedule flight" subtitle="Enter times in UTC." />
      <Card className="max-w-2xl p-6">
        <ApiForm action="/api/flights" redirectTo="/flights/{id}" submitLabel="Schedule flight">
          <div className="grid grid-cols-2 gap-4">
            <Label text="Flight number"><input name="flight_number" className="field" placeholder="CG601" /></Label>
            <Label text="Aircraft type">
              <select name="type_code" className="field">
                {types.map((t) => <option key={t.type_code} value={t.type_code}>{t.type_code} · {t.description}</option>)}
              </select>
            </Label>
            <Label text="From"><select name="dep_airport" className="field">{airportOptions}</select></Label>
            <Label text="To"><select name="arr_airport" defaultValue="DEL" className="field">{airportOptions}</select></Label>
            <Label text="Departure (UTC)"><input name="sched_dep_utc" type="datetime-local" className="field" /></Label>
            <Label text="Arrival (UTC)"><input name="sched_arr_utc" type="datetime-local" className="field" /></Label>
          </div>
        </ApiForm>
      </Card>
    </>
  );
}
