// SQL for master data: airports and aircraft types.
import { query } from "@/lib/db";

export type Airport = { iata_code: string; name: string; city: string; country: string; timezone: string };
export type AircraftType = { type_code: string; manufacturer: string; description: string | null };

export const listAirports = () => query<Airport>("SELECT * FROM airport ORDER BY iata_code");
export const listAircraftTypes = () => query<AircraftType>("SELECT * FROM aircraft_type ORDER BY type_code");

// Usage of each airport, with correlated scalar sub-queries (one per column).
// ORDER BY may use a bare alias but not an expression on aliases
// (departures + arrivals), so the query is wrapped in a derived table.
export function airportUsage() {
  return query<Airport & { crew_based: number; departures: number; arrivals: number }>(`
    SELECT * FROM (
      SELECT a.*,
             (SELECT COUNT(*) FROM crew_member cm WHERE cm.home_base   = a.iata_code) AS crew_based,
             (SELECT COUNT(*) FROM flight f       WHERE f.dep_airport  = a.iata_code) AS departures,
             (SELECT COUNT(*) FROM flight f       WHERE f.arr_airport  = a.iata_code) AS arrivals
      FROM airport a
    ) usage
    ORDER BY departures + arrivals DESC, iata_code`);
}

// Usage of each aircraft type: flights flown, and pilots with a CURRENT rating.
export function aircraftUsage() {
  return query<AircraftType & { flights: number; rated_pilots: number; duty_hours: number }>(`
    SELECT t.*,
           (SELECT COUNT(*) FROM flight f WHERE f.type_code = t.type_code)              AS flights,
           (SELECT COUNT(DISTINCT c.crew_id) FROM certification c
             WHERE c.type_code = t.type_code AND c.expires_on >= CURRENT_DATE)          AS rated_pilots,
           (SELECT COALESCE(SUM(r.duty_hours), 0) FROM v_duty_roster r
             WHERE r.type_code = t.type_code)                                           AS duty_hours
    FROM aircraft_type t
    ORDER BY t.type_code`);
}
