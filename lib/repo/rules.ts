// SQL for the rule catalogue and its full-text search.
import { query } from "@/lib/db";

export type RuleRow = {
  rule_code: string; rule_name: string; description: string; regulation_ref: string | null;
  threshold_value: number | null; threshold_unit: string | null; window_days: number | null;
  severity: string; is_active: boolean;
};

export function listRules() {
  return query<RuleRow>("SELECT * FROM rule_definition ORDER BY rule_code");
}

// Must match the expression of the GIN index idx_rule_fts exactly, or PostgreSQL
// cannot use the index and scans the whole table instead.
const DOCUMENT = `to_tsvector('english', rule_name || ' ' || description || ' ' || COALESCE(regulation_ref, ''))`;

// websearch_to_tsquery accepts what people type into a search box ("rest period",
// quotes, or, -word) and never raises a syntax error on bad input.
// ts_headline returns the description with the matched words wrapped in <b> tags.
export function searchRules(q: string) {
  return query<{ rule_code: string; rule_name: string; severity: string; rank: number; snippet: string }>(
    `SELECT rule_code, rule_name, severity,
            ts_rank(${DOCUMENT}, websearch_to_tsquery('english', $1))                AS rank,
            ts_headline('english', description, websearch_to_tsquery('english', $1)) AS snippet
     FROM rule_definition
     WHERE ${DOCUMENT} @@ websearch_to_tsquery('english', $1)
     ORDER BY rank DESC, rule_code`,
    [q],
  );
}
