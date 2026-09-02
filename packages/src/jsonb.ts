import type { Sql, TransactionSql } from "postgres";
import snakecaseKeys from "snakecase-keys";

type JsonValue =
  | null
  | string
  | number
  | boolean
  | Date
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Date
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export function jsonb(sql: Sql | TransactionSql, data: readonly unknown[]) {
  const transformed = data.map((element) => {
    if (!isRecord(element)) {
      throw new TypeError("JSONB rows must be objects.");
    }
    const row: unknown = snakecaseKeys(element, { deep: false });
    if (!isJsonValue(row)) {
      throw new TypeError("JSONB rows must contain only JSON-compatible values.");
    }
    return row;
  });
  return sql.json(transformed);
}
