import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase, GitaVerse } from '../lib/supabase';
import { Volume2, Heart, Search, BookOpen, Languages } from 'lucide-react';
import { useSpeech } from '../hooks/useSpeech';
import useFavorites from '../hooks/useFavorites';
import { generateTeluguExplanation } from '../utils/teluguNlp';
import { askOpenRouter } from '../utils/geminiAi';

export default function GitaPage() {
  const [verses, setVerses] = useState<GitaVerse[]>([]);
  const [filteredVerses, setFilteredVerses] = useState<GitaVerse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'hi' | 'te'>('en');
  const [audioLanguage, setAudioLanguage] = useState<'en' | 'te'>('en');
  const [teluguExplanations, setTeluguExplanations] = useState<Record<string, string>>({});
  const [loadingExplanationId, setLoadingExplanationId] = useState<string | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [topicQuery, setTopicQuery] = useState('');
  const [semanticKeywords, setSemanticKeywords] = useState<string[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);

  const { speak, isSpeaking } = useSpeech();
  const { toggleFavorite, isFavorite } = useFavorites();

  useEffect(() => {
    loadVerses();
  }, []);

  const loadVerses = async () => {
    try {
      const { data, error } = await supabase
        .from('gita_verses')
        .select('*')
        .order('chapter', { ascending: true })
        .order('verse', { ascending: true });

      if (error) throw error;

      const safeData = data || [];
      setVerses(safeData);
      setFilteredVerses(safeData);
    } catch (error) {
      console.error('Error loading verses:', error);
    } finally {
      setLoading(false);
    }
  };
  // Debounce search input
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchQuery.trim().toLowerCase()), 220);
    return () => clearTimeout(id);
  }, [searchQuery]);

  // Compute filtered list
  const filtered = useMemo(() => {
    let list = verses;
    if (selectedChapter !== null) {
      list = list.filter((v) => v.chapter === selectedChapter);
    }
    if (debouncedSearch) {
      list = list.filter((v) =>
        (v.translation_en || '').toLowerCase().includes(debouncedSearch) ||
        (v.translation_hi || '').toLowerCase().includes(debouncedSearch) ||
        (v.translation_te || '').toLowerCase().includes(debouncedSearch) ||
        (v.transliteration || '').toLowerCase().includes(debouncedSearch) ||
        (v.sanskrit || '').toLowerCase().includes(debouncedSearch) ||
        (v.commentary || '').toLowerCase().includes(debouncedSearch)
      );
    }
    const topics = new Set<string>();
    const normalized = topicQuery.trim().toLowerCase();
    if (normalized) normalized.split(/\s+/).forEach((w) => w && topics.add(w));
    semanticKeywords.forEach((k) => topics.add(k.toLowerCase()));
    if (topics.size > 0) {
      list = list.filter((v) => {
        const text = `${v.translation_en} ${v.translation_hi} ${v.translation_te} ${v.transliteration} ${v.commentary}`.toLowerCase();
        for (const term of topics) {
          if (term.length > 2 && text.includes(term)) return true;
        }
        return false;
      });
    }
    return list;
  }, [verses, selectedChapter, debouncedSearch, topicQuery, semanticKeywords]);

  useEffect(() => {
    setFilteredVerses(filtered);
    setVisibleCount(20); // reset pagination when filters change
  }, [filtered]);

  const ensureTeluguExplanation = useCallback(async (verse: GitaVerse) => {
    const verseId = String(verse.id);
    if (teluguExplanations[verseId]) {
      return teluguExplanations[verseId];
    }

    const sourceText = verse.commentary || verse.translation_en || verse.transliteration || verse.sanskrit || '';
    if (!sourceText.trim()) {
      return '';
    }

    setLoadingExplanationId(verseId);
    try {
      const explanation = await generateTeluguExplanation(sourceText);
      setTeluguExplanations((prev) => ({ ...prev, [verseId]: explanation }));
      return explanation;
    } catch (error) {
      console.error('Error generating Telugu explanation:', error);
      const fallback = 'Telugu explanation is currently unavailable.';
      setTeluguExplanations((prev) => ({
        ...prev,
        [verseId]: fallback,
      }));
      return fallback;
    } finally {
      setLoadingExplanationId((prev) => (prev === verseId ? null : prev));
    }
  }, [teluguExplanations]);

  const handleSpeak = useCallback(async (verse: GitaVerse) => {
    if (audioLanguage === 'te') {
      const teluguText = (verse.translation_te || '').trim() || (await ensureTeluguExplanation(verse));
      if (!teluguText) {
        return;
      }

      speak(teluguText, 'te-IN');
      return;
    }

    speak(
      `Chapter ${verse.chapter}, Verse ${verse.verse}. ${verse.transliteration || ''}. ${verse.translation_en || ''}`,
      'en-US'
    );
  }, [audioLanguage, ensureTeluguExplanation, speak]);

  const handleSemanticBoost = async () => {
    const basePrompt = topicQuery || searchQuery;
    if (!basePrompt.trim()) return;
    setSemanticLoading(true);
    try {
      const response = await askOpenRouter(
        `Suggest 5 short keywords to find Bhagavad Gita verses about "${basePrompt}". 
Return a comma-separated list of single words.`
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
    setSelectedChapter(null);
    setSearchQuery('');
    setTopicQuery('');
    setSemanticKeywords([]);
  };

  const handleTeluguExplanation = useCallback(async (verse: GitaVerse) => {
    await ensureTeluguExplanation(verse);
  }, [ensureTeluguExplanation]);

  // Pre-fill Telugu explanations for the currently visible verses (up to 10) when missing.
  useEffect(() => {
    const needsTelugu = filteredVerses
      .slice(0, 10)
      .filter(
        (verse) =>
          !(verse.translation_te && verse.translation_te.trim().length > 0) &&
          !teluguExplanations[String(verse.id)]
      );

    needsTelugu.forEach((verse) => {
      void ensureTeluguExplanation(verse);
    });
  }, [filteredVerses, ensureTeluguExplanation, teluguExplanations]);

  const chapters = Array.from({ length: 18 }, (_, i) => i + 1);
  const visibleVerses = filteredVerses.slice(0, visibleCount);
  const hasMore = visibleCount < filteredVerses.length;

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <p className="text-gray-700 dark:text-gray-300">Loading verses...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-center space-x-3 mb-8">
          <BookOpen className="h-10 w-10 text-amber-600 dark:text-amber-400" />
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
            Bhagavad Gita
          </h1>
        </div>

        {/* Search & Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 mb-8 border border-transparent dark:border-gray-700">

          {/* Search */}
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search verses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            />
          </div>

          {/* Topic + AI semantic */}
          <div className="mb-5 space-y-3">
            <div className="flex gap-3 flex-col sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Topic or intent (e.g., duty, devotion, detachment, anxiety)"
                value={topicQuery}
                onChange={(e) => setTopicQuery(e.target.value)}
                className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <button
                onClick={handleSemanticBoost}
                disabled={semanticLoading}
                className="px-4 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-semibold shadow hover:from-blue-500 hover:to-cyan-400 disabled:opacity-60 transition-all"
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
              {['duty', 'devotion', 'detachment', 'wisdom', 'peace', 'courage', 'karma', 'bhakti'].map((topic) => (
                <button
                  key={topic}
                  onClick={() => setTopicQuery(topic)}
                  className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                    topicQuery === topic
                      ? 'bg-blue-600 text-white border-blue-600'
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

          {/* Language Selector */}
          <div className="mb-4">
            <p className="text-sm font-semibold mb-2 text-gray-800 dark:text-gray-200">Translation Language:</p>
            <div className="flex gap-2">
              {(['en', 'hi', 'te'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => setSelectedLanguage(lang)}
                  className={`px-4 py-2 rounded-lg ${
                    selectedLanguage === lang
                      ? 'bg-amber-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {lang === 'en'
                    ? 'English'
                    : lang === 'hi'
                    ? 'Hindi'
                    : 'Telugu'}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 max-w-xs">
            <label htmlFor="gita-audio-language" className="block text-sm font-semibold mb-2 text-gray-800 dark:text-gray-200">
              Audio Language:
            </label>
            <select
              id="gita-audio-language"
              value={audioLanguage}
              onChange={(e) => setAudioLanguage(e.target.value as 'en' | 'te')}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="en">English</option>
              <option value="te">Telugu</option>
            </select>
          </div>

          {/* Chapter Filter */}
          <div className="flex flex-wrap gap-2 sticky top-4 z-10 bg-white/70 dark:bg-gray-800/70 backdrop-blur rounded-lg p-2">
            <button
              onClick={() => setSelectedChapter(null)}
              className={`px-4 py-2 rounded-lg ${
                selectedChapter === null
                  ? 'bg-amber-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            >
              All Chapters
            </button>

            {chapters.map((chapter) => (
              <button
                key={chapter}
                onClick={() => setSelectedChapter(chapter)}
                className={`px-4 py-2 rounded-lg ${
                  selectedChapter === chapter
                    ? 'bg-amber-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {chapter}
              </button>
            ))}
          </div>
        </div>

        {/* Verses */}
        <div className="space-y-6">
          {visibleVerses.map((verse) => (
            <div
              key={verse.id}
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-amber-100 dark:border-gray-700"
            >
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center h-8 px-3 text-xs font-semibold rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                    Chapter {verse.chapter}
                  </span>
                  <span className="inline-flex items-center h-8 px-3 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                    Verse {verse.verse}
                  </span>
                </div>

                <div className="flex gap-2">
                  {/* Speak */}
                  <button
                    onClick={() => {
                      void handleSpeak(verse);
                    }}
                    disabled={
                      isSpeaking ||
                      (audioLanguage === 'te' && loadingExplanationId === String(verse.id))
                    }
                    className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                  >
                    <Volume2 className="h-5 w-5" />
                  </button>

                  {/* Favorite */}
                  <button
                    onClick={() => toggleFavorite('gita', String(verse.id))}
                    className={`p-2 rounded-full ${
                      isFavorite('gita', String(verse.id))
                        ? 'bg-amber-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <Heart
                      className={`h-5 w-5 ${
                        isFavorite('gita', String(verse.id))
                          ? 'fill-current'
                          : ''
                      }`}
                    />
                  </button>

                  {/* Telugu Explanation */}
                  <button
                    onClick={() => handleTeluguExplanation(verse)}
                    disabled={loadingExplanationId === String(verse.id)}
                    className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 disabled:opacity-50 transition-colors duration-200"
                    aria-label="Explain in Telugu"
                  >
                    <Languages className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.15em] text-amber-600 dark:text-amber-300 font-semibold mb-1">
                    Sloka (Sanskrit)
                  </p>
                  <p className="text-2xl leading-relaxed font-serif text-gray-900 dark:text-gray-100">
                    {verse.sanskrit || ''}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.15em] text-gray-500 dark:text-gray-400 font-semibold mb-1">
                    Transliteration
                  </p>
                  <p className="italic text-gray-700 dark:text-gray-300">
                    {verse.transliteration || ''}
                  </p>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-100 dark:border-amber-800/50">
                  <p className="text-xs uppercase tracking-[0.15em] text-amber-700 dark:text-amber-200 font-semibold mb-1">
                    Translation ({selectedLanguage === 'en' ? 'English' : selectedLanguage === 'hi' ? 'Hindi' : 'Telugu'})
                  </p>
                  <p className="text-gray-900 dark:text-gray-100 leading-relaxed">
                    {selectedLanguage === 'en'
                      ? verse.translation_en || ''
                      : selectedLanguage === 'hi'
                      ? verse.translation_hi || ''
                      : verse.translation_te || ''}
                  </p>
                </div>
              </div>

              {verse.commentary && (
                <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-xs uppercase tracking-[0.15em] text-indigo-600 dark:text-indigo-200 font-semibold mb-1">
                    Explanation
                  </p>
                  <p className="text-gray-800 dark:text-gray-200 leading-relaxed">
                    {verse.commentary}
                  </p>
                </div>
              )}

              <div className="mt-5 pt-4 border-t border-blue-200 dark:border-blue-900/50">
                <p className="text-xs uppercase tracking-[0.15em] text-blue-700 dark:text-blue-200 font-semibold mb-1">
                  Telugu Explanation
                </p>
                <p className="text-gray-900 dark:text-gray-100 leading-relaxed">
                  {verse.translation_te?.trim() ||
                    teluguExplanations[String(verse.id)] ||
                    (loadingExplanationId === String(verse.id)
                      ? 'Generating Telugu explanation...'
                      : 'Preparing Telugu explanation...')}
                </p>
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center pt-4">
              <button
                onClick={() => setVisibleCount((c) => c + 20)}
                className="px-5 py-2 rounded-full bg-amber-600 text-white hover:bg-amber-700 transition"
              >
                Load more
              </button>
            </div>
          )}

          {filteredVerses.length === 0 && (
            <div className="text-center text-gray-600 dark:text-gray-300 py-10">
              No verses match your search yet. Try a different keyword or chapter.
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

