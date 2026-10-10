import type { JSONContent } from '@tiptap/core';

export type RoleKey = 'context' | 'problem' | 'argument' | 'conclusion';

export type ChapterKind = 'front' | 'abstract' | 'intro' | 'chapter' | 'conclusion' | 'bibliography' | 'appendix';

export interface Chapter {
  id: string;
  title: string;
  kind: ChapterKind;
  order: number;
  content: JSONContent;
  /** obiettivo di battute per questo capitolo (0 = nessuno) */
  targetChars: number;
  /** nota di lavoro: cosa deve dimostrare il capitolo */
  purpose: string;
  updatedAt: number;
}

export type SourceStatus = 'toread' | 'reading' | 'read' | 'cited' | 'discarded';

export interface Source {
  id: string;
  type: 'article' | 'book' | 'chapter' | 'thesis' | 'report' | 'web' | 'law' | 'other';
  title: string;
  titleAlt?: string;
  authors: string[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  place?: string;
  doi?: string;
  url?: string;
  oaUrl?: string;
  abstract?: string;
  keywords: string[];
  lang?: string;
  provider: string;
  providerId?: string;
  status: SourceStatus;
  tags: string[];
  notes: string;
  hasFullText?: boolean;
  citedBy?: number;
  addedAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  title: string;
  aliases: string[];
  body: string;
  tags: string[];
  sourceIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SavedSearch {
  id: string;
  query: string;
  providers: string[];
  yearFrom?: number;
  lastRun?: number;
  seen: string[];
  newCount: number;
  createdAt: number;
}

export interface Snapshot {
  id: string;
  ts: number;
  reason: string;
  chars: number;
  data: string;
}

export interface FullText {
  sourceId: string;
  text: string;
  pages: number;
}

export interface DayStat {
  date: string;
  chars: number;
  /** battute totali a fine giornata */
  total: number;
}

export interface RoleDef {
  key: RoleKey;
  label: string;
  hint: string;
  color: string;
  /** quota indicativa minima e massima sul capitolo (0-1) */
  min: number;
  max: number;
}

export interface Requirements {
  name: string;
  minPages: number;
  maxPages: number;
  minChars: number;
  maxChars: number;
  charsPerPage: number;
  countSpaces: boolean;
  countFootnotes: boolean;
  countFront: boolean;
  font: string;
  fontSize: number;
  noteFontSize: number;
  lineSpacing: number;
  marginCm: number;
  citationStyle: 'chicago-note' | 'apa' | 'author-date-it';
  minSources: number;
  abstractMaxChars: number;
  requireAbstract: boolean;
  requireIntro: boolean;
  requireConclusion: boolean;
  requireBibliography: boolean;
  minChapters: number;
  firstPerson: 'allowed' | 'avoid';
  maxSentenceWords: number;
  deadline?: string;
  notes: string;
}

export interface ResearchDesign {
  topic: string;
  context: string;
  problem: string;
  gap: string;
  questionType: 'descriptive' | 'explanatory' | 'comparative' | 'evaluative' | 'exploratory';
  mainQuestion: string;
  subQuestions: string[];
  hypotheses: string[];
  method: string;
  sources: string;
  scopeTime: string;
  scopePlace: string;
  limits: string;
  relevance: string;
  keywords: string[];
  updatedAt: number;
}

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  accent: string;
  editorFont: 'serif' | 'sans' | 'mono';
  editorSize: number;
  editorLeading: number;
  showRoles: boolean;
  roles: RoleDef[];
  dailyGoal: number;
  mailto: string;
  libraryProxy: string;
  catalogUrl: string;
  s2Key: string;
  providers: string[];
  density: 'comfortable' | 'compact';
  stage: number;
}

export interface BackupFile {
  app: 'thesiss';
  schema: number;
  exportedAt: number;
  data: {
    chapters: Chapter[];
    sources: Source[];
    notes: Note[];
    searches: SavedSearch[];
    days: DayStat[];
    fulltext?: FullText[];
    kv: Record<string, unknown>;
  };
}
