-- Local-only roles for the loopback development container. These fixed values
-- are intentionally non-secret and must never be reused by a hosted database.

DO $tab10_database_acl$
BEGIN
  EXECUTE format(
    'REVOKE TEMP ON DATABASE %I FROM PUBLIC',
    current_database()
  );
END
$tab10_database_acl$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS drizzle AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;

DO $tab10_role$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'tab10_runtime'
  ) THEN
    IF current_setting('tab10.disposable_test', true) = '1' THEN
      RAISE EXCEPTION
        'Disposable local role policy refuses a pre-existing tab10_runtime role';
    END IF;
  ELSE
    CREATE ROLE tab10_runtime LOGIN;
  END IF;
END
$tab10_role$;

ALTER ROLE tab10_runtime
  LOGIN
  PASSWORD 'local'
  NOINHERIT
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

DO $tab10_runtime_database_acl$
BEGIN
  EXECUTE format(
    'REVOKE ALL ON DATABASE %I FROM tab10_runtime',
    current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO tab10_runtime',
    current_database()
  );
END
$tab10_runtime_database_acl$;
REVOKE ALL ON SCHEMA public, drizzle FROM tab10_runtime;
GRANT USAGE ON SCHEMA public TO tab10_runtime;
GRANT USAGE ON SCHEMA drizzle TO tab10_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM tab10_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tab10_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM tab10_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tab10_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM tab10_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle
  REVOKE ALL ON TABLES FROM tab10_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle
  GRANT SELECT ON TABLES TO tab10_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle
  REVOKE EXECUTE ON FUNCTIONS FROM tab10_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
