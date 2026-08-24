# SQL style guide

This guide records the conventions already used by Coldbrew's PostgreSQL schema
and database stores. Apply it to `db/*.sql` and SQL embedded in TypeScript.

## General

- Write SQL keywords in uppercase (`SELECT`, `FROM`, `NOT NULL`, `PRIMARY KEY`,
  `CREATE TABLE`) and built-in SQL types in lowercase (`text`, `jsonb`).
- Write tables, columns, constraints, user-defined functions, and CTE names in
  lowercase `snake_case`. Write SQL function calls in lowercase
  (`coalesce`, `jsonb_build_object`, `now`).
- Use singular names for tables (`donation`, `video`) and an explicit
  `<entity>_id` name for their primary keys.
- Quote identifiers only when PostgreSQL requires it or when referring to an
  externally prescribed mixed-case name, such as `"user"` or Better Auth's
  `"userId"`.
- End standalone statements in `.sql` files with a semicolon. Do not add a
  semicolon inside a tagged SQL template.
- Prefer `SELECT *` when the entire row is needed and it does not create an
  ambiguity (for example, in a join) or an unnecessary data transfer. Specify
  a column list only when the selected shape must differ from the table row.

## Layout

- Put each major clause on its own line: `SELECT`, `FROM`, `WHERE`, `ORDER BY`,
  `INSERT INTO`, `VALUES`, `ON CONFLICT`, and `UPDATE`. Keep a short
  `RETURNING` expression on the same line as `RETURNING`; wrap only long
  expressions.
- Keep a short column list on one line. For a long list, wrap it after the
  opening parenthesis and align continuation lines by two spaces.
- Put one column definition or assignment per line when it does not fit
  comfortably on one line; use a trailing comma on every non-final line.
- In joins, put `JOIN` on a new line and indent its `ON` conditions by two
  spaces. Continue a compound condition with aligned `AND`/`OR`.
- Keep simple related clauses together when they remain readable, for example
  `WHERE user_id = ...` followed by `ORDER BY ...` on the next line.

## Schema definitions

- Declare project domains and enums before the tables that use them.
- Order table declarations by dependency, so referenced tables exist first.
- Align the type and constraint portions of column declarations with spaces.
- Use named indexes in the `<table>_<purpose>_idx` form. Put multi-line index
  predicates on indented following lines.
- Place schema sections and trigger/function definitions under `--` comments.
- Format PL/pgSQL control-flow keywords in uppercase and indent bodies by two
  spaces.

## Queries in TypeScript

- Use the `postgres` tagged template (`sql\`...\``) for queries. Interpolate
values with `${value}`; never assemble values into a SQL string.
- Order `SELECT` expressions with direct columns without aliases first, then
  casts, functions, `CASE` expressions, JSON construction, and aliased values.
- Avoid `sql.unsafe`. Prefer a tagged template and a fixed query shape; if it
  is truly unavoidable, keep every dynamic fragment controlled by the
  application and pass values through its parameter array.
- Use `WITH input AS (...)` with `jsonb_to_recordset` for batch inserts. Name
  the source CTE `input` and list its record columns and types explicitly.
- Build JSON values in SQL with `jsonb_build_object` when a query returns a
  genuinely structured domain value. Keep flat domain fields as ordinary
  selected columns; do not group related columns into a JSON object only for
  transport. Use Zod to validate and parse returned JSON.
- When `json_build_object` or `jsonb_build_object` has more than four
  key-value pairs, format it across multiple lines with one pair per line and
  align the values in a second column.
- Specify an `INSERT` target column list when the table has defaults, generated
  columns, or columns not supplied by the query. Omit it only when every table
  column is intentionally provided in table order.
- For `INSERT ... SELECT`, prefer a target column list even when all current
  columns are supplied: it makes the mapping from the source query explicit
  and keeps the statement stable when the table changes.
- Qualify columns where a query joins tables or where the source could be
  ambiguous. Use `USING (column)` when the join key has the same name.
- For `INSERT ... SELECT`, put `INSERT INTO`, the target column list, `SELECT`,
  and `FROM` on separate lines. For upserts, put `ON CONFLICT` after the source
  query and `RETURNING` last.
- For `UPDATE`, start assignments after `SET`; use one assignment per line for
  multi-column updates, then `FROM`, `WHERE`, and `RETURNING` on their own
  lines.

## Preferred examples

```sql
SELECT *
FROM donation
WHERE user_id = ${userId}
ORDER BY occurred_at DESC, donation_id DESC
```

```sql
UPDATE donationalerts_connection
SET
  refresh_token = ${refreshToken},
  access_token = ${accessToken},
  token_version = token_version + 1,
  updated_at = now()
WHERE user_id = ${userId}
```

```sql
INSERT INTO donation (
  source, source_donation_id, user_id, author, message
)
SELECT source, source_donation_id, ${userId}, author, message
FROM input
ON CONFLICT (user_id, source, source_donation_id) DO NOTHING
RETURNING donation_id
```
