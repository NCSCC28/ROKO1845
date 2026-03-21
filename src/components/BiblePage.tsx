import { useEffect, useState, useCallback } from 'react';
import { supabase, BibleVerse } from '../lib/supabase';
import { Volume2, Heart, Search, Book, Languages } from 'lucide-react';
import { useSpeech } from '../hooks/useSpeech';
import useFavorites from '../hooks/useFavorites';
import { generateTeluguExplanation } from '../utils/teluguNlp';
import { generateBriefVerseExplanation } from '../utils/verseExplanation';
import { askOpenRouter } from '../utils/geminiAi';
import { bibleBooks } from '../data/bibleBooks';

export default function BiblePage() {
  const [verses, setVerses] = useState<BibleVerse[]>([]);
  const [filteredVerses, setFilteredVerses] = useState<BibleVerse[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBook, setSelectedBook] = useState<string | null>(bibleBooks[0]?.name ?? null);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [selectedTestament, setSelectedTestament] = useState<'All' | 'Old' | 'New'>('All');
  const [audioLanguage, setAudioLanguage] = useState<'en' | 'te'>('en');
  const [searchQuery, setSearchQuery] = useState('');
  const [topicQuery, setTopicQuery] = useState('');
  const [semanticKeywords, setSemanticKeywords] = useState<string[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [teluguExplanations, setTeluguExplanations] = useState<Record<string, string>>({});
  const [loadingExplanationId, setLoadingExplanationId] = useState<string | null>(null);
  const { speak, isSpeaking } = useSpeech();
  const { toggleFavorite, isFavorite } = useFavorites();
  const [availableBooks, setAvailableBooks] = useState<{ name: string; testament: 'Old' | 'New' }[]>([]);

  useEffect(() => {
    // Use static list to avoid repeated/duplicate books; fallback extras are added below.
    setAvailableBooks(bibleBooks);
    if (!selectedBook && bibleBooks.length > 0) {
      setSelectedBook(bibleBooks[0].name);
    }
  }, []);

  useEffect(() => {
    // whenever book or testament changes, fetch verses for that scope
    loadVerses(selectedBook, selectedTestament);
  }, [selectedBook, selectedTestament]);

  const loadVerses = async (book: string | null, testament: 'All' | 'Old' | 'New') => {
    try {
      setLoading(true);

      const query = supabase
        .from('bible_verses')
        .select('*')
        .order('book', { ascending: true })
        .order('chapter', { ascending: true })
        .order('verse', { ascending: true });

      if (book) {
        query.eq('book', book);
      }

      if (testament !== 'All') {
        query.eq('testament', testament);
      }

      // cap rows so payload stays light; enough for largest single book (Psalms 150 chapters)
      query.limit(3000);

      const { data, error } = await query;

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

  const baseTopicMap: Record<string, string[]> = {
    love: ['love', 'loving', 'beloved', 'charity'],
    faith: ['faith', 'believe', 'belief', 'trust'],
    anger: ['anger', 'angry', 'wrath', 'rage'],
    wisdom: ['wisdom', 'wise', 'understanding'],
    peace: ['peace', 'calm', 'rest'],
    hope: ['hope', 'hopeful'],
    anxiety: ['anxiety', 'anxious', 'worry', 'worried', 'fear'],
    forgiveness: ['forgive', 'forgiveness', 'mercy', 'grace'],
  };

  const filterVerses = useCallback(() => {
    let filtered = verses;

    if (selectedTestament !== 'All') {
      filtered = filtered.filter(v => v.testament === selectedTestament);
    }

    if (selectedBook) {
      filtered = filtered.filter(v => v.book === selectedBook);
    }

    if (selectedChapter !== null) {
      filtered = filtered.filter(v => v.chapter === selectedChapter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(v =>
        v.text.toLowerCase().includes(query) ||
        v.book.toLowerCase().includes(query)
      );
    }

    // Topic & semantic keywords
    const topicTerms = new Set<string>();
    const normalizedTopic = topicQuery.trim().toLowerCase();
    if (normalizedTopic) {
      normalizedTopic.split(/\s+/).forEach((word) => {
        if (word.length >= 3) topicTerms.add(word);
      });
      if (baseTopicMap[normalizedTopic]) {
        baseTopicMap[normalizedTopic].forEach((w) => topicTerms.add(w));
      }
    }
    semanticKeywords.forEach((k) => topicTerms.add(k.toLowerCase()));

    if (topicTerms.size > 0) {
      filtered = filtered.filter((v) => {
        const text = `${v.text} ${v.book}`.toLowerCase();
        for (const term of topicTerms) {
          if (text.includes(term)) return true;
        }
        return false;
      });
    }

    setFilteredVerses(filtered);
  }, [selectedBook, selectedChapter, selectedTestament, searchQuery, topicQuery, semanticKeywords, verses]);

  useEffect(() => {
    filterVerses();
  }, [filterVerses]);

  const ensureTeluguExplanation = useCallback(async (verse: BibleVerse) => {
    const verseId = verse.id;
    if (teluguExplanations[verseId]) {
      return teluguExplanations[verseId];
    }

    const sourceText = generateBriefVerseExplanation(
      'bible',
      verse.text,
      `${verse.book} ${verse.chapter}:${verse.verse}`
    );
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

  const handleTeluguExplanation = useCallback(async (verse: BibleVerse) => {
    await ensureTeluguExplanation(verse);
  }, [ensureTeluguExplanation]);

  const handleSemanticBoost = async () => {
    const basePrompt = topicQuery || searchQuery;
    if (!basePrompt.trim()) return;
    try {
      setSemanticLoading(true);
      const response = await askOpenRouter(
        `Suggest 5 short keywords to find Bible verses about "${basePrompt}". 
Return a comma-separated list of single words.`
      );
      const keywords = response
        .split(/[,;\n]/)
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 2);
      setSemanticKeywords(keywords.slice(0, 8));
    } catch (e) {
      console.error('Semantic search failed', e);
      setSemanticKeywords([]);
    } finally {
      setSemanticLoading(false);
    }
  };

  const clearFilters = () => {
    setSelectedTestament('All');
    setSelectedBook(null);
    setSelectedChapter(null);
    setSearchQuery('');
    setTopicQuery('');
    setSemanticKeywords([]);
  };

  const handleSpeak = useCallback(async (verse: BibleVerse) => {
    const reference = `${verse.book} ${verse.chapter}:${verse.verse}`;
    const briefExplanation = generateBriefVerseExplanation('bible', verse.text, reference);

    if (audioLanguage === 'te') {
      const explanation = await ensureTeluguExplanation(verse);
      if (!explanation) {
        return;
      }

      speak(explanation, 'te-IN');
      return;
    }

    speak(`${reference}. ${verse.text} Brief explanation: ${briefExplanation}`, 'en-US');
  }, [audioLanguage, ensureTeluguExplanation, speak]);

  const bookButtons = (() => {
    const base = availableBooks
      .filter((book) => selectedTestament === 'All' || book.testament === selectedTestament)
      .map((book) => book.name);

    // include any unexpected book names discovered in data (defensive)
    const extras = Array.from(new Set(verses.map((v) => v.book))).filter(
      (book) =>
        !base.includes(book) &&
        (selectedTestament === 'All' || verses.find((v) => v.book === book)?.testament === selectedTestament)
    );

    return [...base, ...extras];
  })();

  let chapterOptions = Array.from(
    new Set(
      verses
        .filter((v) => (selectedTestament === 'All' ? true : v.testament === selectedTestament))
        .filter((v) => (selectedBook ? v.book === selectedBook : true))
        .map((v) => v.chapter)
    )
  ).sort((a, b) => a - b);

  if (chapterOptions.length === 0 && selectedBook) {
    const meta = bibleBooks.find((b) => b.name === selectedBook);
    if (meta) {
      chapterOptions = Array.from({ length: meta.chapters }, (_, idx) => idx + 1);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading verses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-sky-50 to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center space-x-3 mb-8">
          <Book className="h-10 w-10 text-blue-600 dark:text-blue-500" />
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">The Bible</h1>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 mb-8">
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search verses by keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="mb-4 space-y-3">
            <div className="flex gap-3 flex-col sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Topic or natural language (e.g., anxiety, forgiveness, peace)"
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
              {['love', 'faith', 'anxiety', 'peace', 'wisdom', 'anger', 'forgiveness', 'hope'].map((topic) => (
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

          <div className="mb-4">
            <div className="flex space-x-2">
              {(['All', 'Old', 'New'] as const).map(testament => (
                <button
                  key={testament}
                  onClick={() => {
                    setSelectedTestament(testament);
                    setSelectedBook(null);
                    setSelectedChapter(null);
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                    selectedTestament === testament
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {testament === 'All' ? 'All' : `${testament} Testament`}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 max-w-xs">
            <label htmlFor="bible-audio-language" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Audio Language
            </label>
            <select
              id="bible-audio-language"
              value={audioLanguage}
              onChange={(e) => setAudioLanguage(e.target.value as 'en' | 'te')}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="en">English</option>
              <option value="te">Telugu</option>
            </select>
          </div>

          {chapterOptions.length > 0 && (
            <div className="mb-4 max-w-xs">
              <label htmlFor="bible-chapter-filter" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Chapter
              </label>
              <select
                id="bible-chapter-filter"
                value={selectedChapter ?? 'all'}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedChapter(value === 'all' ? null : Number.parseInt(value, 10));
                }}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="all">All Chapters</option>
                {chapterOptions.map((chapter) => (
                  <option key={chapter} value={chapter}>
                    Chapter {chapter}
                  </option>
                ))}
              </select>
            </div>
          )}

          {bookButtons.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setSelectedBook(null);
                  setSelectedChapter(null);
                }}
                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                  selectedBook === null
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                All Books
              </button>
              {bookButtons
                .filter(book => {
                  if (selectedTestament === 'All') return true;
                  const meta = bibleBooks.find((b) => b.name === book);
                  if (meta) return meta.testament === selectedTestament;
                  const verse = verses.find((v) => v.book === book);
                  return verse?.testament === selectedTestament;
                })
                .map(book => (
                  <button
                    key={book}
                    onClick={() => {
                      setSelectedBook(book);
                      setSelectedChapter(null);
                    }}
                    className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      selectedBook === book
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {book}
                  </button>
                ))}
            </div>
          )}

          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            Showing {filteredVerses.length} verse{filteredVerses.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="space-y-6">
          {filteredVerses.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center">
              <p className="text-gray-600 dark:text-gray-400">No verses found matching your search.</p>
            </div>
          ) : (
            filteredVerses.map((verse) => (
              <div
                key={verse.id}
                className={`bg-white/95 dark:bg-gray-800/90 rounded-2xl shadow-[0_14px_44px_-22px_rgba(0,0,0,0.55)] hover:shadow-[0_18px_56px_-22px_rgba(0,0,0,0.6)] transition-all duration-300 border-l-4 ${
                  verse.testament === 'Old' ? 'border-blue-500/80' : 'border-emerald-500/80'
                }`}
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {verse.book} {verse.chapter}:{verse.verse} ({verse.testament} Testament)
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => {
                        void handleSpeak(verse);
                      }}
                      disabled={isSpeaking || (audioLanguage === 'te' && loadingExplanationId === verse.id)}
                      className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-500 transition-colors duration-200 disabled:opacity-50"
                      aria-label="Play audio"
                    >
                      <Volume2 className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => toggleFavorite('bible', verse.id)}
                      className={`p-2 rounded-full transition-colors duration-200 ${
                        isFavorite('bible', verse.id)
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300'
                      }`}
                      aria-label="Toggle favorite"
                    >
                      <Heart className={`h-5 w-5 ${isFavorite('bible', verse.id) ? 'fill-current' : ''}`} />
                    </button>
                    <button
                      onClick={() => handleTeluguExplanation(verse)}
                      disabled={loadingExplanationId === verse.id}
                      className="p-2 rounded-full bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors duration-200 disabled:opacity-50"
                      aria-label="Explain in Telugu"
                    >
                      <Languages className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <p className="mt-4 text-lg text-gray-800 dark:text-gray-100 leading-relaxed">
                  {verse.text}
                </p>

                <div className="mt-6 pt-4 border-t border-blue-200 dark:border-blue-900/40">
                  <p className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-1">
                    Brief Explanation
                  </p>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                    {generateBriefVerseExplanation(
                      'bible',
                      verse.text,
                      `${verse.book} ${verse.chapter}:${verse.verse}`
                    )}
                  </p>
                </div>

                {teluguExplanations[verse.id] && (
                  <div className="mt-4 pt-4 border-t border-emerald-200 dark:border-emerald-900/40">
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                      Telugu Explanation
                    </p>
                    <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
                      {teluguExplanations[verse.id]}
                    </p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
