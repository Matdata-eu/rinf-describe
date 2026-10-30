// rd:MapViewer: the resource's geometry on OpenStreetMap with the OpenRailwayMap overlay,
// its context (rd:context: the section of a track, the end points of a section) drawn
// quieter, and the WKT below. rd:layers names table rows of the page whose resources have a
// "wkt" column (the sections of line and tracks of an operational point): each becomes a
// layer that can be switched off, and a click on one of its lines opens that resource.
// MapLibre is loaded only when a page has a map.
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { FilterSpecification, LayerSpecification } from 'maplibre-gl';
import type { Item, RowDef, Term } from '../api.ts';
import { onDispose } from '../cleanup.ts';
import { h } from '../dom.ts';
import { describeHref, navigate } from '../nav.ts';
import { iriLabel } from '../rdf.ts';
import { isDark, offThemeChange, onThemeChange } from '../theme.ts';
import { bounds, parseWkt } from '../wkt.ts';
import type { Widget } from './types.ts';

const wktOf = (terms: Term[] | undefined) => (terms ?? []).map((t) => t.value).filter((v): v is string => !!v);

interface Layer { key: string; name: string }

function collection(wkts: string[], role: 'main' | 'context'): Feature[] {
  return wkts.map((w) => parseWkt(w)).filter((g): g is Geometry => !!g)
    .map((geometry) => ({ type: 'Feature', geometry, properties: { role } }));
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function layerFeatures(key: string, items: Item[], env: string, labels: Record<string, string>): Feature[] {
  return items.flatMap((it) => wktOf(it.cells.wkt).map(parseWkt).filter((g): g is Geometry => !!g)
    .map((geometry) => ({ type: 'Feature' as const, geometry,
      properties: { role: 'layer', layer: key, name: iriLabel(it.iri, labels), href: describeHref(it.iri, env) } })));
}

export const MapViewer: Widget = {
  wide: true,
  render: ({ entry, row, page, env, labels }) => {
    const main = wktOf(entry.values ?? entry.aggregate?.values);
    const context = wktOf(entry.params?.context);
    const layers: Layer[] = [];
    const extra: Feature[] = [];
    for (const key of (row.settings.layers ?? '').split(/\s+/).filter(Boolean)) {
      const f = layerFeatures(key, page.doc.rows[key]?.items ?? [], env, labels);
      if (!f.length) continue;
      const def: RowDef | undefined = page.rows.find((r) => r.key === key);
      layers.push({ key, name: def?.name ?? key });
      extra.push(...f);
    }
    const features = [...collection(context, 'context'), ...extra, ...collection(main, 'main')];
    if (!features.length) return null;
    // Without a geometry of its own, the context is what the map is about.
    if (!main.length) for (const f of features) f.properties = { role: 'main' };
    const box = h('div', { class: 'map', role: 'region', 'aria-label': 'Map' });
    const shown = main.length ? main : context;
    const wkt = h('details', { class: 'wkt' },
      h('summary', null, `Geometry (WKT${shown.length > 1 ? `, ${shown.length}` : ''})`),
      shown.map((w) => h('pre', { class: 'mono' }, w)));
    const toggles = new Map<string, HTMLInputElement>();
    const legend = layers.length ? h('div', { class: 'map-layers small', role: 'group', 'aria-label': 'Map layers' },
      layers.map((l, i) => {
        const box = h('input', { type: 'checkbox', checked: true });
        toggles.set(l.key, box);
        return h('label', null, box, h('span', { class: `swatch layer-${i % 4}`, 'aria-hidden': 'true' }), l.name);
      }), h('span', { class: 'muted' }, 'Click a line or dot to open it.')) : null;
    mount(box, { type: 'FeatureCollection', features }, layers, toggles);
    return h('div', { class: 'map-widget' }, box, legend, wkt);
  },
};

const LAYER_COLORS = ['--layer-0', '--layer-1', '--layer-2', '--layer-3'];

function layerSpecs(layers: Layer[], quiet: string): LayerSpecification[] {
  return layers.flatMap((l, i): LayerSpecification[] => {
    const color = css(LAYER_COLORS[i % 4]) || quiet;
    const lines: FilterSpecification = ['all', ['==', ['get', 'layer'], l.key], ['!=', ['geometry-type'], 'Point']];
    const points: FilterSpecification = ['all', ['==', ['get', 'layer'], l.key], ['==', ['geometry-type'], 'Point']];
    return [
      { id: `layer-${l.key}`, type: 'line', source: 'geom', filter: lines, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.9 } },
      { id: `layer-${l.key}-dots`, type: 'circle', source: 'geom', filter: points,
        paint: { 'circle-radius': 5, 'circle-color': color, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } },
      // Wide invisible lines and dots under the pointer, so a thin line is easy to hit.
      { id: `layer-${l.key}-hit`, type: 'line', source: 'geom', filter: lines, paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 } },
      { id: `layer-${l.key}-hit-dots`, type: 'circle', source: 'geom', filter: points, paint: { 'circle-radius': 12, 'circle-opacity': 0 } },
    ];
  });
}

function mount(container: HTMLElement, data: FeatureCollection, layers: Layer[] = [], toggles = new Map<string, HTMLInputElement>()) {
  let disposed = false;
  let destroy = () => {};
  onDispose(() => { disposed = true; destroy(); });
  Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([maplibregl, worker]) => {
    if (disposed) return;
    maplibregl.setWorkerUrl(worker.default);
    const basemap = () => (isDark()
      ? { 'raster-brightness-max': 0.72, 'raster-saturation': -0.5, 'raster-contrast': 0.1 }
      : { 'raster-saturation': -0.35 });
    const accent = css('--accent-strong') || '#1f4e79';
    const signal = css('--signal') || '#f5b700';
    const quiet = css('--line-strong') || '#808893';
    const focus = data.features.filter((f) => f.properties?.role !== 'layer');
    const onlyPoints = focus.every((f) => f.geometry.type === 'Point');
    const zoom = onlyPoints ? 14 : 15;
    const box = (bounds(focus.map((f) => f.geometry)) ?? [5, 49, 7, 51]) as [number, number, number, number];
    const map = new maplibregl.Map({
      container,
      attributionControl: { compact: true },
      cooperativeGestures: true,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster', tileSize: 256, maxzoom: 19,
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
          orm: {
            type: 'raster', tileSize: 256, maxzoom: 19,
            tiles: ['a', 'b', 'c'].map((x) => `https://${x}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png`),
            attribution: 'Rail overlay: &copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> (CC-BY-SA 2.0)',
          },
          geom: { type: 'geojson', data },
        },
        layers: [
          { id: 'osm', type: 'raster', source: 'osm', paint: basemap() },
          { id: 'orm', type: 'raster', source: 'orm', paint: { 'raster-opacity': 0.75 } },
          { id: 'context-line', type: 'line', source: 'geom',
            filter: ['all', ['==', ['get', 'role'], 'context'], ['!=', ['geometry-type'], 'Point']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': quiet, 'line-width': 5, 'line-opacity': 0.8 } },
          ...layerSpecs(layers, quiet),
          { id: 'main-halo', type: 'line', source: 'geom',
            filter: ['all', ['==', ['get', 'role'], 'main'], ['!=', ['geometry-type'], 'Point']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': signal, 'line-width': 9, 'line-opacity': 0.9 } },
          { id: 'main-line', type: 'line', source: 'geom',
            filter: ['all', ['==', ['get', 'role'], 'main'], ['!=', ['geometry-type'], 'Point']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': accent, 'line-width': 4 } },
          { id: 'points', type: 'circle', source: 'geom', filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'role'], 'layer']],
            paint: { 'circle-radius': ['case', ['==', ['get', 'role'], 'main'], 7, 6], 'circle-color': '#ffffff',
                     'circle-stroke-color': accent, 'circle-stroke-width': 3 } },
        ],
      },
      bounds: box,
      fitBoundsOptions: { padding: 40, maxZoom: zoom },
    });
    // The container may get its final size only after the page is laid out.
    map.once('load', () => { map.resize(); map.fitBounds(box, { padding: 40, maxZoom: zoom, animate: false }); });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    if (layers.length) {
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'map-tip' });
      for (const l of layers) {
        const ids = [`layer-${l.key}`, `layer-${l.key}-dots`, `layer-${l.key}-hit`, `layer-${l.key}-hit-dots`];
        for (const hit of ids.slice(2)) {
          map.on('mousemove', hit, (e) => {
            map.getCanvas().style.cursor = 'pointer';
            const name = e.features?.[0]?.properties?.name;
            if (name) popup.setLngLat(e.lngLat).setText(String(name)).addTo(map);
          });
          map.on('mouseleave', hit, () => { map.getCanvas().style.cursor = ''; popup.remove(); });
          map.on('click', hit, (e) => { const href = e.features?.[0]?.properties?.href; if (href) navigate(String(href)); });
        }
        toggles.get(l.key)?.addEventListener('change', (ev) => {
          const v = (ev.target as HTMLInputElement).checked ? 'visible' : 'none';
          for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
        });
      }
    }
    const recolor = () => {
      for (const [k, v] of Object.entries(basemap())) map.setPaintProperty('osm', k as 'raster-saturation', v);
      if (!isDark()) for (const k of ['raster-brightness-max', 'raster-contrast'] as const) map.setPaintProperty('osm', k, undefined);
    };
    onThemeChange(recolor);
    destroy = () => { offThemeChange(recolor); map.remove(); };
  }).catch((e) => { container.textContent = `The map could not be loaded: ${e}`; });
}
