import { Badge, Card, FilterBar, PageHeader, Table, Td } from "@/components/ui";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { fmtDateTime, fmtRole } from "@/lib/format";
import { listAudit, listUsernames } from "@/lib/repo/analytics";

export const metadata = { title: "Activity log" };

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const sp = (await searchParams) as Record<string, string | undefined>;
  const [entries, usernames] = await Promise.all([listAudit(sp), listUsernames()]);

  return (
    <>
      <PageHeader title="Activity log" subtitle="Newest 100 actions · from the MongoDB audit_log collection" />

      <FilterBar resetHref="/activity">
        <select name="action" defaultValue={sp.action ?? ""} className="field w-auto">
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select name="username" defaultValue={sp.username ?? ""} className="field w-auto">
          <option value="">All users</option>
          {usernames.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </FilterBar>

      <Card>
        {entries ? (
          <Table head={["Time", "User", "Action", "Entity", "Details"]} empty={entries.length === 0}>
            {entries.map((e) => (
              <tr key={String(e._id)}>
                <Td>{fmtDateTime(e.ts)}</Td>
                <Td>{e.user.username} <span className="text-muted">· {fmtRole(e.user.role)}</span></Td>
                <Td><Badge tone="blue">{e.action}</Badge></Td>
                <Td>{e.entity.type} #{e.entity.id}</Td>
                <Td className="font-mono text-xs text-muted">
                  {Object.keys(e.details).length ? JSON.stringify(e.details) : "—"}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted">
            MongoDB is not reachable, so the activity log is unavailable.
          </p>
        )}
      </Card>
    </>
  );
}
