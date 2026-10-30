-- Run with the database owner AFTER migrations. Provision cv_runtime with a random password
-- through a secure provider/admin session; no password in this file or shell arguments.
-- Database CONNECT privilege is granted separately on the chosen database.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cv_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cv_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO cv_runtime;
REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM cv_runtime;
-- Execute as the SAME migration owner for future tables/sequences.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO cv_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO cv_runtime;
