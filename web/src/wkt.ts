// Well-known text to GeoJSON geometries (the kinds RINF uses), lon/lat order as stored.
import type { Geometry, Position } from 'geojson';

function coords(text: string): Position[] {
  return text.split(',').map((pair) => pair.trim().split(/\s+/).slice(0, 2).map(Number)).filter((c) => c.length === 2 && c.every(Number.isFinite));
}

/** Split "(a), (b)" at the top level of parentheses. */
function parts(text: string): string[] {
  const out: string[] = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') { if (depth++ === 0) start = i + 1; }
    else if (c === ')') { if (--depth === 0 && start >= 0) { out.push(text.slice(start, i)); start = -1; } }
  }
  return out;
}

export function parseWkt(wkt: string): Geometry | null {
  // An optional CRS IRI prefix (GeoSPARQL): "<http://www.opengis.net/def/crs/OGC/1.3/CRS84> POINT (...)".
  const text = wkt.trim().replace(/^<[^>]*>\s*/, '');
  const m = /^([A-Za-z]+)\s*(?:Z|M|ZM)?\s*(\(.*\))\s*$/s.exec(text);
  if (!m) return null;
  const kind = m[1].toUpperCase();
  const body = m[2].slice(1, -1);
  switch (kind) {
    case 'POINT': { const c = coords(body); return c.length ? { type: 'Point', coordinates: c[0] } : null; }
    case 'LINESTRING': return { type: 'LineString', coordinates: coords(body) };
    case 'POLYGON': return { type: 'Polygon', coordinates: parts(body).map(coords) };
    case 'MULTIPOINT': return { type: 'MultiPoint', coordinates: body.includes('(') ? parts(body).map((p) => coords(p)[0]).filter(Boolean) : coords(body) };
    case 'MULTILINESTRING': return { type: 'MultiLineString', coordinates: parts(body).map(coords) };
    case 'MULTIPOLYGON': return { type: 'MultiPolygon', coordinates: parts(body).map((p) => parts(p).map(coords)) };
    default: return null;
  }
}

/** [west, south, east, north] of some geometries. */
export function bounds(geoms: Geometry[]): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const [x, y] = c as number[];
      w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    } else if (Array.isArray(c)) c.forEach(visit);
  };
  for (const g of geoms) if ('coordinates' in g) visit(g.coordinates);
  return Number.isFinite(w) ? [w, s, e, n] : null;
}
