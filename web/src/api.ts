// HTTP API client and the shapes of its answers (api/app/main.py).

/** An RDF term on a page: an IRI, or a literal. */
export interface Term { iri?: string; value?: string; datatype?: string; lang?: string }
/** A value counted over linked resources (rd:aggregate "distinct-count"). */
export type CountedTerm = Term & { count: number };

export interface Aggregate {
  // count
  count?: number;
  // range
  min?: number; max?: number; withValue?: number;
  // sum (of the first value of each child)
  sum?: number;
  // distinct-count
  values?: CountedTerm[]; withoutValue?: number;
  children?: number;
}

export interface Item {
  iri: string;
  cells: Record<string, Term[]>;
  /** Columns with rd:over: summed up over the children of the linked resource. */
  aggregates?: Record<string, Aggregate>;
}

/** A RINF parameter of the resource (rd:ParameterIndexViewer): the property, its values, and
 * when it sits on a linked resource (its contact line system...), the link and that resource. */
export interface Parameter { p: string; values: Term[]; via?: string; of?: string }

/** What the ontology says about a property. */
export interface TermInfo { label?: string; comment?: string; index?: string[]; unit?: string | null }

/** One evaluated row of a page (describe_doc.doc.rows[key]). */
export interface RowEntry {
  values?: Term[];
  aggregate?: Aggregate;
  items?: Item[];
  params?: Record<string, Term[]>;
  parameters?: Parameter[];
  /** All linked resources of a table with rd:limit, of which `items` holds the first. */
  total?: number;
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
  deactivated?: boolean;
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
  source: 'live' | 'missing';
  title: string | null;
  classes: string[];
  graph: string | null;
  dataset: { graph: string; provider?: string | null; title?: string | null; country?: string | null; modified?: string | null } | null;
  pages: ClassPage[];
  counts: { out: number; in: number };
  labels: Record<string, string>;
  /** The ontology's label, definition, unit and RINF index of each property on the page. */
  terms?: Record<string, TermInfo>;
  /** RINF index -> chapter name. */
  chapters?: Record<string, string>;
  /** Milliseconds spent building the page, per round of queries. */
  timing?: Record<string, number>;
}

export interface Triple { s: string; p: string; o: string; o_iri: boolean; datatype: string | null; lang: string | null }

export interface TriplesResponse {
  iri: string; dir: 'out' | 'in'; triples: Triple[]; labels: Record<string, string>; truncated: boolean;
}

export interface GraphResponse { iri: string; out: Triple[]; in: Triple[]; types: Record<string, string[]>; labels: Record<string, string> }

/** A property of a class in ERA's SHACL shapes: an attribute (type, maybe a code list) or an
 * association (class); incoming ones name the class they come from (source). */
export interface ModelMember {
  p: string; min: number; max: number | null; label?: string; comment?: string; index?: string[];
  type?: string; scheme?: string; class?: string; source?: string;
}
export interface ModelBox {
  iri: string; label?: string; comment?: string; depth: number; parents: string[];
  attributes: ModelMember[]; associations: ModelMember[];
}
export interface ModelResponse {
  iri: string; env: string;
  model: { focus: string; boxes: ModelBox[]; incoming: ModelMember[]; classes: Record<string, { iri: string; label?: string; comment?: string }> } | null;
  /** How often the resource uses each property, as subject (out) and object (in), and the
   * properties given on a common characteristics subset it belongs to (via). */
  used: { out: Record<string, number>; in: Record<string, number>; via?: Record<string, number> };
}

export interface EnvInfo { key: string; label: string }
export interface Config { envs: EnvInfo[]; atlasUrl: string | null }
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
  model: (uri: string, env: string) => get<ModelResponse>('model', { uri, env }),
  search: (q: string, env: string, signal?: AbortSignal) => get<{ results: SearchHit[] }>('search', { q, env }, signal),
  rows: (uri: string, env: string, key: string, offset: number) =>
    get<{ key: string; offset: number; items: Item[]; total: number; labels: Record<string, string> }>('rows', { uri, env, key, offset }),
  examples: (env: string) => get<{ results: Example[] }>('examples', { env }),
  exportUrl: (uri: string, env: string, format: 'ttl' | 'nt' | 'csv') =>
    `/api/export?${new URLSearchParams({ uri, env, format })}`,
};
