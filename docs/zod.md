# Coldbrew Zod Guide

Follow this guide whenever creating, editing, or reviewing Zod schemas.

## Object formatting

- Always format `z.object({...})` calls across multiple lines, even when the object has only one field.

## Integer schemas

- Use `z.int()` instead of `z.number().int()`.

## Schema names

- Name every reusable or module-level Zod schema in `PascalCase`, starting with an uppercase letter.
- When a schema is used once inside a function only to validate untrusted data returned by an external API or the database, assign it to a local constant before parsing. Name it `schema` when the function has only one local validation schema; use a descriptive camelCase name such as `countSchema` when several local schemas must be distinguished. Do not call `.parse()`, `.safeParse()`, or `validate()` directly on an inline `z.*` schema expression.
- When validating an array of such values, define the item schema as `const schema = ...` and parse with `z.array(schema).parse(data)`. Do not wrap the array in the local schema.
- A complex schema that uses `z.union()` may remain extracted at module level even when it has only one validation site. Give it a `PascalCase` name.

```ts
const DonationSchema = z.object({
  donationId: z.string(),
});

async function loadDonation() {
  const row = await loadDonationRow();
  const schema = z.object({
    donationId: z.string(),
  });

  return schema.parse(row);
}

async function loadDonations() {
  const rows = await loadDonationRows();
  const schema = z.object({
    donationId: z.string(),
  });

  return z.array(schema).parse(rows);
}
```

## Database rows

- Validate a whole database row with an object schema before reading fields from it. Do not pull a field out of an unvalidated row and pass only that field to a scalar schema.
- When a query must return a row, parse it with `schema.parse(rows[0])` and then read the field from the parsed object.
- When a query may return zero or one row, make the object schema optional at the parse site with `schema.optional().parse(rows[0])`. Do not make the row nullable or replace a missing row with `null` before parsing.

```ts
const rows = await loadDonationRows();
const schema = z.object({
  donationId: DonationIdSchema,
});

return schema.optional().parse(rows[0])?.donationId;
```

## tRPC input schemas

- Define every schema that validates `.input()` directly inside `.input()`, unless it is a shared schema defined in `packages/src/schemas.ts` and reused elsewhere.
- A shared schema from `packages/src/schemas.ts` may be passed directly to `.input()` when it has other consumers outside that procedure.
- Do not extract a tRPC input schema into a top-level or local variable, even when it is used by only one procedure.

```ts
const getDonation = protectedProcedure
  .input(
    z.object({
      donationId: z.string(),
    }),
  )
  .query(({ input }) => loadDonation(input.donationId));
```

## Environment schemas

- Define server environment variables in the `server` shape passed to `createEnv()` from `@t3-oss/env-core`.
- Every environment variable must be required unless the application intentionally supports the feature being unconfigured.
- Do not use `.optional()`, `.nullish()`, `.default()`, `.catch()`, or another schema that accepts a missing value merely to compensate for missing deployment configuration. Defaults belong in the environment configuration, not in the application schema.
- Do not add runtime guards for required environment values returned by `createEnv()`. Missing or invalid configuration must fail during environment parsing at startup.
