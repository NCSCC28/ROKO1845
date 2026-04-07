import { useCallback, useEffect, useMemo, useState } from 'react';
import { Book, Search, Volume2, Heart, Languages } from 'lucide-react';
import { supabase, QuranAyah } from '../lib/supabase';
import { useSpeech } from '../hooks/useSpeech';
import useFavorites from '../hooks/useFavorites';
import { generateTeluguExplanation } from '../utils/teluguNlp';
import { generateBriefVerseExplanation } from '../utils/verseExplanation';
import { askOpenRouter } from '../utils/geminiAi';

type TranslationMode = 'arabic' | 'english' | 'both';

interface SurahOption {
  surahNo: string;
  surahNameEn: string;
  surahNameAr: string;
  surahNameRoman: string;
  totalAyahSurah: string;
}

interface SurahMetaRow {
  surah_no: string | null;
  surah_name_en: string | null;
  surah_name_ar: string | null;
  surah_name_roman: string | null;
  total_ayah_surah: string | null;
}

function toNumber(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSurahLabel(surah: SurahOption): string {
  const padded = surah.surahNo.padStart(3, '0');
  return `${padded} - ${surah.surahNameRoman || surah.surahNameEn}`;
}

function sortAyahs(ayahs: QuranAyah[]): QuranAyah[] {
  return [...ayahs].sort((a, b) => {
    const surahDiff = toNumber(a.surah_no) - toNumber(b.surah_no);
    if (surahDiff !== 0) return surahDiff;
    return toNumber(a.ayah_no_surah) - toNumber(b.ayah_no_surah);
  });
}

export default function QuranPage() {
  const [surahs, setSurahs] = useState<SurahOption[]>([]);
  const [selectedSurah, setSelectedSurah] = useState('1');
  const [translationMode, setTranslationMode] = useState<TranslationMode>('both');
  const [audioLanguage, setAudioLanguage] = useState<'ar' | 'en' | 'te'>('en');
  const [searchQuery, setSearchQuery] = useState('');
  const [topicQuery, setTopicQuery] = useState('');
  const [semanticKeywords, setSemanticKeywords] = useState<string[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [ayahs, setAyahs] = useState<QuranAyah[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSurahs, setLoadingSurahs] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teluguExplanations, setTeluguExplanations] = useState<Record<string, string>>({});
  const [loadingExplanationId, setLoadingExplanationId] = useState<string | null>(null);
  const { speak, isSpeaking } = useSpeech();
  const { toggleFavorite, isFavorite } = useFavorites();

  const selectedSurahDetails = useMemo(
    () => surahs.find((surah) => surah.surahNo === selectedSurah) ?? null,
    [surahs, selectedSurah]
  );

  const loadSurahs = useCallback(async () => {
    setLoadingSurahs(true);
    try {
      const { data, error: queryError } = await supabase
        .from('quran_ayahs')
        .select('surah_no,surah_name_en,surah_name_ar,surah_name_roman,total_ayah_surah');

      if (queryError) throw queryError;

      const rows = (data ?? []) as SurahMetaRow[];
      const map = new Map<string, SurahOption>();

      for (const row of rows) {
        const surahNo = row.surah_no ?? '';
        if (!surahNo || map.has(surahNo)) continue;

        map.set(surahNo, {
          surahNo,
          surahNameEn: row.surah_name_en ?? '',
          surahNameAr: row.surah_name_ar ?? '',
          surahNameRoman: row.surah_name_roman ?? '',
          totalAyahSurah: row.total_ayah_surah ?? '',
        });
      }

      const options = Array.from(map.values()).sort(
        (a, b) => toNumber(a.surahNo) - toNumber(b.surahNo)
      );
      setSurahs(options);
    } catch (err) {
      console.error('Error loading surahs:', err);
    } finally {
      setLoadingSurahs(false);
    }
  }, []);

  const loadAyahs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const trimmedQuery = searchQuery.trim();
      const escapedQuery = trimmedQuery.replace(/[%_,]/g, '');

      let query = supabase.from('quran_ayahs').select('*');

      if (selectedSurah !== 'all') {
        query = query.eq('surah_no', selectedSurah);
      }

      if (escapedQuery) {
        query = query.or(
          `ayah_en.ilike.%${escapedQuery}%,ayah_ar.ilike.%${escapedQuery}%,surah_name_en.ilike.%${escapedQuery}%,surah_name_roman.ilike.%${escapedQuery}%`
        );
      }

      const limit = selectedSurah === 'all' && !escapedQuery ? 300 : 1200;
      const { data, error: queryError } = await query.limit(limit);

      if (queryError) throw queryError;

      setAyahs(sortAyahs((data ?? []) as QuranAyah[]));
    } catch (err) {
      console.error('Error loading Quran ayahs:', err);
      setAyahs([]);
      setError('Could not load Quran data. Please run your SQL in Supabase and refresh.');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedSurah]);

  useEffect(() => {
    loadSurahs();
  }, [loadSurahs]);

  useEffect(() => {
    loadAyahs();
  }, [loadAyahs]);

  const filteredAyahs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const topicTerms = new Set<string>();
    const normTopic = topicQuery.trim().toLowerCase();
    if (normTopic) normTopic.split(/\s+/).forEach((w) => w && topicTerms.add(w));
    semanticKeywords.forEach((k) => topicTerms.add(k.toLowerCase()));

    return sortAyahs(
      ayahs.filter((a) => {
        const combined = [
          a.ayah_en ?? '',
          a.ayah_ar ?? '',
          a.ayah_tr ?? '',
          a.surah_name_en ?? '',
          a.surah_name_roman ?? '',
        ]
          .join(' ')
          .toLowerCase();

        if (q && !combined.includes(q)) return false;

        if (topicTerms.size > 0) {
          for (const term of topicTerms) {
            if (term.length > 2 && combined.includes(term)) return true;
          }
          return false;
        }
        return true;
      })
    );
  }, [ayahs, searchQuery, topicQuery, semanticKeywords]);

  const ensureTeluguExplanation = useCallback(async (ayah: QuranAyah) => {
    const ayahId = String(ayah.id);
    if (teluguExplanations[ayahId]) {
      return teluguExplanations[ayahId];
    }

    const sourceText = generateBriefVerseExplanation(
      'quran',
      (ayah.ayah_en || ayah.ayah_ar || '').trim(),
      `${ayah.surah_no}:${ayah.ayah_no_surah}`
    );
    if (!sourceText.trim()) {
      return '';
    }

    setLoadingExplanationId(ayahId);
    try {
      const explanation = await generateTeluguExplanation(sourceText);
      setTeluguExplanations((prev) => ({ ...prev, [ayahId]: explanation }));
      return explanation;
    } catch (error) {
      console.error('Error generating Telugu explanation:', error);
      const fallback = 'Telugu explanation is currently unavailable.';
      setTeluguExplanations((prev) => ({
        ...prev,
        [ayahId]: fallback,
      }));
      return fallback;
    } finally {
      setLoadingExplanationId((prev) => (prev === ayahId ? null : prev));
    }
  }, [teluguExplanations]);

  const handleTeluguExplanation = useCallback(async (ayah: QuranAyah) => {
    await ensureTeluguExplanation(ayah);
  }, [ensureTeluguExplanation]);

  const handleSpeak = useCallback(async (ayah: QuranAyah) => {
    const reference = `${ayah.surah_no}:${ayah.ayah_no_surah}`;
    const englishText = (ayah.ayah_en || '').trim();
    const arabicText = (ayah.ayah_ar || '').trim();
    const verseText = englishText || arabicText;
    const briefExplanation = generateBriefVerseExplanation(
      'quran',
      (verseText || '').trim(),
      reference
    );

    // Always read the verse first, then the short explanation
    if (audioLanguage === 'te') {
      const explanation = await ensureTeluguExplanation(ayah);
      if (!explanation && !verseText) return;

      const teluguSpeechParts = [
        `Surah ${ayah.surah_no}, Ayah ${ayah.ayah_no_surah}.`,
        verseText, // keeps English/Arabic transliteration before Telugu explanation
        explanation,
      ].filter(Boolean);

      speak(teluguSpeechParts.join(' '), 'te-IN');
      return;
    }

    if (audioLanguage === 'ar') {
      const arabicSpeechParts = [
        arabicText || verseText,
        englishText ? `Tarjama: ${englishText}` : null,
        briefExplanation ? `Tafsir khulasa: ${briefExplanation}` : null,
      ].filter(Boolean);
      speak(arabicSpeechParts.join(' '), 'ar-SA');
      return;
    }

    const englishSpeechParts = [
      `${reference}.`,
      verseText,
      briefExplanation ? `Brief explanation: ${briefExplanation}` : null,
    ].filter(Boolean);
    speak(englishSpeechParts.join(' '), 'en-US');
  }, [audioLanguage, ensureTeluguExplanation, speak]);

  const handleSemanticBoost = async () => {
    const basePrompt = topicQuery || searchQuery;
    if (!basePrompt.trim()) return;
    setSemanticLoading(true);
    try {
      const response = await askOpenRouter(
        `Suggest 5 short keywords to find Quran ayahs about "${basePrompt}". Return comma-separated single words.`
      );
      const keywords = response
        .split(/[,;\n]/)
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 2);
      setSemanticKeywords(keywords.slice(0, 8));
    } catch (err) {
      console.error('Semantic boost failed', err);
      setSemanticKeywords([]);
    } finally {
      setSemanticLoading(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setTopicQuery('');
    setSemanticKeywords([]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center space-x-3 mb-8">
          <Book className="h-10 w-10 text-emerald-600 dark:text-emerald-500" />
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">The Quran</h1>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 mb-8">
          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Select Surah
              </label>
              <select
                value={selectedSurah}
                onChange={(e) => setSelectedSurah(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                disabled={loadingSurahs}
              >
                <option value="all">All Surahs</option>
                {surahs.map((surah) => (
                  <option key={surah.surahNo} value={surah.surahNo}>
                    {formatSurahLabel(surah)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Translation View
              </label>
              <div className="flex flex-wrap gap-2">
                {(['arabic', 'english', 'both'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setTranslationMode(mode)}
                    className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      translationMode === mode
                        ? 'bg-emerald-600 text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {mode === 'arabic' ? 'Arabic' : mode === 'english' ? 'English' : 'Both'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="quran-audio-language" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Audio Language
              </label>
              <select
                id="quran-audio-language"
                value={audioLanguage}
                onChange={(e) => setAudioLanguage(e.target.value as 'ar' | 'en' | 'te')}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="en">English</option>
                <option value="ar">Arabic</option>
                <option value="te">Telugu</option>
              </select>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ayah text or surah name..."
              className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex gap-3 flex-col sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Topic or intent (e.g., mercy, patience, gratitude, anxiety)"
                value={topicQuery}
                onChange={(e) => setTopicQuery(e.target.value)}
                className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <button
                onClick={handleSemanticBoost}
                disabled={semanticLoading}
                className="px-4 py-3 rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-500 text-white font-semibold shadow hover:from-emerald-500 hover:to-cyan-400 disabled:opacity-60 transition-all"
              >
                {semanticLoading ? 'Thinking…' : 'AI Boost'}
              </button>
              <button
                onClick={clearFilters}
                className="px-4 py-3 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Clear
              </button>
            </div>

            <div className="flex flex-wrap gap-2 text-sm">
              {['mercy', 'patience', 'gratitude', 'forgiveness', 'justice', 'peace', 'hope', 'anxiety'].map((topic) => (
                <button
                  key={topic}
                  onClick={() => setTopicQuery(topic)}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                    topicQuery === topic
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {topic}
                </button>
              ))}
            </div>

            {semanticKeywords.length > 0 && (
              <p className="text-xs text-gray-600 dark:text-gray-300">
                AI keywords: {semanticKeywords.join(', ')}
              </p>
            )}
          </div>

          {selectedSurahDetails && selectedSurah !== 'all' && (
            <div className="mt-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-4">
              <p className="text-sm text-emerald-900 dark:text-emerald-200">
                Surah {selectedSurahDetails.surahNo}: {selectedSurahDetails.surahNameEn} (
                {selectedSurahDetails.surahNameRoman})
              </p>
              <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                Total Ayahs: {selectedSurahDetails.totalAyahSurah || 'Unknown'}
              </p>
            </div>
          )}

          {selectedSurah === 'all' && searchQuery.trim() === '' && (
            <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">
              Showing first 300 ayahs. Select a Surah or search to narrow results.
            </p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
            <p className="text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-10 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading Quran verses...</p>
          </div>
        ) : filteredAyahs.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-10 text-center">
            <p className="text-gray-600 dark:text-gray-400">No ayahs found for your filter.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredAyahs.map((ayah) => (
              <div
                key={ayah.id}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 hover:shadow-2xl transition-all duration-300"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-500">
                    Surah {ayah.surah_no}, Ayah {ayah.ayah_no_surah} ({ayah.surah_name_roman || ayah.surah_name_en})
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        void handleSpeak(ayah);
                      }}
                      disabled={isSpeaking || (audioLanguage === 'te' && loadingExplanationId === String(ayah.id))}
                      className="p-2 rounded-full bg-emerald-100 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 transition-colors duration-200 disabled:opacity-50"
                      aria-label="Play ayah audio"
                    >
                      <Volume2 className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => toggleFavorite('quran', String(ayah.id))}
                      className={`p-2 rounded-full transition-colors duration-200 ${
                        isFavorite('quran', String(ayah.id))
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300'
                      }`}
                      aria-label="Toggle favorite"
                    >
                      <Heart className={`h-5 w-5 ${isFavorite('quran', String(ayah.id)) ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      onClick={() => handleTeluguExplanation(ayah)}
                      disabled={loadingExplanationId === String(ayah.id)}
                      className="p-2 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-700 transition-colors duration-200 disabled:opacity-50"
                      aria-label="Explain in Telugu"
                    >
                      <Languages className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {(translationMode === 'arabic' || translationMode === 'both') && (
                  <p dir="rtl" className="text-right text-2xl leading-loose text-gray-900 dark:text-gray-100 mb-4">
                    {ayah.ayah_ar}
                  </p>
                )}

                {(translationMode === 'english' || translationMode === 'both') && (
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{ayah.ayah_en}</p>
                )}
                <div className="mt-4 pt-4 border-t border-emerald-200 dark:border-emerald-900/40">
                  <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                    Brief Explanation
                  </p>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                    {generateBriefVerseExplanation(
                      'quran',
                      (ayah.ayah_en || ayah.ayah_ar || '').trim(),
                      `${ayah.surah_no}:${ayah.ayah_no_surah}`
                    )}
                  </p>
                </div>

                <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                  Juz: {ayah.juz_no || 'N/A'} â€¢ Revelation: {ayah.place_of_revelation || 'N/A'}
                </div>

                {teluguExplanations[String(ayah.id)] && (
                  <div className="mt-4 pt-4 border-t border-blue-200 dark:border-blue-900/40">
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-1">
                      Telugu Explanation
                    </p>
                    <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                      {teluguExplanations[String(ayah.id)]}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


