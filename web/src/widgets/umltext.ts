// The data model's diagrams as text: PlantUML and Mermaid class diagrams of what the
// Data model tab draws (the class view or the page view), to paste into other tools.
import type { ModelMember, ModelResponse } from '../api.ts';
import { localName } from '../rdf.ts';

export interface UmlClass { id: string; name: string; stereotype?: string; members: string[] }
export interface UmlLink { from: string; to: string; kind: 'gen' | 'assoc'; label?: string; mult?: string }
export interface Uml { title: string; classes: UmlClass[]; links: UmlLink[] }

interface PageMember extends ModelMember { missing?: boolean }
interface PageNode { iri: string; members: PageMember[]; untyped?: boolean }
interface PageEdge extends ModelMember { from: string; to: string; missing?: boolean }

/** UML multiplicity without brackets: 1, 0..1, 0..*, 1..*. */
export const mult = (m: { min: number; max: number | null }) => {
  const hi = m.max === null ? '*' : String(m.max);
  return m.min === m.max ? hi : `${m.min}..${hi}`;
};
const typeOf = (m: ModelMember) => (m.scheme ? localName(m.scheme) : m.class ? localName(m.class) : m.type ? localName(m.type) : 'IRI');
const member = (m: PageMember) => (m.missing ? `${localName(m.p)} : ?` : `${localName(m.p)} : ${typeOf(m)} [${mult(m)}]`);

/** An identifier both tools accept, unique within the diagram. */
function ids() {
  const taken = new Map<string, string>();
  return (iri: string, name: string) => {
    if (taken.has(iri)) return taken.get(iri)!;
    const base = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'C';
    let id = base;
    for (let i = 2; [...taken.values()].includes(id); i++) id = `${base}_${i}`;
    taken.set(iri, id);
    return id;
  };
}

/** The class view: the class and its superclasses with their attributes (filled and mandatory
 * ones, or all), the classes they point at and the classes pointing at them. */
export function classUml(res: ModelResponse, all: boolean): Uml | null {
  const m = res.model;
  if (!m) return null;
  const id = ids();
  const used = (dir: 'out' | 'in', p: string) => (res.used[dir][p] ?? 0) > 0 || (dir === 'out' && (res.used.via?.[p] ?? 0) > 0);
  const inBoxes = new Set(m.boxes.map((b) => b.iri));
  const classes = new Map<string, UmlClass>();
  const links: UmlLink[] = [];
  const cls = (iri: string) => {
    if (!classes.has(iri)) classes.set(iri, { id: id(iri, localName(iri)), name: localName(iri), members: [] });
    return classes.get(iri)!;
  };
  for (const b of m.boxes) {
    const c = cls(b.iri);
    const attrs = [...b.attributes, ...b.associations.filter((a) => inBoxes.has(a.class!))];
    c.members = attrs.filter((a) => all || used('out', a.p) || a.min > 0).map(member);
  }
  for (const b of m.boxes) {
    for (const p of b.parents) links.push({ from: cls(b.iri).id, to: cls(p).id, kind: 'gen' });
    for (const a of b.associations) {
      if (inBoxes.has(a.class!) || !(all || used('out', a.p) || a.min > 0)) continue;
      links.push({ from: cls(b.iri).id, to: cls(a.class!).id, kind: 'assoc', label: localName(a.p), mult: mult(a) });
    }
  }
  for (const a of m.incoming) {
    if (!(all || used('in', a.p))) continue;
    links.push({ from: cls(a.source!).id, to: cls(a.class!).id, kind: 'assoc', label: localName(a.p), mult: mult(a) });
  }
  return { title: `${localName(m.focus)} in ERA’s model`, classes: [...classes.values()], links };
}

/** The page view: the classes the page's rows pass through, with the properties read on each. */
export function pageUml(res: ModelResponse): Uml | null {
  const pm = res.model?.page;
  if (!pm?.nodes.length) return null;
  const id = ids();
  const name = (n: PageNode) => localName(n.untyped ? n.iri.replace(/^untyped:\^?/, '') : n.iri);
  const classes = (pm.nodes as PageNode[]).map((n) => ({
    id: id(n.iri, name(n)), name: name(n), stereotype: n.untyped ? 'untyped' : undefined, members: n.members.map(member),
  }));
  const links = (pm.edges as PageEdge[]).filter((e) => e.from !== e.to).map((e) => ({
    from: id(e.from, ''), to: id(e.to, ''), kind: 'assoc' as const, label: localName(e.p) + (e.missing ? ' ?' : ''), mult: mult(e),
  }));
  return { title: `What the page of a ${localName(res.model!.focus)} shows`, classes, links };
}

const quote = (t: string) => t.replace(/"/g, "'");

export function plantuml(u: Uml): string {
  const out = ['@startuml', `title ${u.title}`, 'hide empty members', 'skinparam classAttributeIconSize 0', ''];
  for (const c of u.classes) {
    const head = `class ${c.name === c.id ? c.id : `"${quote(c.name)}" as ${c.id}`}${c.stereotype ? ` <<${c.stereotype}>>` : ''}`;
    out.push(c.members.length ? `${head} {\n${c.members.map((m) => `  ${m}`).join('\n')}\n}` : head);
  }
  out.push('');
  for (const l of u.links) {
    out.push(l.kind === 'gen' ? `${l.from} --|> ${l.to}` : `${l.from} --> "${l.mult}" ${l.to} : ${l.label}`);
  }
  out.push('@enduml', '');
  return out.join('\n');
}

export function mermaid(u: Uml): string {
  const out = ['---', `title: ${u.title}`, '---', 'classDiagram'];
  // Braces end a class body and tildes are generics in Mermaid: neither belongs in a member.
  const line = (m: string) => `    ${m.replace(/[{}~]/g, '')}`;
  for (const c of u.classes) {
    const label = c.name !== c.id ? `["${quote(c.name)}"]` : '';
    if (!c.members.length && !c.stereotype) { out.push(`  class ${c.id}${label}`); continue; }
    out.push(`  class ${c.id}${label} {`);
    if (c.stereotype) out.push(`    <<${c.stereotype}>>`);
    out.push(...c.members.map(line), '  }');
  }
  for (const l of u.links) {
    out.push(l.kind === 'gen' ? `  ${l.to} <|-- ${l.from}` : `  ${l.from} --> "${l.mult}" ${l.to} : ${l.label}`);
  }
  return out.join('\n') + '\n';
}
