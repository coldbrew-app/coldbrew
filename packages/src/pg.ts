import jsonBigint from "json-bigint";
import postgres from "postgres";

const JSONB_OID = 3802;
const jsonParser = jsonBigint({ storeAsString: true });

export function parseJsonb(value: string) {
  return jsonParser.parse(value);
}

export function createSql(url: string) {
  return postgres(url, {
    max: 10,
    transform: postgres.camel,
    types: {
      // Int64 in JSONB does not fit into JS number.
      // That's why we convert them to strings.
      jsonb: {
        from: [JSONB_OID],
        to: JSONB_OID,
        serialize: JSON.stringify,
        parse: parseJsonb,
      },
    },
  });
}
