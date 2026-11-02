// Display helpers. All roster times are shown in UTC, as airlines do.
const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
});
const dateOnly = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const timeOnly = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

export const fmtDateTime = (d: Date | string | null) => (d ? dateTime.format(new Date(d)) : "—");
export const fmtDate = (d: Date | string | null) => (d ? dateOnly.format(new Date(d)) : "—");
export const fmtTime = (d: Date | string | null) => (d ? timeOnly.format(new Date(d)) : "—");
export const fmtHours = (h: number | null) => (h == null ? "—" : `${h.toFixed(1)} h`);

// "CABIN_CREW" -> "Cabin crew"
export const fmtRole = (r: string) => r.charAt(0) + r.slice(1).toLowerCase().replace("_", " ");

// Value for an <input type="datetime-local"> in UTC, e.g. "2026-11-02T01:00"
export const toInputUtc = (d: Date | string) => new Date(d).toISOString().slice(0, 16);

export const ROLES = ["CAPTAIN", "FIRST_OFFICER", "CABIN_CREW"] as const;
