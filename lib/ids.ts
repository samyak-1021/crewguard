// A numeric id from a URL, or null. Anything else (or anything too large for an
// INTEGER column) would make PostgreSQL raise an error instead of giving a 404.
export const toId = (value: string | undefined) => (value && /^\d{1,9}$/.test(value) ? Number(value) : null);
