-- The part of RINF Atlas's schema (rinf-atlas/db/init.sql) that RINF Describe reads,
-- without PostGIS, for local development and CI. A real deployment uses Atlas's database.
CREATE TABLE IF NOT EXISTS dataset (
    env text NOT NULL, graph_iri text NOT NULL, kind text NOT NULL DEFAULT 'provider',
    title text, provider text, country text, modified timestamptz, status text NOT NULL DEFAULT 'loaded',
    PRIMARY KEY (env, graph_iri)
);
CREATE TABLE IF NOT EXISTS feature (
    id bigserial PRIMARY KEY, env text NOT NULL, iri text NOT NULL, class text NOT NULL,
    class_iri text NOT NULL, graph_iri text NOT NULL, label text, UNIQUE (env, iri, class)
);
CREATE TABLE IF NOT EXISTS term (env text NOT NULL, iri text NOT NULL, label text NOT NULL, PRIMARY KEY (env, iri));
CREATE TABLE IF NOT EXISTS index_state (
    env text PRIMARY KEY, shapes_hash text, updated_at timestamptz NOT NULL DEFAULT now(), describe_hash text
);
CREATE TABLE IF NOT EXISTS describe_triple (
    env text NOT NULL, graph_iri text NOT NULL, s text NOT NULL, p text NOT NULL, o text NOT NULL,
    o_iri boolean NOT NULL, datatype text, lang text
);
CREATE INDEX IF NOT EXISTS describe_triple_s_idx ON describe_triple (env, s);
CREATE INDEX IF NOT EXISTS describe_triple_o_idx ON describe_triple (env, o) WHERE o_iri;
CREATE TABLE IF NOT EXISTS describe_doc (
    env text NOT NULL, iri text NOT NULL, shape text NOT NULL, graph_iri text NOT NULL, doc jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS describe_doc_iri_idx ON describe_doc (env, iri);
CREATE TABLE IF NOT EXISTS describe_def (shape text PRIMARY KEY, class_iri text NOT NULL, def jsonb NOT NULL);
