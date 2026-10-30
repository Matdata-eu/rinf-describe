// dash:viewer -> widget. A row without a viewer, or with one this app does not know,
// gets the plain viewer that fits its data (as a generic DASH tool would).
import { DASH, RD } from '../rdf.ts';
import { AggregateViewer, DetailsViewer, LabelViewer, LrsLocationViewer, URIViewer, ValueTableViewer } from './basic.ts';
import { AlongLineViewer } from './alongline.ts';
import { ChangesViewer } from './changes.ts';
import { ConnectionsViewer } from './connections.ts';
import { CrossSectionViewer } from './crosssection.ts';
import { DocumentViewer } from './document.ts';
import { FacilitiesViewer } from './facilities.ts';
import { KeyFiguresViewer } from './keyfigures.ts';
import { LineProfileViewer, LineStopsViewer } from './lineprofile.ts';
import { MapViewer } from './map.ts';
import { ParameterIndexViewer } from './parameters.ts';
import { PlatformViewer } from './platform.ts';
import { RouteDiagramViewer } from './route.ts';
import { ScaleBarViewer } from './scalebar.ts';
import { StepChartViewer } from './stepchart.ts';
import { SymbolViewer } from './symbol.ts';
import { TrackLayoutViewer } from './tracklayout.ts';
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
  [RD + 'ParameterIndexViewer']: ParameterIndexViewer,
  [RD + 'DocumentViewer']: DocumentViewer,
  [RD + 'FacilitiesViewer']: FacilitiesViewer,
  [RD + 'ScaleBarViewer']: ScaleBarViewer,
  [RD + 'ConnectionsViewer']: ConnectionsViewer,
  [RD + 'TrackLayoutViewer']: TrackLayoutViewer,
  [RD + 'PlatformViewer']: PlatformViewer,
  [RD + 'LineProfileViewer']: LineProfileViewer,
  [RD + 'LineStopsViewer']: LineStopsViewer,
  [RD + 'AlongLineViewer']: AlongLineViewer,
  [RD + 'CrossSectionViewer']: CrossSectionViewer,
  [RD + 'KeyFiguresViewer']: KeyFiguresViewer,
  [RD + 'ChangesViewer']: ChangesViewer,
};

export function widgetFor(ctx: Pick<Ctx, 'row' | 'entry'>): Widget {
  const w = ctx.row.viewer ? WIDGETS[ctx.row.viewer] : undefined;
  if (w) return w;
  if (ctx.entry.aggregate) return AggregateViewer;
  if (ctx.entry.items) return ValueTableViewer;
  return LabelViewer;
}

export type { Ctx, Widget };
