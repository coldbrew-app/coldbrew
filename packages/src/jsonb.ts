import { Sql, TransactionSql } from "postgres";
import snakecaseKeys from "snakecase-keys";

export function jsonb(sql: Sql | TransactionSql, data: readonly unknown[]) {
  return sql.json(data.map((elem) => snakecaseKeys(elem as any, { deep: false })));
}
