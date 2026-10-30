// rd:MapViewer: the resource's geometry on OpenStreetMap with the OpenRailwayMap overlay,
// its context (rd:context: the section of a track, the end points of a section) drawn
// quieter, and the WKT below. MapLibre is loaded only when a page has a map.
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Term } from '../api.ts';
import { onDispose } from '../cleanup.ts';
import { h } from '../dom.ts';
import { isDark, offThemeChange, onThemeChange } from '../theme.ts';
import { bounds, parseWkt } from '../wkt.ts';
import type { Widget } from './types.ts';

const wktOf = (terms: Term[] | undefined) => (terms ?? []).map((t) => t.value).filter((v): v is string => !!v);

function collection(wkts: string[], role: 'main' | 'context'): Feature[] {
  return wkts.map((w) => parseWkt(w)).filter((g): g is Geometry => !!g)
    .map((geometry) => ({ type: 'Feature', geometry, properties: { role } }));
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const MapViewer: Widget = {
  wide: true,
  render: ({ entry }) => {
    const main = wktOf(entry.values ?? entry.aggregate?.values);
    const context = wktOf(entry.params?.context);
    const features = [...collection(context, 'context'), ...collection(main, 'main')];
    if (!features.length) return null;
    // Without a geometry of its own, the context is what the map is about.
    if (!main.length) for (const f of features) f.properties = { role: 'main' };
    const box = h('div', { class: 'map', role: 'region', 'aria-label': 'Map' });
    const shown = main.length ? main : context;
    const wkt = h('details', { class: 'wkt' },
      h('summary', null, `Geometry (WKT${shown.length > 1 ? `, ${shown.length}` : ''})`),
      shown.map((w) => h('pre', { class: 'mono' }, w)));
    mount(box, { type: 'FeatureCollection', features });
    return h('div', { class: 'map-widget' }, box, wkt);
  },
};

function mount(container: HTMLElement, data: FeatureCollection) {
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
    const box = (bounds(data.features.map((f) => f.geometry)) ?? [5, 49, 7, 51]) as [number, number, number, number];
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
          { id: 'main-halo', type: 'line', source: 'geom',
            filter: ['all', ['==', ['get', 'role'], 'main'], ['!=', ['geometry-type'], 'Point']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': signal, 'line-width': 9, 'line-opacity': 0.9 } },
          { id: 'main-line', type: 'line', source: 'geom',
            filter: ['all', ['==', ['get', 'role'], 'main'], ['!=', ['geometry-type'], 'Point']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': accent, 'line-width': 4 } },
          { id: 'points', type: 'circle', source: 'geom', filter: ['==', ['geometry-type'], 'Point'],
            paint: { 'circle-radius': ['case', ['==', ['get', 'role'], 'main'], 7, 6], 'circle-color': '#ffffff',
                     'circle-stroke-color': accent, 'circle-stroke-width': 3 } },
        ],
      },
      bounds: box,
      fitBoundsOptions: { padding: 40, maxZoom: 15 },
    });
    // The container may get its final size only after the page is laid out.
    map.once('load', () => { map.resize(); map.fitBounds(box, { padding: 40, maxZoom: 15, animate: false }); });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const recolor = () => {
      for (const [k, v] of Object.entries(basemap())) map.setPaintProperty('osm', k as 'raster-saturation', v);
      if (!isDark()) for (const k of ['raster-brightness-max', 'raster-contrast'] as const) map.setPaintProperty('osm', k, undefined);
    };
    onThemeChange(recolor);
    destroy = () => { offThemeChange(recolor); map.remove(); };
  }).catch((e) => { container.textContent = `The map could not be loaded: ${e}`; });
}
