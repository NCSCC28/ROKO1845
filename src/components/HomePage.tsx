import { useEffect, useState } from 'react';
import { supabase, GitaVerse, BibleVerse, QuranAyah } from '../lib/supabase';
import { Sparkles, Volume2, Heart, BookOpen, Book, MessageCircle, Search, Brain, BarChart3, BellRing } from 'lucide-react';
import { useSpeech } from '../hooks/useSpeech';
import RokoLogo from './RokoLogo';

interface DailyVerseState {
  verse: GitaVerse | BibleVerse | QuranAyah;
  type: 'gita' | 'bible' | 'quran';
  isFallback?: boolean;
}

const STREAK_KEY = 'roko_daily_streak_v1';

export default function HomePage() {
  const [dailyVerse, setDailyVerse] = useState<DailyVerseState | null>(null);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState(1);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const { speak, isSpeaking } = useSpeech();

  useEffect(() => {
    loadDailyVerse();
    const today = getLocalDateString();
    const yesterday = getYesterdayString();

    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(STREAK_KEY) : null;
      const parsed = raw ? JSON.parse(raw) as { streak?: number; lastDate?: string; reminder?: boolean } : {};
      const savedStreak = Number(parsed.streak) || 1;
      const savedDate = parsed.lastDate;
      let nextStreak = 1;

      if (savedDate === today) {
        nextStreak = savedStreak;
      } else if (savedDate === yesterday) {
        nextStreak = savedStreak + 1;
      }

      setStreak(nextStreak);
      setReminderEnabled(Boolean(parsed.reminder));

      if (typeof window !== 'undefined') {
        localStorage.setItem(
          STREAK_KEY,
          JSON.stringify({ streak: nextStreak, lastDate: today, reminder: Boolean(parsed.reminder) })
        );
      }
    } catch (err) {
      console.error('Error loading streak state', err);
      setStreak(1);
      setReminderEnabled(false);
    }
  }, []);

  const getLocalDateString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getYesterdayString = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const persistStreakState = (currentStreak: number, reminder: boolean) => {
    if (typeof window === 'undefined') return;
    const today = getLocalDateString();
    localStorage.setItem(
      STREAK_KEY,
      JSON.stringify({ streak: currentStreak, lastDate: today, reminder })
    );
  };

  const handleReminderToggle = (checked: boolean) => {
    setReminderEnabled(checked);
    persistStreakState(streak, checked);
  };

  const fetchVerseFromDailyRow = async (verseType: string, verseId: string): Promise<DailyVerseState | null> => {
    if (verseType === 'gita') {
      const { data: verse } = await supabase
        .from('gita_verses')
        .select('*')
        .eq('id', verseId)
        .maybeSingle();

      if (verse) {
        return { verse, type: 'gita' };
      }
      return null;
    }

    if (verseType === 'bible') {
      const { data: verse } = await supabase
        .from('bible_verses')
        .select('*')
        .eq('id', verseId)
        .maybeSingle();

      if (verse) {
        return { verse, type: 'bible' };
      }
      return null;
    }

    if (verseType === 'quran') {
      const verseIdNumber = Number(verseId);
      const { data: verse } = await supabase
        .from('quran_ayahs')
        .select('*')
        .eq('id', Number.isFinite(verseIdNumber) ? verseIdNumber : verseId)
        .maybeSingle();

      if (verse) {
        return { verse, type: 'quran' };
      }
      return null;
    }

    return null;
  };

  const loadFallbackDailyVerse = async (seedDate: string): Promise<DailyVerseState | null> => {
    const seed = Number(seedDate.replace(/-/g, '')) || Date.now();
    const sources: Array<'gita' | 'bible' | 'quran'> = ['gita', 'bible', 'quran'];
    const offset = Math.abs(seed) % sources.length;
    const sourcePriority = [...sources.slice(offset), ...sources.slice(0, offset)];

    for (const source of sourcePriority) {
      if (source === 'gita') {
        const { count, error: countError } = await supabase
          .from('gita_verses')
          .select('id', { count: 'exact', head: true });

        if (countError || !count || count <= 0) {
          continue;
        }

        const index = seed % count;
        const { data: verse } = await supabase
          .from('gita_verses')
          .select('*')
          .order('created_at', { ascending: true })
          .range(index, index)
          .maybeSingle();

        if (verse) {
          return { verse, type: 'gita', isFallback: true };
        }
      } else if (source === 'bible') {
        const { count, error: countError } = await supabase
          .from('bible_verses')
          .select('id', { count: 'exact', head: true });

        if (countError || !count || count <= 0) {
          continue;
        }

        const index = seed % count;
        const { data: verse } = await supabase
          .from('bible_verses')
          .select('*')
          .order('created_at', { ascending: true })
          .range(index, index)
          .maybeSingle();

        if (verse) {
          return { verse, type: 'bible', isFallback: true };
        }
      } else {
        const { count, error: countError } = await supabase
          .from('quran_ayahs')
          .select('id', { count: 'exact', head: true });

        if (countError || !count || count <= 0) {
          continue;
        }

        const index = seed % count;
        const { data: verse } = await supabase
          .from('quran_ayahs')
          .select('*')
          .order('id', { ascending: true })
          .range(index, index)
          .maybeSingle();

        if (verse) {
          return { verse, type: 'quran', isFallback: true };
        }
      }
    }

    return null;
  };

  const loadDailyVerse = async () => {
    try {
      const today = getLocalDateString();
      const { data: dailyData } = await supabase
        .from('daily_verses')
        .select('*')
        .eq('date', today)
        .maybeSingle();

      let resolvedVerse: DailyVerseState | null = null;
      if (dailyData?.verse_type && dailyData?.verse_id) {
        resolvedVerse = await fetchVerseFromDailyRow(dailyData.verse_type, dailyData.verse_id);
      }

      if (!resolvedVerse) {
        resolvedVerse = await loadFallbackDailyVerse(today);
      }

      setDailyVerse(resolvedVerse);
    } catch (error) {
      console.error('Error loading daily verse:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSpeak = () => {
    if (!dailyVerse) return;

    if (dailyVerse.type === 'gita') {
      const verse = dailyVerse.verse as GitaVerse;
      speak(`${verse.transliteration}. ${verse.translation_en}`, 'en-US');
    } else if (dailyVerse.type === 'bible') {
      const verse = dailyVerse.verse as BibleVerse;
      speak(verse.text, 'en-US');
    } else {
      const ayah = dailyVerse.verse as QuranAyah;
      const text = (ayah.ayah_en ?? ayah.ayah_ar ?? '').trim();
      if (text) {
        speak(text, ayah.ayah_en ? 'en-US' : 'ar-SA');
      }
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-100 via-stone-100 to-amber-50 dark:from-slate-950 dark:via-slate-900 dark:to-zinc-900 transition-colors duration-300">
      <div className="pointer-events-none absolute -left-24 -top-28 h-96 w-96 rounded-full bg-amber-300/30 blur-3xl dark:bg-amber-500/20"></div>
      <div className="pointer-events-none absolute -right-20 top-24 h-96 w-96 rounded-full bg-cyan-300/25 blur-3xl dark:bg-cyan-500/20"></div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-amber-200/20 to-transparent dark:from-amber-800/10"></div>

      <div className="relative max-w-7xl mx-auto px-4 py-10 sm:px-6 lg:px-8">
        <section className="mb-10">
          <div className="rounded-3xl border border-white/50 dark:border-slate-700/60 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl shadow-2xl p-8 sm:p-10">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]">
              <Sparkles className="h-3.5 w-3.5" />
              Realm of Knowledge and Oneness
            </div>

            <h1 className="mt-5 text-5xl sm:text-6xl lg:text-7xl font-serif font-bold text-slate-900 dark:text-white tracking-tight">
              ROKO
            </h1>

            <div className="mt-5 max-w-3xl">
              <RokoLogo className="w-full h-auto rounded-2xl shadow-md" />
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-200 px-4 py-2 text-sm font-medium border border-slate-200 dark:border-slate-700">
                <MessageCircle className="h-4 w-4" />
                AI Bot
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-200 px-4 py-2 text-sm font-medium border border-slate-200 dark:border-slate-700">
                <Brain className="h-4 w-4" />
                Daily Wisdom
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-200 px-4 py-2 text-sm font-medium border border-slate-200 dark:border-slate-700">
                <BarChart3 className="h-4 w-4" />
                Adaptive Quiz
              </span>
            </div>
          </div>
        </section>

        <section className="mb-12">
          <div className="flex items-center justify-center gap-2 mb-5">
            <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h2 className="text-2xl sm:text-3xl font-serif font-semibold text-slate-900 dark:text-white">
              Verse of the Day
            </h2>
            <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>

          {loading ? (
            <div className="rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-white/50 dark:border-slate-700/60 shadow-xl p-8 text-center">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-2/3 mx-auto"></div>
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mx-auto"></div>
              </div>
            </div>
          ) : dailyVerse ? (
            <div className="rounded-3xl bg-white/75 dark:bg-slate-900/75 border border-white/50 dark:border-slate-700/60 shadow-2xl p-8 sm:p-10">
              {dailyVerse.isFallback && (
                <p className="text-xs font-medium uppercase tracking-wider text-cyan-700 dark:text-cyan-300 mb-4">
                  Auto-selected verse for today
                </p>
              )}
              {dailyVerse.type === 'gita' ? (
                <>
                  <p className="text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-3">
                    Bhagavad Gita {(dailyVerse.verse as GitaVerse).chapter}:{(dailyVerse.verse as GitaVerse).verse}
                  </p>
                  <p className="text-3xl font-serif text-slate-900 dark:text-slate-100 mb-4 leading-relaxed">
                    {(dailyVerse.verse as GitaVerse).sanskrit}
                  </p>
                  <p className="text-lg text-slate-600 dark:text-slate-400 italic mb-4">
                    {(dailyVerse.verse as GitaVerse).transliteration}
                  </p>
                  <p className="text-lg text-slate-700 dark:text-slate-300 leading-relaxed">
                    {(dailyVerse.verse as GitaVerse).translation_en}
                  </p>
                  {(dailyVerse.verse as GitaVerse).commentary && (
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-5 pt-5 border-t border-slate-200 dark:border-slate-700 leading-relaxed">
                      {(dailyVerse.verse as GitaVerse).commentary}
                    </p>
                  )}
                </>
              ) : dailyVerse.type === 'bible' ? (
                <>
                  <p className="text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-3">
                    {(dailyVerse.verse as BibleVerse).book} {(dailyVerse.verse as BibleVerse).chapter}:{(dailyVerse.verse as BibleVerse).verse}
                  </p>
                  <p className="text-lg text-slate-700 dark:text-slate-300 leading-relaxed">
                    {(dailyVerse.verse as BibleVerse).text}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-3">
                    Quran {(dailyVerse.verse as QuranAyah).surah_no}:{(dailyVerse.verse as QuranAyah).ayah_no_surah}
                  </p>
                  {(dailyVerse.verse as QuranAyah).ayah_ar && (
                    <p dir="rtl" className="text-right text-2xl text-slate-900 dark:text-slate-100 mb-4 leading-loose">
                      {(dailyVerse.verse as QuranAyah).ayah_ar}
                    </p>
                  )}
                  <p className="text-lg text-slate-700 dark:text-slate-300 leading-relaxed">
                    {(dailyVerse.verse as QuranAyah).ayah_en}
                  </p>
                </>
              )}

              <div className="mt-7 flex justify-center">
                <button
                  onClick={handleSpeak}
                  disabled={isSpeaking}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-400 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  <Volume2 className="h-5 w-5" />
                  <span className="font-medium">{isSpeaking ? 'Speaking...' : 'Listen'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-white/50 dark:border-slate-700/60 shadow-xl p-8 text-center">
              <p className="text-slate-600 dark:text-slate-400">No verse available for today.</p>
            </div>
          )}
        </section>

        <section className="grid md:grid-cols-3 gap-6 mb-10">
          <div className="rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-white/40 dark:border-slate-700/60 p-7 shadow-xl hover:shadow-2xl transition-all duration-300">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 mb-4">
              <BookOpen className="h-5 w-5" />
            </div>
            <h3 className="text-2xl font-serif font-semibold text-slate-900 dark:text-white mb-2">Bhagavad Gita</h3>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
              Explore core teachings on dharma, karma, wisdom, and devotion through 18 chapters.
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">18 Chapters | Sanskrit, English, Hindi, Telugu</p>
          </div>

          <div className="rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-white/40 dark:border-slate-700/60 p-7 shadow-xl hover:shadow-2xl transition-all duration-300">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 mb-4">
              <Book className="h-5 w-5" />
            </div>
            <h3 className="text-2xl font-serif font-semibold text-slate-900 dark:text-white mb-2">The Bible</h3>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
              Read key verses from Old and New Testament focused on faith, love, forgiveness, and purpose.
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">66 Books | Old & New Testament</p>
          </div>

          <div className="rounded-3xl bg-white/70 dark:bg-slate-900/70 border border-white/40 dark:border-slate-700/60 p-7 shadow-xl hover:shadow-2xl transition-all duration-300">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 mb-4">
              <Sparkles className="h-5 w-5" />
            </div>
            <h3 className="text-2xl font-serif font-semibold text-slate-900 dark:text-white mb-2">The Quran</h3>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
              Discover Surah and Ayah teachings on mercy, patience, justice, gratitude, and spiritual discipline.
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">114 Surahs | Arabic & English</p>
          </div>
        </section>

        <section className="rounded-3xl bg-gradient-to-r from-amber-100/90 to-orange-100/90 dark:from-amber-900/20 dark:to-orange-900/20 border border-amber-200/50 dark:border-amber-800/30 p-8 shadow-xl">
          <h3 className="text-2xl font-serif font-semibold text-slate-900 dark:text-white mb-6 text-center">What You Can Do in ROKO</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-white/90 dark:bg-slate-800 mx-auto flex items-center justify-center shadow-md mb-3">
                <Volume2 className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h4 className="font-semibold text-slate-900 dark:text-white mb-1">Audio Guidance</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">Listen to verses in different languages with one-click playback.</p>
            </div>
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-white/90 dark:bg-slate-800 mx-auto flex items-center justify-center shadow-md mb-3">
                <Search className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h4 className="font-semibold text-slate-900 dark:text-white mb-1">Semantic Search</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">Find verses by meaning and concept, with optional cross-scripture results.</p>
            </div>
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-white/90 dark:bg-slate-800 mx-auto flex items-center justify-center shadow-md mb-3">
                <MessageCircle className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h4 className="font-semibold text-slate-900 dark:text-white mb-1">AI Comparison</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">Compare how Gita, Bible, and Quran approach the same life topic.</p>
            </div>
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-white/90 dark:bg-slate-800 mx-auto flex items-center justify-center shadow-md mb-3">
                <BarChart3 className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h4 className="font-semibold text-slate-900 dark:text-white mb-1">Gamified Quiz</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">Play level-based timed quizzes with XP, streaks, leaderboard, and certificates.</p>
            </div>
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-white/90 dark:bg-slate-800 mx-auto flex items-center justify-center shadow-md mb-3">
                <BellRing className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h4 className="font-semibold text-slate-900 dark:text-white mb-1">Daily Streaks</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Keep your study momentum. Current streak: <span className="font-semibold">{streak} day{streak === 1 ? '' : 's'}</span>.
              </p>
              <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 border border-amber-200/60 dark:border-amber-800/50 rounded-full px-3 py-1 bg-white/80 dark:bg-slate-800/80 shadow-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={reminderEnabled}
                  onChange={(e) => handleReminderToggle(e.target.checked)}
                  className="h-4 w-4 accent-amber-500"
                />
                Remind me daily
              </label>
            </div>
            <div className="text-center">
              <div className="h-14 w-14 rounded-full bg-white/90 dark:bg-slate-800 mx-auto flex items-center justify-center shadow-md mb-3">
                <Heart className="h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h4 className="font-semibold text-slate-900 dark:text-white mb-1">Save Favorites</h4>
              <p className="text-sm text-slate-600 dark:text-slate-400">Build your personal collection of meaningful verses for daily reflection.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
