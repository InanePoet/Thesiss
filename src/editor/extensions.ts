import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import type { RoleKey } from '../lib/types';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    role: { setRole: (role: RoleKey | null) => ReturnType };
    footnote: { insertFootnote: (attrs: { text?: string; sourceId?: string | null; locator?: string; citation?: string }) => ReturnType };
    cite: { insertCite: (attrs: { sourceId: string; locator?: string; label: string }) => ReturnType };
  }
}

/** Ruolo argomentativo come attributo di paragrafi e titoli */
export const Role = Extension.create({
  name: 'role',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          role: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-role') || null,
            renderHTML: (a) => (a.role ? { 'data-role': a.role } : {}),
          },
          suggested: {
            default: false,
            parseHTML: (el) => el.getAttribute('data-suggested') === '1',
            renderHTML: (a) => (a.suggested ? { 'data-suggested': '1' } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setRole:
        (role) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { role, suggested: false }),
    };
  },
});

/** Nota a piè di pagina: nodo inline atomico. Il numero è calcolato con un contatore CSS. */
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: { default: '', parseHTML: (el) => el.getAttribute('data-text') || '' },
      sourceId: { default: null, parseHTML: (el) => el.getAttribute('data-source') || null },
      locator: { default: '', parseHTML: (el) => el.getAttribute('data-locator') || '' },
      citation: { default: '', parseHTML: (el) => el.getAttribute('data-citation') || '' },
    };
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }, { tag: 'span[data-footnote]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        'data-footnote': '',
        class: 'fn',
        'data-text': node.attrs.text,
        'data-source': node.attrs.sourceId || undefined,
        'data-locator': node.attrs.locator || undefined,
        'data-citation': node.attrs.citation || undefined,
      }),
    ];
  },
  renderText() {
    return '';
  },
  addCommands() {
    return {
      insertFootnote:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: 'footnote', attrs }),
    };
  },
});

/** Citazione nel testo (stile autore-data) */
export const Cite = Node.create({
  name: 'cite',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      sourceId: { default: null, parseHTML: (el) => el.getAttribute('data-source') },
      locator: { default: '', parseHTML: (el) => el.getAttribute('data-locator') || '' },
      label: { default: '', parseHTML: (el) => el.textContent || '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-cite]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-cite': '', class: 'cite', 'data-source': node.attrs.sourceId, 'data-locator': node.attrs.locator || undefined }), node.attrs.label];
  },
  renderText({ node }) {
    return node.attrs.label;
  },
  addCommands() {
    return {
      insertCite:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: 'cite', attrs }),
    };
  },
});

/* ---------- Collegamenti automatici ai concetti ---------- */

export interface ConceptTerm { id: string; term: string }
let terms: ConceptTerm[] = [];
let termRe: RegExp | null = null;
let termMap = new Map<string, string>();
export const conceptKey = new PluginKey('concepts');

export function setConceptTerms(list: ConceptTerm[]) {
  terms = list.filter((t) => t.term.trim().length >= 3).sort((a, b) => b.term.length - a.term.length);
  termMap = new Map(terms.map((t) => [t.term.toLowerCase(), t.id]));
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  termRe = terms.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map((t) => esc(t.term)).join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null;
}

function conceptDecos(doc: PMNode): DecorationSet {
  if (!termRe) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    termRe!.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = termRe!.exec(node.text))) {
      const id = termMap.get(m[1].toLowerCase());
      if (id) decos.push(Decoration.inline(pos + m.index, pos + m.index + m[1].length, { class: 'concept-link', 'data-concept': id }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const ConceptLinks = Extension.create({
  name: 'conceptLinks',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: conceptKey,
        state: {
          init: (_, s) => conceptDecos(s.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(conceptKey) ? conceptDecos(tr.doc) : old),
        },
        props: { decorations: (s) => conceptKey.getState(s) },
      }),
    ];
  },
});

export function buildExtensions(placeholder = 'Inizia a scrivere…') {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      code: false,
      codeBlock: false,
      link: { openOnClick: false, autolink: true },
    }),
    Placeholder.configure({ placeholder }),
    Role,
    Footnote,
    Cite,
    ConceptLinks,
  ];
}
