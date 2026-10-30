-- Read-only role for RINF Describe in RINF Atlas's database (psql -v pw=<password>).
-- Idempotent: run on every start by the db-role service of docker-compose.yml.
SELECT format('CREATE ROLE describe_ro LOGIN PASSWORD %L', :'pw')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'describe_ro') \gexec
SELECT format('ALTER ROLE describe_ro LOGIN PASSWORD %L', :'pw') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO describe_ro', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO describe_ro;
-- Only what the API reads; tables Atlas has not created yet are granted on the next start.
SELECT format('GRANT SELECT ON %I TO describe_ro', t)
  FROM unnest(ARRAY['describe_doc', 'describe_def', 'describe_triple', 'term', 'feature', 'dataset', 'index_state']) AS t
 WHERE to_regclass(t) IS NOT NULL \gexec
