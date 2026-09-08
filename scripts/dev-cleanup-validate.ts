import assert from "node:assert/strict";

assert.match(
  process.env["PGDATABASE"] ?? "",
  /^coldbrew_[a-z0-9_]+_[0-9a-f]{8}$/,
  "Invalid primary development database; run just env-init in the primary checkout",
);
assert.match(
  process.env["NATS_NAMESPACE"] ?? "",
  /^wt_[0-9a-f]{8}$/,
  "Invalid primary NATS namespace; run just env-init in the primary checkout",
);
