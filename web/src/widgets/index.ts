// dash:viewer -> widget. A row without a viewer, or with one this app does not know,
// gets the plain viewer that fits its data (as a generic DASH tool would).
import { DASH, RD } from '../rdf.ts';
import { AggregateViewer, DetailsViewer, LabelViewer, LrsLocationViewer, URIViewer, ValueTableViewer } from './basic.ts';
import { MapViewer } from './map.ts';
import { RouteDiagramViewer } from './route.ts';
import { StepChartViewer } from './stepchart.ts';
import { SymbolViewer } from './symbol.ts';
import type { Ctx, Widget } from './types.ts';
import { ValidityViewer } from './validity.ts';

export const WIDGETS: Record<string, Widget> = {
  [DASH + 'LabelViewer']: LabelViewer,
  [DASH + 'LiteralViewer']: LabelViewer,
  [DASH + 'URIViewer']: URIViewer,
  [DASH + 'ValueTableViewer']: ValueTableViewer,
  [DASH + 'DetailsViewer']: DetailsViewer,
  [RD + 'RouteDiagramViewer']: RouteDiagramViewer,
  [RD + 'MapViewer']: MapViewer,
  [RD + 'AggregateViewer']: AggregateViewer,
  [RD + 'LrsLocationViewer']: LrsLocationViewer,
  [RD + 'StepChartViewer']: StepChartViewer,
  [RD + 'SymbolViewer']: SymbolViewer,
  [RD + 'ValidityViewer']: ValidityViewer,
};

export function widgetFor(ctx: Pick<Ctx, 'row' | 'entry'>): Widget {
  const w = ctx.row.viewer ? WIDGETS[ctx.row.viewer] : undefined;
  if (w) return w;
  if (ctx.entry.aggregate) return AggregateViewer;
  if (ctx.entry.items) return ValueTableViewer;
  return LabelViewer;
}

export type { Ctx, Widget };
