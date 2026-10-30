// HTTP API client and the shapes of its answers (api/app/main.py).

/** An RDF term as the describe index stores it: an IRI, or a literal. */
export interface Term { iri?: string; value?: string; datatype?: string; lang?: string }
/** A value counted over linked resources (rd:aggregate "distinct-count"). */
export type CountedTerm = Term & { count: number };

export interface Aggregate {
  // count
  count?: number;
  // range
  min?: number; max?: number; withValue?: number;
  // distinct-count
  values?: CountedTerm[]; withoutValue?: number;
  children?: number;
}

export interface Item { iri: string; cells: Record<string, Term[]> }

/** One evaluated row of a page (describe_doc.doc.rows[key]). */
export interface RowEntry {
  values?: Term[];
  aggregate?: Aggregate;
  items?: Item[];
  params?: Record<string, Term[]>;
}

/** One property row of a describe shape, as compiled by the worker (describe_def). */
export interface RowDef {
  key: string;
  name: string | null;
  path: string | null;
  group: string | null;
  order: number;
  viewer: string | null;
  roles: string[];
  over: string | null;
  aggregate: string | null;
  unit: string | null;
  format: string | null;
  params: Record<string, string>;
  settings: Record<string, string>;
  columns: RowDef[];
}

export interface GroupDef { iri: string; label: string; order: number; tab: string }

export interface ClassPage {
  shape: string;
  class: string;
  label: string | null;
  rows: RowDef[];
  groups: GroupDef[];
  doc: { class: string; rows: Record<string, RowEntry>; dataStatus?: { notApplicable?: string[]; notYetAvailable?: string[] } };
}

export interface DescribeResponse {
  iri: string;
  env: string;
  source: 'index' | 'live' | 'missing';
  title: string | null;
  classes: string[];
  graph: string | null;
  dataset: { graph: string; provider?: string | null; title?: string | null; country?: string | null; modified?: string | null } | null;
  pages: ClassPage[];
  counts: { out: number; in: number };
  labels: Record<string, string>;
}

export interface Triple { s: string; p: string; o: string; o_iri: boolean; datatype: string | null; lang: string | null }

export interface TriplesResponse {
  iri: string; dir: 'out' | 'in'; source: 'index' | 'live'; triples: Triple[]; labels: Record<string, string>; truncated: boolean;
}

export interface GraphResponse { iri: string; out: Triple[]; in: Triple[]; types: Record<string, string[]>; labels: Record<string, string> }

export interface EnvInfo { key: string; label: string; indexed: boolean; updatedAt: string | null }
export interface Config { envs: EnvInfo[]; live: boolean; atlasUrl: string | null }
export interface SearchHit { iri: string; label: string | null; class: string | null }
export interface Example { iri: string; label: string | null; class: string; classLabel: string | null }

async function get<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const r = await fetch(`/api/${path}?${qs}`, { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const body = await r.json(); if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  config: () => get<Config>('config', {}),
  describe: (uri: string, env: string) => get<DescribeResponse>('describe', { uri, env }),
  triples: (uri: string, env: string, dir: 'out' | 'in', limit = 1000) => get<TriplesResponse>('triples', { uri, env, dir, limit }),
  graph: (uri: string, env: string) => get<GraphResponse>('graph', { uri, env }),
  search: (q: string, env: string, signal?: AbortSignal) => get<{ results: SearchHit[] }>('search', { q, env }, signal),
  examples: (env: string) => get<{ results: Example[] }>('examples', { env }),
  exportUrl: (uri: string, env: string, format: 'ttl' | 'nt' | 'csv') =>
    `/api/export?${new URLSearchParams({ uri, env, format })}`,
};
