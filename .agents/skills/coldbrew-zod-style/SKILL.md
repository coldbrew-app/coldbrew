---
name: coldbrew-zod-style
description: "Write and review Zod schemas in Coldbrew, including schemas for API, database, and tRPC validation."
---

# Coldbrew Zod style

Apply this skill whenever creating, editing, or reviewing Zod schemas.

## Object formatting

- Always format `z.object({...})` calls across multiple lines, even when the object has only one field.

## Schema names

- Name every extracted Zod schema in `PascalCase`, starting with an uppercase letter.
- Keep a one-use schema anonymous when it is created locally inside a function only to validate untrusted data returned by an external API or the database. Parse with the inline schema instead of extracting it into a named constant.

```ts
const DonationSchema = z.object({
  donationId: z.string(),
});

async function loadDonation() {
  const row = await loadDonationRow();

  return z
    .object({
      donationId: z.string(),
    })
    .parse(row);
}
```

## tRPC input schemas

- Define every schema that validates `.input()` directly inside `.input()`.
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

- Every environment variable passed to `getEnv()` must be required.
- Do not use `.optional()`, `.nullish()`, `.default()`, `.catch()`, or another schema that accepts a missing value in a `getEnv()` shape. Defaults belong in the environment configuration, not in the application schema.
