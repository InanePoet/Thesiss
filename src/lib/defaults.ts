import type { Chapter, Requirements, ResearchDesign, RoleDef, Settings } from './types';
import { uid } from './util';

export const DEFAULT_ROLES: RoleDef[] = [
  { key: 'context', label: 'Contesto', hint: 'Premessa, quadro storico o teorico, definizioni', color: '#2E8B83', min: 0.1, max: 0.3 },
  { key: 'problem', label: 'Problema', hint: 'Domanda, tensione, lacuna da affrontare', color: '#C2841A', min: 0.05, max: 0.15 },
  { key: 'argument', label: 'Argomentazione', hint: 'Analisi, prove, fonti, confronto', color: '#4B5FC1', min: 0.4, max: 0.7 },
  { key: 'conclusion', label: 'Conclusione', hint: 'Risposta, sintesi, implicazioni', color: '#9A4A8C', min: 0.05, max: 0.2 },
];

export const ACCENTS = [
  { name: 'Indaco', value: '#2B4C7E' },
  { name: 'Pino', value: '#2F6B4F' },
  { name: 'Prugna', value: '#7A3E6E' },
  { name: 'Ardesia', value: '#3D5566' },
  { name: 'Ocra', value: '#8A5F0F' },
  { name: 'Inchiostro', value: '#26303D' },
];

export const PROVIDERS = [
  { key: 'openalex', label: 'OpenAlex', note: 'Il più ampio, multidisciplinare' },
  { key: 'crossref', label: 'Crossref', note: 'Metadati DOI degli editori' },
  { key: 'jstage', label: 'J-STAGE', note: 'Riviste giapponesi' },
  { key: 'cinii', label: 'CiNii Research', note: 'Articoli, libri e tesi giapponesi' },
  { key: 's2', label: 'Semantic Scholar', note: 'Limitato senza chiave' },
];

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  accent: ACCENTS[0].value,
  editorFont: 'serif',
  editorSize: 18,
  editorLeading: 1.7,
  showRoles: true,
  roles: DEFAULT_ROLES,
  dailyGoal: 3000,
  mailto: '',
  libraryProxy: '',
  catalogUrl: '',
  s2Key: '',
  providers: ['openalex', 'crossref', 'jstage', 'cinii'],
  density: 'comfortable',
  stage: 0,
};

export const DEFAULT_REQUIREMENTS: Requirements = {
  name: 'Tesi magistrale',
  minPages: 100,
  maxPages: 0,
  minChars: 0,
  maxChars: 0,
  charsPerPage: 1800,
  countSpaces: true,
  countFootnotes: true,
  countFront: false,
  font: 'Times New Roman',
  fontSize: 12,
  noteFontSize: 10,
  lineSpacing: 1.5,
  marginCm: 2.5,
  citationStyle: 'chicago-note',
  minSources: 40,
  abstractMaxChars: 2500,
  requireAbstract: true,
  requireIntro: true,
  requireConclusion: true,
  requireBibliography: true,
  minChapters: 3,
  firstPerson: 'avoid',
  maxSentenceWords: 45,
  deadline: '',
  notes: '',
};

export const DEFAULT_DESIGN: ResearchDesign = {
  topic: '',
  context: '',
  problem: '',
  gap: '',
  questionType: 'explanatory',
  mainQuestion: '',
  subQuestions: [''],
  hypotheses: [''],
  method: '',
  sources: '',
  scopeTime: '',
  scopePlace: '',
  limits: '',
  relevance: '',
  keywords: [],
  updatedAt: 0,
};

const empty = { type: 'doc', content: [{ type: 'paragraph' }] };

export function chapter(title: string, kind: Chapter['kind'], order: number, purpose = ''): Chapter {
  return { id: uid(), title, kind, order, content: empty, targetChars: 0, purpose, updatedAt: Date.now() };
}

export function starterChapters(): Chapter[] {
  return [
    chapter('Abstract', 'abstract', 0, 'Sintesi di domanda, metodo, risultati'),
    chapter('Introduzione', 'intro', 1, 'Contesto, domanda di ricerca, metodo, struttura della tesi'),
    chapter('Capitolo 1', 'chapter', 2, 'Quadro teorico e stato dell’arte'),
    chapter('Capitolo 2', 'chapter', 3, ''),
    chapter('Capitolo 3', 'chapter', 4, ''),
    chapter('Conclusioni', 'conclusion', 5, 'Risposta alla domanda, limiti, prospettive'),
  ];
}

export const KIND_LABEL: Record<Chapter['kind'], string> = {
  front: 'Frontespizio',
  abstract: 'Abstract',
  intro: 'Introduzione',
  chapter: 'Capitolo',
  conclusion: 'Conclusioni',
  bibliography: 'Bibliografia',
  appendix: 'Appendice',
};
