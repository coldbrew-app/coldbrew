import { consola, createConsola, LogLevels } from "consola";

consola.wrapAll();

export const logger = createConsola({
  level: LogLevels.debug,
});
