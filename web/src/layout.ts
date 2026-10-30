// From a compiled describe shape to a page layout: title, header badges, the widgets at
// the top of the Overview tab, and the groups of each tab. Pure, so it is unit tested.
import type { Aggregate, ClassPage, GroupDef, RowDef, RowEntry } from './api.ts';
import { fillTemplate, termText, withUnit } from './format.ts';
import { DASH, simplePredicate } from './rdf.ts';
import { aggregateText } from './widgets/basic.ts';

export const LABEL_ROLE = DASH + 'LabelRole';
export const KEY_INFO_ROLE = DASH + 'KeyInfoRole';
/** Viewers that take the top of the Overview tab when their row has no group. */
const HERO = new Set(['RouteDiagramViewer', 'MapViewer'].map((v) => 'https://rinf-describe.matdata.eu/ns#' + v));
export const OTHER_GROUP: GroupDef = { iri: '', label: 'Other', order: 10_000, tab: 'overview' };

export interface LaidGroup { group: GroupDef; rows: RowDef[] }
export interface LaidTab { key: string; label: string; groups: LaidGroup[] }
export interface Layout { titleRow: RowDef | null; badges: RowDef[]; hero: RowDef[]; tabs: LaidTab[] }

export const tabKey = (tab: string) => tab.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'overview';
export const tabLabel = (tab: string) => (tab === 'overview' ? 'Overview' : tab[0].toUpperCase() + tab.slice(1));

export function layout(page: ClassPage): Layout {
  const groups = new Map(page.groups.map((g) => [g.iri, g]));
  const rows = [...page.rows].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  const titleRow = rows.find((r) => r.roles.includes(LABEL_ROLE)) ?? null;
  const badges = rows.filter((r) => r.roles.includes(KEY_INFO_ROLE));
  const hero: RowDef[] = [];
  const byGroup = new Map<string, LaidGroup>();
  for (const r of rows) {
    if (r === titleRow) continue;
    let g = r.group ? groups.get(r.group) : undefined;
    if (!g) {
      if (r.viewer && HERO.has(r.viewer)) { hero.push(r); continue; }
      if (r.roles.includes(KEY_INFO_ROLE)) continue; // a badge only
      g = OTHER_GROUP;
    }
    if (!byGroup.has(g.iri)) byGroup.set(g.iri, { group: g, rows: [] });
    byGroup.get(g.iri)!.rows.push(r);
  }
  const tabs = new Map<string, LaidTab>();
  tabs.set('overview', { key: 'overview', label: 'Overview', groups: [] });
  for (const lg of [...byGroup.values()].sort((a, b) => a.group.order - b.group.order || a.group.label.localeCompare(b.group.label))) {
    const key = tabKey(lg.group.tab || 'overview');
    if (!tabs.has(key)) tabs.set(key, { key, label: tabLabel(lg.group.tab), groups: [] });
    tabs.get(key)!.groups.push(lg);
  }
  return { titleRow, badges, hero, tabs: [...tabs.values()] };
}

/** "Not applicable" / "Not yet available" for an empty row whose property the resource marks so. */
export function statusOf(row: RowDef, page: ClassPage): 'notApplicable' | 'notYetAvailable' | null {
  const p = simplePredicate(row.path);
  if (!p) return null;
  const ds = page.doc.dataStatus ?? {};
  if (ds.notApplicable?.includes(p)) return 'notApplicable';
  if (ds.notYetAvailable?.includes(p)) return 'notYetAvailable';
  return null;
}

export function isEmpty(e: RowEntry | undefined): boolean {
  if (!e) return true;
  const params = Object.values(e.params ?? {}).some((v) => v.length);
  const agg = e.aggregate && (e.aggregate.count !== undefined || e.aggregate.min !== undefined || (e.aggregate.values?.length ?? 0) > 0);
  return !(e.values?.length || e.items?.length || agg || params);
}

function aggFields(a: Aggregate): Record<string, number | undefined> {
  const withValue = a.withValue ?? (a.children !== undefined && a.withoutValue !== undefined ? a.children - a.withoutValue : undefined);
  return { min: a.min, max: a.max, count: a.count, children: a.children, withValue };
}

/** Text of a header badge: rd:badge filled in, else the row's name and its value. */
export function badgeText(row: RowDef, entry: RowEntry | undefined, labels: Record<string, string>): string | null {
  if (!entry || isEmpty(entry)) return null;
  const values = entry.values?.map((v) => termText(v, labels)).join(' · ');
  const summary = entry.aggregate ? aggregateText(entry.aggregate, labels, row.unit) : null;
  const value = summary ?? (values ? withUnit(values, row.unit) : null);
  const tpl = row.settings?.badge;
  if (tpl) {
    return fillTemplate(tpl, { value: values ?? summary, unit: row.unit, ...(entry.aggregate ? aggFields(entry.aggregate) : {}) });
  }
  if (!value) return null;
  return row.name ? `${row.name} ${value}` : value;
}
