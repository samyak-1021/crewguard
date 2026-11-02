import Link from "next/link";
import { Badge, ButtonLink, Card, FilterBar, PageHeader, Table, Td } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { fmtDateTime, fmtHours, fmtRole, ROLES } from "@/lib/format";
import { listCrew } from "@/lib/repo/crew";
import { listAirports } from "@/lib/repo/reference";

export const metadata = { title: "Crew" };

export default async function CrewPage({ searchParams }: PageProps<"/crew">) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const [session, crew, airports] = await Promise.all([requireSession(), listCrew(sp), listAirports()]);

  return (
    <>
      <PageHeader
        title="Crew"
        subtitle={`${crew.length} crew member${crew.length === 1 ? "" : "s"}`}
        action={session.role === "SCHEDULER" && <ButtonLink href="/crew/new">Add crew member</ButtonLink>}
      />

      <FilterBar resetHref="/crew">
        <input name="q" defaultValue={sp.q} placeholder="Search name or employee code" className="field max-w-64" />
        <select name="role" defaultValue={sp.role ?? ""} className="field w-auto">
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{fmtRole(r)}</option>)}
        </select>
        <select name="base" defaultValue={sp.base ?? ""} className="field w-auto">
          <option value="">All bases</option>
          {airports.map((a) => <option key={a.iata_code} value={a.iata_code}>{a.iata_code} · {a.city}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} className="field w-auto">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </FilterBar>

      <Card>
        <Table head={["Crew member", "Role", "Base", "Duties", "Duty hours", "Valid ratings", "Last duty ends"]} empty={crew.length === 0}>
          {crew.map((c) => (
            <tr key={c.crew_id}>
              <Td>
                <Link href={`/crew/${c.crew_id}`} className="font-medium hover:text-accent">{c.crew_name}</Link>
                <span className="ml-2 text-muted">{c.employee_code}</span>
                {!c.is_active && <span className="ml-2"><Badge>inactive</Badge></span>}
              </Td>
              <Td>{fmtRole(c.crew_role)}</Td>
              <Td>{c.home_base}</Td>
              <Td>{c.duty_count}</Td>
              <Td>{fmtHours(c.total_duty_hours)}</Td>
              <Td>{c.crew_role === "CABIN_CREW" ? <span className="text-muted">n/a</span> : c.valid_certs}</Td>
              <Td className="text-muted">{fmtDateTime(c.last_duty_end)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
