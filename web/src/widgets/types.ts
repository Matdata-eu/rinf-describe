import type { ClassPage, RowDef, RowEntry } from '../api.ts';

/** What a widget gets to render one row of a page. */
export interface Ctx {
  env: string;
  labels: Record<string, string>;
  row: RowDef;
  entry: RowEntry;
  page: ClassPage;
}

export interface Widget {
  /** The rendered value, or null when there is nothing to show. */
  render(ctx: Ctx): Node | null;
  /** Takes the whole width of its card instead of a label / value line. */
  wide?: boolean;
}
