import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronRight, Loader2, Volume2 } from 'lucide-react';
import { supabase, BibleVerse, GitaVerse, QuranAyah } from '../lib/supabase';
import { useSpeech } from '../hooks/useSpeech';
import { bibleBookNames, bibleBookMeta, bibleBookIndex } from '../data/bibleBooks';

type Tradition = 'gita' | 'bible' | 'quran';
type ViewMode = 'single' | 'chapter' | 'search';
type SearchMode = 'keyword' | 'semantic';
type SearchScope = 'selected' | 'all';
type GitaTranslationLanguage = 'en' | 'hi' | 'te';

type BibleBookRow = {
  book: string | null;
};

interface SurahOption {
  surahNo: string;
  surahNameEn: string;
  surahNameRoman: string;
  totalAyahSurah: string;
}

interface SurahMetaRow {
  surah_no: string | null;
  surah_name_en: string | null;
  surah_name_roman: string | null;
  total_ayah_surah: string | null;
}

interface ScriptureVerse {
  id: string;
  tradition: Tradition;
  source: string;
  chapterLabel: string;
  chapterNumber: number;
  verseNumber: number;
  primaryText: string;
  secondaryText?: string;
  translation: string;
  translationEn?: string;
  translationHi?: string;
  translationTe?: string;
  semanticScore?: number;
  matchDetails?: string;
}

const traditionLabels: Record<Tradition, string> = {
  gita: 'Bhagavad Gita',
  bible: 'Bible',
  quran: 'Quran',
};

const gitaLanguageLabels: Record<GitaTranslationLanguage, string> = {
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
};

const semanticStopWords = new Set([
  'the',
  'is',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'for',
  'in',
  'on',
  'with',
  'that',
  'this',
  'it',
  'as',
  'by',
  'from',
  'verse',
  'verses',
  'scripture',
  'scriptures',
]);

const semanticSynonyms: Record<string, string[]> = {
  peace: ['calm', 'harmony', 'tranquil', 'rest'],
  love: ['compassion', 'kindness', 'charity', 'care'],
  faith: ['trust', 'belief', 'devotion', 'reliance'],
  patience: ['endurance', 'steadfast', 'perseverance', 'sabr'],
  prayer: ['worship', 'supplication', 'meditation', 'remembrance'],
  forgiveness: ['mercy', 'pardon', 'grace', 'reconcile'],
  wisdom: ['understanding', 'knowledge', 'insight', 'discernment'],
  justice: ['fairness', 'righteousness', 'equity', 'truth'],
  gratitude: ['thankfulness', 'thankful', 'contentment', 'appreciation'],
};

function toNumber(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeSearchToken(value: string): string {
  return value.replace(/[%_,]/g, '').trim().toLowerCase();
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeSearchQuery(query: string): string[] {
  return normalizeSearchText(query)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !semanticStopWords.has(token));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandSemanticTokens(tokens: string[]): string[] {
  const expanded = new Set<string>();

  for (const token of tokens) {
    expanded.add(token);

    if (semanticSynonyms[token]) {
      for (const synonym of semanticSynonyms[token]) {
        expanded.add(synonym);
      }
    }

    for (const [root, synonyms] of Object.entries(semanticSynonyms)) {
      if (synonyms.includes(token)) {
        expanded.add(root);
        for (const synonym of synonyms) {
          expanded.add(synonym);
        }
      }
    }
  }

  return Array.from(expanded).filter((token) => token.length > 1);
}

function buildSearchClause(fields: string[], terms: string[]): string {
  return terms.flatMap((term) => fields.map((field) => `${field}.ilike.%${term}%`)).join(',');
}

function isMissingColumnError(
  error: { message?: string | null; details?: string | null; hint?: string | null } | null | undefined,
  field: string
): boolean {
  if (!error) {
    return false;
  }

  const combinedText = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  return combinedText.includes('does not exist') && combinedText.includes(field.toLowerCase());
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const message = (error as { message: string }).message.trim();
    if (message) {
      return message;
    }
  }

  return fallback;
}

function rankSemanticVerse(
  verse: ScriptureVerse,
  searchPhrase: string,
  queryTokens: string[],
  expandedTokens: string[]
): ScriptureVerse {
  const normalizedPhrase = normalizeSearchText(searchPhrase);
  const corpus = normalizeSearchText(
    `${verse.source} ${verse.primaryText} ${verse.secondaryText ?? ''} ${verse.translation} ${
      verse.translationEn ?? ''
    } ${verse.translationHi ?? ''} ${verse.translationTe ?? ''}`
  );

  let score = 0;
  const reasons: string[] = [];

  if (normalizedPhrase && corpus.includes(normalizedPhrase)) {
    score += 18;
    reasons.push('exact phrase');
  }

  for (const token of queryTokens) {
    const wordBoundary = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
    if (wordBoundary.test(corpus)) {
      score += 7;
      continue;
    }

    if (corpus.includes(token)) {
      score += 4;
    }
  }

  for (const token of expandedTokens) {
    if (queryTokens.includes(token)) {
      continue;
    }

    const wordBoundary = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
    if (wordBoundary.test(corpus)) {
      score += 2;
    }
  }

  if (queryTokens.some((token) => normalizeSearchText(verse.source).includes(token))) {
    score += 2;
    reasons.push('source context');
  }

  return {
    ...verse,
    semanticScore: score,
    matchDetails: reasons.length > 0 ? reasons.join(', ') : undefined,
  };
}

function mapGitaVerse(verse: GitaVerse): ScriptureVerse {
  const translationEn = verse.translation_en || '';
  const translationHi = verse.translation_hi || '';
  const translationTe = verse.translation_te || '';
  const fallbackTranslation = translationEn || translationHi || translationTe || verse.commentary || '';

  return {
    id: String(verse.id),
    tradition: 'gita',
    source: 'Bhagavad Gita',
    chapterLabel: 'Chapter',
    chapterNumber: verse.chapter,
    verseNumber: verse.verse,
    primaryText: verse.sanskrit || '',
    secondaryText: verse.transliteration || '',
    translation: fallbackTranslation,
    translationEn,
    translationHi,
    translationTe,
  };
}

function mapBibleVerse(verse: BibleVerse): ScriptureVerse {
  return {
    id: String(verse.id),
    tradition: 'bible',
    source: `Bible - ${verse.book}`,
    chapterLabel: 'Chapter',
    chapterNumber: verse.chapter,
    verseNumber: verse.verse,
    primaryText: verse.text || '',
    translation: verse.text || '',
  };
}

function mapQuranAyah(ayah: QuranAyah): ScriptureVerse {
  const surahNo = toNumber(ayah.surah_no);
  const ayahNo = toNumber(ayah.ayah_no_surah);
  const surahName = ayah.surah_name_roman || ayah.surah_name_en || '';

  return {
    id: String(ayah.id),
    tradition: 'quran',
    source: surahName ? `Quran - ${surahName}` : 'Quran',
    chapterLabel: 'Surah',
    chapterNumber: surahNo,
    verseNumber: ayahNo,
    primaryText: ayah.ayah_ar || '',
    translation: ayah.ayah_en || '',
  };
}

async function searchTraditionByTerms(
  targetTradition: Tradition,
  searchTerms: string[],
  limit = 60
): Promise<ScriptureVerse[]> {
  const terms = Array.from(new Set(searchTerms.map(sanitizeSearchToken).filter((term) => term.length > 1))).slice(0, 8);
  if (terms.length === 0) {
    return [];
  }

  if (targetTradition === 'gita') {
    const fieldFallbackOrder: string[][] = [
      ['translation_en', 'translation_hi', 'translation_te', 'commentary', 'sanskrit', 'transliteration'],
      ['translation_en', 'translation_hi', 'commentary', 'sanskrit', 'transliteration'],
      ['translation_en', 'commentary', 'sanskrit', 'transliteration'],
    ];

    let lastError: { message?: string | null; details?: string | null; hint?: string | null } | null = null;

    for (const fields of fieldFallbackOrder) {
      const { data, error } = await supabase
        .from('gita_verses')
        .select('*')
        .or(buildSearchClause(fields, terms))
        .limit(limit);

      if (!error) {
        return ((data ?? []) as GitaVerse[]).map(mapGitaVerse);
      }

      lastError = error;
      const hasMissingColumn = fields.some((field) => isMissingColumnError(error, field));
      if (!hasMissingColumn) {
        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  }

  if (targetTradition === 'bible') {
    const { data, error } = await supabase
      .from('bible_verses')
      .select('*')
      .or(buildSearchClause(['text', 'book'], terms))
      .limit(limit);

    if (error) throw error;
    return ((data ?? []) as BibleVerse[]).map(mapBibleVerse);
  }

  const { data, error } = await supabase
    .from('quran_ayahs')
    .select('*')
    .or(buildSearchClause(['ayah_en', 'ayah_ar', 'surah_name_en', 'surah_name_roman'], terms))
    .limit(limit);

  if (error) throw error;

  return ((data ?? []) as QuranAyah[])
    .sort((a, b) => {
      const surahDiff = toNumber(a.surah_no) - toNumber(b.surah_no);
      if (surahDiff !== 0) {
        return surahDiff;
      }

      return toNumber(a.ayah_no_surah) - toNumber(b.ayah_no_surah);
    })
    .map(mapQuranAyah);
}

export function SlokaViewer() {
  const [tradition, setTradition] = useState<Tradition>('gita');
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gitaTranslationLanguage, setGitaTranslationLanguage] = useState<GitaTranslationLanguage>('en');
  const { speak, stop, isSpeaking, isSupported } = useSpeech();

  const [searchTerm, setSearchTerm] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('semantic');
  const [searchScope, setSearchScope] = useState<SearchScope>('selected');
  const [singleResult, setSingleResult] = useState<ScriptureVerse | null>(null);
  const [listResults, setListResults] = useState<ScriptureVerse[]>([]);

  const [gitaChapter, setGitaChapter] = useState(1);
  const [gitaVerse, setGitaVerse] = useState(1);

  const [bibleBook, setBibleBook] = useState('');
  const [bibleChapter, setBibleChapter] = useState(1);
  const [bibleVerse, setBibleVerse] = useState(1);
  const [bibleBooks, setBibleBooks] = useState<string[]>([]);
  const [bibleChapters, setBibleChapters] = useState<number[]>([]);
  const [bibleVerses, setBibleVerses] = useState<number[]>([]);
  const [loadingBibleBooks, setLoadingBibleBooks] = useState(true);
  const [loadingBibleRefs, setLoadingBibleRefs] = useState(false);

  const [quranSurah, setQuranSurah] = useState('1');
  const [quranAyah, setQuranAyah] = useState(1);
  const [surahs, setSurahs] = useState<SurahOption[]>([]);
  const [loadingSurahs, setLoadingSurahs] = useState(true);

  useEffect(() => {
    const loadBibleBooks = async () => {
      setLoadingBibleBooks(true);
      try {
        const { data, error: queryError } = await supabase
          .from('bible_verses')
          .select('book')
          .order('book', { ascending: true });

        if (queryError) throw queryError;

        const rawBooks = ((data ?? []) as BibleBookRow[])
          .map((row) => row.book ?? '')
          .filter((book) => book.length > 0);

        const fromDb = Array.from(new Set(rawBooks));
        const orderedDb = bibleBookNames.filter((book) => fromDb.includes(book));
        const extras = fromDb.filter((book) => !bibleBookIndex.has(book));
        const finalList =
          orderedDb.length > 0 ? [...orderedDb, ...extras] : [...bibleBookNames];

        setBibleBooks(finalList);
        if (finalList.length > 0) {
          setBibleBook((prev) => prev || finalList[0]);
        }
      } catch (err) {
        console.error('Error loading Bible books:', err);
        setBibleBooks([...bibleBookNames]);
        setBibleBook((prev) => prev || bibleBookNames[0]);
      } finally {
        setLoadingBibleBooks(false);
      }
    };

    loadBibleBooks();
  }, []);

  useEffect(() => {
    const loadSurahs = async () => {
      setLoadingSurahs(true);
      try {
        const { data, error: queryError } = await supabase
          .from('quran_ayahs')
          .select('surah_no,surah_name_en,surah_name_roman,total_ayah_surah');

        if (queryError) throw queryError;

        const rows = (data ?? []) as SurahMetaRow[];
        const surahMap = new Map<string, SurahOption>();

        for (const row of rows) {
          const surahNo = row.surah_no ?? '';
          if (!surahNo || surahMap.has(surahNo)) {
            continue;
          }

          surahMap.set(surahNo, {
            surahNo,
            surahNameEn: row.surah_name_en ?? '',
            surahNameRoman: row.surah_name_roman ?? '',
            totalAyahSurah: row.total_ayah_surah ?? '',
          });
        }

        const options = Array.from(surahMap.values()).sort(
          (a, b) => toNumber(a.surahNo) - toNumber(b.surahNo)
        );

        setSurahs(options);
        if (options.length > 0) {
          setQuranSurah((prev) => prev || options[0].surahNo);
        }
      } catch (err) {
        console.error('Error loading Surahs:', err);
      } finally {
        setLoadingSurahs(false);
      }
    };

    loadSurahs();
  }, []);

  useEffect(() => {
    if (!bibleBook) {
      setBibleChapters([]);
      return;
    }

    const loadChapters = async () => {
      setLoadingBibleRefs(true);
      try {
        const { data, error: queryError } = await supabase
          .from('bible_verses')
          .select('chapter,verse')
          .eq('book', bibleBook)
          .order('chapter', { ascending: true })
          .order('verse', { ascending: true });

        if (queryError) throw queryError;

        let chapters = Array.from(
          new Set((data ?? []).map((row) => Number(row.chapter)).filter((n) => Number.isFinite(n)))
        ).sort((a, b) => a - b);

        if (chapters.length === 0) {
          const meta = bibleBookMeta.get(bibleBook);
          if (meta) {
            chapters = Array.from({ length: meta.chapters }, (_, idx) => idx + 1);
          }
        }

        setBibleChapters(chapters);
        if (chapters.length > 0) {
          setBibleChapter((prev) => (chapters.includes(prev) ? prev : chapters[0]));
        }
      } catch (err) {
        console.error('Error loading Bible chapters:', err);
        setBibleChapters([]);
      } finally {
        setLoadingBibleRefs(false);
      }
    };

    void loadChapters();
  }, [bibleBook]);

  useEffect(() => {
    if (!bibleBook || !bibleChapter) {
      setBibleVerses([]);
      return;
    }

    const loadVerses = async () => {
      setLoadingBibleRefs(true);
      try {
        const { data, error: queryError } = await supabase
          .from('bible_verses')
          .select('verse')
          .eq('book', bibleBook)
          .eq('chapter', bibleChapter)
          .order('verse', { ascending: true });

        if (queryError) throw queryError;

        const verses = Array.from(
          new Set((data ?? []).map((row) => Number(row.verse)).filter((n) => Number.isFinite(n)))
        ).sort((a, b) => a - b);

        setBibleVerses(verses);
        if (verses.length > 0) {
          setBibleVerse((prev) => (verses.includes(prev) ? prev : verses[0]));
        }
      } catch (err) {
        console.error('Error loading Bible verses:', err);
        setBibleVerses([]);
      } finally {
        setLoadingBibleRefs(false);
      }
    };

    void loadVerses();
  }, [bibleBook, bibleChapter]);

  useEffect(() => {
    setError(null);
    setSingleResult(null);
    setListResults([]);
    setViewMode('single');
  }, [tradition]);

  const selectedSurah = useMemo(
    () => surahs.find((surah) => surah.surahNo === quranSurah) ?? null,
    [quranSurah, surahs]
  );

  const chapterTitle = useMemo(() => {
    if (tradition === 'gita') {
      return `Chapter ${gitaChapter}`;
    }

    if (tradition === 'bible') {
      return `${bibleBook} Chapter ${bibleChapter}`;
    }

    const surahName = selectedSurah?.surahNameRoman || selectedSurah?.surahNameEn || '';
    return surahName ? `Surah ${quranSurah} - ${surahName}` : `Surah ${quranSurah}`;
  }, [tradition, gitaChapter, bibleBook, bibleChapter, quranSurah, selectedSurah]);

  const getVerseTranslation = (verse: ScriptureVerse): string => {
    if (verse.tradition !== 'gita') {
      return verse.translation;
    }

    const preferred =
      gitaTranslationLanguage === 'en'
        ? verse.translationEn
        : gitaTranslationLanguage === 'hi'
          ? verse.translationHi
          : verse.translationTe;

    return (
      preferred?.trim() ||
      verse.translationEn?.trim() ||
      verse.translationHi?.trim() ||
      verse.translationTe?.trim() ||
      verse.translation
    );
  };

  const getVerseSpeechLanguage = (verse: ScriptureVerse): string => {
    if (verse.tradition === 'gita') {
      if (gitaTranslationLanguage === 'hi') {
        return 'hi-IN';
      }

      if (gitaTranslationLanguage === 'te') {
        return 'te-IN';
      }

      return 'en-US';
    }

    if (verse.tradition === 'quran') {
      return verse.primaryText ? 'ar-SA' : 'en-US';
    }

    return 'en-US';
  };

  const buildVerseSpeechText = (verse: ScriptureVerse): string => {
    const reference = `${verse.source}. ${verse.chapterLabel} ${verse.chapterNumber}, Verse ${verse.verseNumber}.`;
    const translation = getVerseTranslation(verse);

    if (verse.tradition === 'quran') {
      return `${reference} ${verse.primaryText || ''} ${translation || ''}`.replace(/\s+/g, ' ').trim();
    }

    if (verse.tradition === 'gita') {
      return `${reference} ${verse.secondaryText || ''} ${translation || ''}`.replace(/\s+/g, ' ').trim();
    }

    return `${reference} ${translation || verse.primaryText || ''}`.replace(/\s+/g, ' ').trim();
  };

  const handleSpeakVerse = (verse: ScriptureVerse) => {
    if (!isSupported) {
      return;
    }

    if (isSpeaking) {
      stop();
      return;
    }

    speak(buildVerseSpeechText(verse), getVerseSpeechLanguage(verse));
  };

  const handleFetchVerse = async () => {
    setLoading(true);
    setError(null);
    setViewMode('single');

    try {
      if (tradition === 'gita') {
        const { data, error: queryError } = await supabase
          .from('gita_verses')
          .select('*')
          .eq('chapter', gitaChapter)
          .eq('verse', gitaVerse)
          .maybeSingle();

        if (queryError) throw queryError;
        if (!data) {
          throw new Error(`No verse found for Chapter ${gitaChapter}, Verse ${gitaVerse}.`);
        }

        setSingleResult(mapGitaVerse(data as GitaVerse));
        setListResults([]);
        return;
      }

      if (tradition === 'bible') {
        if (!bibleBook) {
          throw new Error('Select a Bible book first.');
        }

        const { data, error: queryError } = await supabase
          .from('bible_verses')
          .select('*')
          .eq('book', bibleBook)
          .eq('chapter', bibleChapter)
          .eq('verse', bibleVerse)
          .maybeSingle();

        if (queryError) throw queryError;
        if (!data) {
          throw new Error(`No verse found for ${bibleBook} ${bibleChapter}:${bibleVerse}.`);
        }

        setSingleResult(mapBibleVerse(data as BibleVerse));
        setListResults([]);
        return;
      }

      const { data, error: queryError } = await supabase
        .from('quran_ayahs')
        .select('*')
        .eq('surah_no', quranSurah)
        .eq('ayah_no_surah', String(quranAyah))
        .maybeSingle();

      if (queryError) throw queryError;
      if (!data) {
        throw new Error(`No ayah found for Surah ${quranSurah}, Ayah ${quranAyah}.`);
      }

      setSingleResult(mapQuranAyah(data as QuranAyah));
      setListResults([]);
    } catch (err) {
      setSingleResult(null);
      setError(getErrorMessage(err, 'Unable to fetch verse right now.'));
    } finally {
      setLoading(false);
    }
  };

  const handleFetchChapter = async () => {
    setLoading(true);
    setError(null);
    setViewMode('chapter');

    try {
      if (tradition === 'gita') {
        const { data, error: queryError } = await supabase
          .from('gita_verses')
          .select('*')
          .eq('chapter', gitaChapter)
          .order('verse', { ascending: true });

        if (queryError) throw queryError;

        const verses = ((data ?? []) as GitaVerse[]).map(mapGitaVerse);
        if (verses.length === 0) {
          throw new Error(`No verses found for Chapter ${gitaChapter}.`);
        }

        setSingleResult(null);
        setListResults(verses);
        return;
      }

      if (tradition === 'bible') {
        if (!bibleBook) {
          throw new Error('Select a Bible book first.');
        }

        const { data, error: queryError } = await supabase
          .from('bible_verses')
          .select('*')
          .eq('book', bibleBook)
          .eq('chapter', bibleChapter)
          .order('verse', { ascending: true });

        if (queryError) throw queryError;

        const verses = ((data ?? []) as BibleVerse[]).map(mapBibleVerse);
        if (verses.length === 0) {
          throw new Error(`No verses found for ${bibleBook} Chapter ${bibleChapter}.`);
        }

        setSingleResult(null);
        setListResults(verses);
        return;
      }

      const { data, error: queryError } = await supabase
        .from('quran_ayahs')
        .select('*')
        .eq('surah_no', quranSurah);

      if (queryError) throw queryError;

      const verses = ((data ?? []) as QuranAyah[])
        .sort((a, b) => toNumber(a.ayah_no_surah) - toNumber(b.ayah_no_surah))
        .map(mapQuranAyah);

      if (verses.length === 0) {
        throw new Error(`No ayahs found for Surah ${quranSurah}.`);
      }

      setSingleResult(null);
      setListResults(verses);
    } catch (err) {
      setListResults([]);
      setError(getErrorMessage(err, 'Unable to fetch chapter right now.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    const trimmed = searchTerm.trim();
    if (!trimmed) {
      return;
    }

    setLoading(true);
    setError(null);
    setViewMode('search');

    try {
      const baseTokens = tokenizeSearchQuery(trimmed);
      const safePhrase = sanitizeSearchToken(trimmed);
      const phraseTokens = safePhrase.split(' ').filter((token) => token.length > 1);
      const queryTokens = baseTokens.length > 0 ? baseTokens : phraseTokens;

      const searchTerms =
        queryTokens.length > 0
          ? queryTokens
          : safePhrase
              .split(' ')
              .map((token) => sanitizeSearchToken(token))
              .filter((token) => token.length > 1);

      const semanticExpandedTerms =
        searchMode === 'semantic'
          ? expandSemanticTokens(queryTokens).map((token) => sanitizeSearchToken(token))
          : [];

      const targetTraditions: Tradition[] =
        searchScope === 'all' ? (['gita', 'bible', 'quran'] as Tradition[]) : [tradition];

      const combinedTerms = Array.from(
        new Set(
          [...searchTerms, ...semanticExpandedTerms]
            .map((token) => sanitizeSearchToken(token))
            .filter((token) => token.length > 1)
        )
      ).slice(0, 8);

      const fetched = await Promise.all(
        targetTraditions.map((item) =>
          searchTraditionByTerms(item, combinedTerms, searchMode === 'semantic' ? 140 : 60)
        )
      );

      const merged = Array.from(
        new Map(
          fetched
            .flat()
            .map((item) => [`${item.tradition}-${item.id}`, item] as const)
        ).values()
      );

      if (searchMode === 'semantic') {
        const expandedTokens = expandSemanticTokens(queryTokens);
        const ranked = merged
          .map((item) => rankSemanticVerse(item, trimmed, queryTokens, expandedTokens))
          .filter((item) => (item.semanticScore ?? 0) > 0)
          .sort((a, b) => {
            const scoreDiff = (b.semanticScore ?? 0) - (a.semanticScore ?? 0);
            if (scoreDiff !== 0) {
              return scoreDiff;
            }

            if (a.tradition !== b.tradition) {
              return a.tradition.localeCompare(b.tradition);
            }

            if (a.chapterNumber !== b.chapterNumber) {
              return a.chapterNumber - b.chapterNumber;
            }

            return a.verseNumber - b.verseNumber;
          })
          .slice(0, 80);

        setSingleResult(null);
        setListResults(ranked);
        return;
      }

      setSingleResult(null);
      setListResults(merged.slice(0, 80));
    } catch (err) {
      setListResults([]);
      setError(getErrorMessage(err, 'Unable to search right now.'));
    } finally {
      setLoading(false);
    }
  };

  const renderPrimaryText = (verse: ScriptureVerse, className: string) => {
    if (verse.tradition === 'quran') {
      return (
        <p dir="rtl" className={`${className} text-right text-2xl`}>
          {verse.primaryText}
        </p>
      );
    }

    return <p className={className}>{verse.primaryText}</p>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Scripture Verse Explorer</h1>
          <p className="text-slate-600">Browse references and run semantic search across Bhagavad Gita, Bible, and Quran</p>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-3">Choose Tradition</h2>
              <div className="flex gap-2 flex-wrap">
                {(['gita', 'bible', 'quran'] as const).map((item) => (
                  <button
                    key={item}
                    onClick={() => setTradition(item)}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      tradition === item
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {traditionLabels[item]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Retrieve by Reference</h2>
              <div className="flex gap-3 flex-wrap">
                {tradition === 'gita' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Chapter (1-18)</label>
                      <input
                        type="number"
                        min="1"
                        max="18"
                        value={gitaChapter}
                        onChange={(e) =>
                          setGitaChapter(Math.max(1, Math.min(18, Number.parseInt(e.target.value, 10) || 1)))
                        }
                        className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Verse</label>
                      <input
                        type="number"
                        min="1"
                        value={gitaVerse}
                        onChange={(e) => setGitaVerse(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                        className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </>
                )}

                {tradition === 'bible' && (
                  <>
                    <div className="min-w-52">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Book</label>
                      <select
                        value={bibleBook}
                        onChange={(e) => setBibleBook(e.target.value)}
                        disabled={loadingBibleBooks || loadingBibleRefs}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      >
                        {bibleBooks.map((book) => (
                          <option key={book} value={book}>
                            {book}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Chapter</label>
                      <select
                        value={bibleChapter}
                        onChange={(e) => setBibleChapter(Number(e.target.value))}
                        disabled={loadingBibleRefs || bibleChapters.length === 0}
                        className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      >
                        {bibleChapters.map((chapterNo) => (
                          <option key={chapterNo} value={chapterNo}>
                            {chapterNo}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Verse</label>
                      <select
                        value={bibleVerse}
                        onChange={(e) => setBibleVerse(Number(e.target.value))}
                        disabled={loadingBibleRefs || bibleVerses.length === 0}
                        className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      >
                        {bibleVerses.map((verseNo) => (
                          <option key={verseNo} value={verseNo}>
                            {verseNo}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {tradition === 'quran' && (
                  <>
                    <div className="min-w-60">
                      <label className="block text-sm font-medium text-slate-700 mb-1">Surah</label>
                      <select
                        value={quranSurah}
                        onChange={(e) => setQuranSurah(e.target.value)}
                        disabled={loadingSurahs}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      >
                        {surahs.map((surah) => (
                          <option key={surah.surahNo} value={surah.surahNo}>
                            {surah.surahNo}. {surah.surahNameRoman || surah.surahNameEn}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Ayah</label>
                      <input
                        type="number"
                        min="1"
                        value={quranAyah}
                        onChange={(e) => setQuranAyah(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                        className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </>
                )}

                <div className="flex items-end gap-2">
                  <button
                    onClick={handleFetchVerse}
                    disabled={loading || loadingBibleBooks || loadingSurahs || loadingBibleRefs}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 transition-colors flex items-center gap-2"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                    Get Verse
                  </button>
                  <button
                    onClick={handleFetchChapter}
                    disabled={loading || loadingBibleBooks || loadingSurahs || loadingBibleRefs}
                    className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 disabled:bg-slate-400 transition-colors"
                  >
                    Get Chapter
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">
                {searchScope === 'all'
                  ? 'Cross-Scripture Search'
                  : `Search ${traditionLabels[tradition]} Verses`}
              </h2>
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
                  <button
                    onClick={() => setSearchMode('semantic')}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      searchMode === 'semantic'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Semantic
                  </button>
                  <button
                    onClick={() => setSearchMode('keyword')}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      searchMode === 'keyword'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Keyword
                  </button>
                </div>

                <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
                  <button
                    onClick={() => setSearchScope('selected')}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      searchScope === 'selected'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    Selected Scripture
                  </button>
                  <button
                    onClick={() => setSearchScope('all')}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      searchScope === 'all'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    All Scriptures
                  </button>
                </div>
              </div>

              {tradition === 'gita' && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-slate-700 mb-2">Translation Language</p>
                  <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden">
                    {(['en', 'hi', 'te'] as const).map((language) => (
                      <button
                        key={language}
                        onClick={() => setGitaTranslationLanguage(language)}
                        className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                          gitaTranslationLanguage === language
                            ? 'bg-amber-600 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {gitaLanguageLabels[language]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    placeholder={
                      searchMode === 'semantic'
                        ? 'Try ideas like peace, purpose, anxiety, service...'
                        : 'Search words in verses and translations...'
                    }
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={() => {
                    void handleSearch();
                  }}
                  disabled={loading || !searchTerm.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-slate-400 transition-colors"
                >
                  Search
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {searchMode === 'semantic'
                  ? 'Semantic mode ranks verses by meaning-aligned language and related concepts.'
                  : 'Keyword mode matches exact terms only.'}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {viewMode === 'single' && singleResult && (
          <div className="bg-white rounded-lg shadow-md p-8 space-y-6">
            <div className="border-b pb-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-semibold text-slate-600 mb-1">{singleResult.source}</p>
                  <p className="text-sm font-semibold text-slate-600">
                    {singleResult.chapterLabel} {singleResult.chapterNumber} | Verse {singleResult.verseNumber}
                  </p>
                </div>
                <button
                  onClick={() => handleSpeakVerse(singleResult)}
                  disabled={!isSupported}
                  className="p-2 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label={isSpeaking ? 'Stop audio' : 'Speak verse'}
                  title={isSupported ? (isSpeaking ? 'Stop audio' : 'Play audio') : 'Speech not supported'}
                >
                  <Volume2 className={`w-5 h-5 ${isSpeaking ? 'text-blue-600' : ''}`} />
                </button>
              </div>
              {renderPrimaryText(singleResult, 'font-semibold text-slate-900 mb-3')}
              {singleResult.secondaryText && (
                <p className="text-lg text-slate-700 italic">{singleResult.secondaryText}</p>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-slate-900 mb-2">
                Translation
                {singleResult.tradition === 'gita' ? ` (${gitaLanguageLabels[gitaTranslationLanguage]})` : ''}
              </h3>
              <p className="text-slate-700 leading-relaxed">{getVerseTranslation(singleResult)}</p>
            </div>
          </div>
        )}

        {(viewMode === 'chapter' || viewMode === 'search') && listResults.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">
              {viewMode === 'chapter'
                ? `${chapterTitle} | ${listResults.length} verses`
                : `${searchScope === 'all' ? 'Cross-scripture' : traditionLabels[tradition]} ${
                    searchMode === 'semantic' ? 'semantic' : 'search'
                  } results | ${listResults.length} matches`}
            </h2>
            <div className="space-y-4">
              {listResults.map((verse) => (
                <div
                  key={`${verse.tradition}-${verse.id}`}
                  className="border rounded-lg p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-600 mb-1">{verse.source}</p>
                      <p className="text-sm font-semibold text-slate-600">
                        {verse.chapterLabel} {verse.chapterNumber} | Verse {verse.verseNumber}
                      </p>
                    </div>
                    <button
                      onClick={() => handleSpeakVerse(verse)}
                      disabled={!isSupported}
                      className="p-2 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      aria-label={isSpeaking ? 'Stop audio' : 'Speak verse'}
                      title={isSupported ? (isSpeaking ? 'Stop audio' : 'Play audio') : 'Speech not supported'}
                    >
                      <Volume2 className={`w-4 h-4 ${isSpeaking ? 'text-blue-600' : ''}`} />
                    </button>
                  </div>
                  {viewMode === 'search' && (
                    <div className="mb-2 flex items-center gap-2">
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        {traditionLabels[verse.tradition]}
                      </span>
                      {verse.tradition === 'gita' && (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          {gitaLanguageLabels[gitaTranslationLanguage]}
                        </span>
                      )}
                      {searchMode === 'semantic' && typeof verse.semanticScore === 'number' && (
                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                          Relevance {verse.semanticScore}
                        </span>
                      )}
                    </div>
                  )}
                  {viewMode !== 'search' && verse.tradition === 'gita' && (
                    <div className="mb-2 flex items-center gap-2">
                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        {gitaLanguageLabels[gitaTranslationLanguage]}
                      </span>
                    </div>
                  )}
                  {renderPrimaryText(verse, 'font-semibold text-slate-900 mb-2')}
                  {verse.secondaryText && (
                    <p className="text-slate-600 text-sm italic mb-2">{verse.secondaryText}</p>
                  )}
                  <p className="text-slate-600 text-sm">{getVerseTranslation(verse)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {viewMode === 'search' && !loading && listResults.length === 0 && (
          <div className="bg-slate-50 rounded-lg p-8 text-center">
            <p className="text-slate-600">
              No {searchMode === 'semantic' ? 'semantic' : 'keyword'} results found for "{searchTerm}"
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

