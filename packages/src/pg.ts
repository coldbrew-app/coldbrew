import jsonBigint from "json-bigint";
import postgres from "postgres";

const JSONB_OID = 3802;
const jsonParser = jsonBigint({ storeAsString: false });

export function createSql(url: string) {
  return postgres(url, {
    transform: postgres.camel,
    types: {
      // Int64 in JSONB does not fit into JS number.
      // That's why we convert them to strings.
      jsonb: {
        from: [JSONB_OID],
        to: JSONB_OID,
        serialize: JSON.stringify,
        parse: (str: string) => jsonParser.parse(str),
      },
    },
  });
}
