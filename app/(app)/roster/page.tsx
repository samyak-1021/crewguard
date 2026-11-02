import Link from "next/link";
import { Card, FilterBar, PageHeader, Table, Td } from "@/components/ui";
import { fmtDateTime, fmtHours, fmtRole, ROLES } from "@/lib/format";
import { listRoster } from "@/lib/repo/roster";

export const metadata = { title: "Duty roster" };

export default async function RosterPage({ searchParams }: PageProps<"/roster">) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const rows = await listRoster(sp);
  const totalHours = rows.reduce((sum, r) => sum + r.duty_hours, 0);

  return (
    <>
      <PageHeader
        title="Duty roster"
        subtitle={`${rows.length} duties · ${fmtHours(totalHours)} · from the v_duty_roster view`}
      />

      <FilterBar resetHref="/roster">
        <input name="from" type="date" defaultValue={sp.from} className="field w-auto" aria-label="From" />
        <span className="text-sm text-muted">to</span>
        <input name="to" type="date" defaultValue={sp.to} className="field w-auto" aria-label="To" />
        <select name="role" defaultValue={sp.role ?? ""} className="field w-auto">
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{fmtRole(r)}</option>)}
        </select>
        <input name="q" defaultValue={sp.q} placeholder="Crew or flight number" className="field max-w-56" />
      </FilterBar>

      <Card>
        <Table head={["Duty start", "Duty end", "Crew member", "Role", "Flight", "Sector", "Aircraft", "Hours"]} empty={rows.length === 0}>
          {rows.map((r) => (
            <tr key={r.assignment_id} className="hover:bg-zinc-50">
              <Td>{fmtDateTime(r.duty_start_utc)}</Td>
              <Td className="text-muted">{fmtDateTime(r.duty_end_utc)}</Td>
              <Td><Link href={`/crew/${r.crew_id}`} className="font-medium hover:text-accent">{r.crew_name}</Link></Td>
              <Td>{fmtRole(r.assigned_role)}</Td>
              <Td><Link href={`/flights/${r.flight_id}`} className="hover:text-accent">{r.flight_number}</Link></Td>
              <Td>{r.dep_airport} → {r.arr_airport}</Td>
              <Td>{r.type_code}</Td>
              <Td>{fmtHours(r.duty_hours)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
