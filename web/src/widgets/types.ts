import type { ClassPage, RowDef, RowEntry, TermInfo } from '../api.ts';

/** What a widget gets to render one row of a page. */
export interface Ctx {
  /** The resource the page describes. */
  iri: string;
  env: string;
  labels: Record<string, string>;
  row: RowDef;
  entry: RowEntry;
  page: ClassPage;
  /** The ontology's word on the properties of the page (labels, definitions, units, RINF index). */
  terms?: Record<string, TermInfo>;
  chapters?: Record<string, string>;
}

export interface Widget {
  /** The rendered value, or null when there is nothing to show. */
  render(ctx: Ctx): Node | null;
  /** Takes the whole width of its card instead of a label / value line. */
  wide?: boolean;
}
