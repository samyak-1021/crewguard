import { redirect } from "next/navigation";
import { ApiForm, Label } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtRole, ROLES } from "@/lib/format";
import { listAirports } from "@/lib/repo/reference";

export const metadata = { title: "Add crew member" };

export default async function NewCrewPage() {
  const session = await requireSession();
  if (session.role !== "SCHEDULER") redirect("/crew");
  const airports = await listAirports();

  return (
    <>
      <PageHeader title="Add crew member" subtitle="Inputs are checked by the database's constraints." />
      <Card className="max-w-2xl p-6">
        <ApiForm action="/api/crew" redirectTo="/crew/{id}" submitLabel="Add crew member">
          <div className="grid grid-cols-2 gap-4">
            <Label text="Employee code"><input name="employee_code" className="field" placeholder="EMP1014" /></Label>
            <Label text="Role">
              <select name="crew_role" className="field">
                {ROLES.map((r) => <option key={r} value={r}>{fmtRole(r)}</option>)}
              </select>
            </Label>
            <Label text="First name"><input name="first_name" className="field" /></Label>
            <Label text="Last name"><input name="last_name" className="field" /></Label>
            <Label text="Home base">
              <select name="home_base" className="field">
                {airports.map((a) => <option key={a.iata_code} value={a.iata_code}>{a.iata_code} · {a.city}</option>)}
              </select>
            </Label>
            <Label text="Hire date"><input name="hire_date" type="date" className="field" /></Label>
          </div>
        </ApiForm>
      </Card>
    </>
  );
}
