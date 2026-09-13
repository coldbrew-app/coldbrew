-- migrate:up
DO $migration$
DECLARE
  source_schema name := current_schema();
  auth_schema name;
BEGIN
  IF source_schema IS NULL THEN
    RAISE EXCEPTION 'cannot determine the source schema from search_path';
  END IF;

  auth_schema := CASE
    WHEN source_schema = 'public' THEN 'auth'
    ELSE source_schema || '_auth'
  END;

  IF to_regnamespace(auth_schema) IS NOT NULL THEN
    RAISE EXCEPTION 'target auth schema % already exists', auth_schema;
  END IF;

  IF to_regclass(format('%I.auth_user', source_schema)) IS NULL
    OR to_regclass(format('%I.auth_session', source_schema)) IS NULL
    OR to_regclass(format('%I.auth_account', source_schema)) IS NULL
    OR to_regclass(format('%I.auth_verification', source_schema)) IS NULL THEN
    RAISE EXCEPTION 'Better Auth tables are missing from schema %', source_schema;
  END IF;

  EXECUTE format('CREATE SCHEMA %I', auth_schema);
  EXECUTE format('ALTER TABLE %I.auth_user SET SCHEMA %I', source_schema, auth_schema);
  EXECUTE format('ALTER TABLE %I.auth_session SET SCHEMA %I', source_schema, auth_schema);
  EXECUTE format('ALTER TABLE %I.auth_account SET SCHEMA %I', source_schema, auth_schema);
  EXECUTE format('ALTER TABLE %I.auth_verification SET SCHEMA %I', source_schema, auth_schema);
END;
$migration$;

-- migrate:down
DO $migration$
DECLARE
  target_schema name := current_schema();
  auth_schema name;
BEGIN
  IF target_schema IS NULL THEN
    RAISE EXCEPTION 'cannot determine the target schema from search_path';
  END IF;

  auth_schema := CASE
    WHEN target_schema = 'public' THEN 'auth'
    ELSE target_schema || '_auth'
  END;

  IF to_regclass(format('%I.auth_user', target_schema)) IS NOT NULL
    OR to_regclass(format('%I.auth_session', target_schema)) IS NOT NULL
    OR to_regclass(format('%I.auth_account', target_schema)) IS NOT NULL
    OR to_regclass(format('%I.auth_verification', target_schema)) IS NOT NULL THEN
    RAISE EXCEPTION 'target schema % already contains Better Auth tables', target_schema;
  END IF;

  IF to_regclass(format('%I.auth_user', auth_schema)) IS NULL
    OR to_regclass(format('%I.auth_session', auth_schema)) IS NULL
    OR to_regclass(format('%I.auth_account', auth_schema)) IS NULL
    OR to_regclass(format('%I.auth_verification', auth_schema)) IS NULL THEN
    RAISE EXCEPTION 'Better Auth tables are missing from schema %', auth_schema;
  END IF;

  EXECUTE format('ALTER TABLE %I.auth_user SET SCHEMA %I', auth_schema, target_schema);
  EXECUTE format('ALTER TABLE %I.auth_session SET SCHEMA %I', auth_schema, target_schema);
  EXECUTE format('ALTER TABLE %I.auth_account SET SCHEMA %I', auth_schema, target_schema);
  EXECUTE format('ALTER TABLE %I.auth_verification SET SCHEMA %I', auth_schema, target_schema);
  EXECUTE format('DROP SCHEMA %I', auth_schema);
END;
$migration$;
