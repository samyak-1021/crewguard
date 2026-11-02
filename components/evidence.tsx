// Renders a violation's MongoDB evidence document. Each rule stores a different
// shape, so each rule gets its own layout.
import { Field, Table, Td } from "@/components/ui";
import { fmtExact } from "@/components/compliance";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { EvidenceDoc } from "@/lib/repo/evidence";

function Fields({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-2 gap-4 p-5 md:grid-cols-4">{children}</dl>;
}

export function EvidencePanel({ doc }: { doc: EvidenceDoc | null }) {
  if (!doc) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted">
        Evidence unavailable. The violation itself is safe in PostgreSQL; the evidence document could not be read from MongoDB.
      </p>
    );
  }

  switch (doc.rule_code) {
    case "RST": {
      const e = doc.evidence;
      return (
        <Fields>
          <Field label="Previous duty">{e.previous_duty.flight_number}, ended {fmtDateTime(e.previous_duty.end)}</Field>
          <Field label="Next duty">{e.next_duty.flight_number}, started {fmtDateTime(e.next_duty.start)}</Field>
          <Field label="Rest received">{fmtExact(e.rest_hours)}</Field>
          <Field label="Rest required">{fmtExact(e.required_hours)}</Field>
        </Fields>
      );
    }
    case "FDP": {
      const e = doc.evidence;
      return (
        <Fields>
          <Field label="Flight">{e.flight_number} · {e.sector}</Field>
          <Field label="Duty">{fmtDateTime(e.duty_start)} to {fmtDateTime(e.duty_end)}</Field>
          <Field label="Duty length">{fmtExact(e.duty_hours)}</Field>
          <Field label="Limit">{fmtExact(e.limit_hours)}</Field>
        </Fields>
      );
    }
    case "WDH": {
      const e = doc.evidence;
      return (
        <>
          <Fields>
            <Field label="Window start">{fmtDateTime(e.window_start)}</Field>
            <Field label="Window end">{fmtDateTime(e.window_end)}</Field>
            <Field label="Total in window">{fmtExact(e.total_hours)}</Field>
            <Field label="Limit">{fmtExact(e.limit_hours)}</Field>
          </Fields>
          <Table head={["Flight", "Duty start", "Hours"]}>
            {e.duties.map((d) => (
              <tr key={`${d.flight_number}-${String(d.start)}`}>
                <Td>{d.flight_number}</Td>
                <Td>{fmtDateTime(d.start)}</Td>
                <Td>{fmtExact(d.hours)}</Td>
              </tr>
            ))}
          </Table>
        </>
      );
    }
    case "CER": {
      const e = doc.evidence;
      return (
        <>
          <Fields>
            <Field label="Flight">{e.flight_number}</Field>
            <Field label="Aircraft type">{e.aircraft_type}</Field>
            <Field label="Duty date">{fmtDate(e.duty_date)}</Field>
            <Field label="Reason">{e.reason === "EXPIRED" ? "Rating expired" : "No rating for this type"}</Field>
          </Fields>
          <Table head={["Ratings held", "Issued", "Expires"]} empty={e.ratings_held.length === 0}>
            {e.ratings_held.map((r) => (
              <tr key={`${r.type_code}-${r.issued_on}`}>
                <Td>{r.type_code}</Td>
                <Td>{fmtDate(r.issued_on)}</Td>
                <Td>{fmtDate(r.expires_on)}</Td>
              </tr>
            ))}
          </Table>
        </>
      );
    }
  }
}
