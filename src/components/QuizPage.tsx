import { useCallback, useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import { supabase } from '../lib/supabase';
import {
  Brain,
  CheckCircle,
  Clock3,
  Download,
  RotateCw,
  Sparkles,
  BookOpen,
  Trophy,
  User,
  XCircle,
} from 'lucide-react';

type Religion = 'gita' | 'bible' | 'quran';
type Difficulty = 'easy' | 'medium' | 'hard' | 'all';
type OptionKey = 'A' | 'B' | 'C' | 'D';
type QuizSourceMode = 'database' | 'ai_generated';
type QuizLevel = 'beginner' | 'intermediate' | 'advanced' | 'scholar';

interface QuizQuestion {
  id: string;
  religion: Religion;
  category: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: OptionKey;
  explanation: string;
  difficulty: Exclude<Difficulty, 'all'>;
  source: QuizSourceMode;
  reference?: string;
}

interface QuizState {
  currentQuestion: number;
  selectedAnswer: OptionKey | null;
  answered: boolean;
  score: number;
  totalQuestions: number;
  streak: number;
  bestStreak: number;
  xp: number;
}

interface LevelMeta {
  label: string;
  description: string;
  difficulty: Difficulty;
  defaultQuestions: number;
  defaultTimerSeconds: number;
  passScore: number;
}

interface ReligionMeta {
  label: string;
  description: string;
  pillClass: string;
  selectedClass: string;
}

interface LeaderboardEntry {
  id: string;
  playerName: string;
  religion: Religion;
  level: QuizLevel;
  sourceMode: QuizSourceMode;
  timedMode: boolean;
  score: number;
  totalQuestions: number;
  scorePercentage: number;
  durationSeconds: number;
  createdAt: string;
}

interface AiReference {
  reference: string;
  text: string;
  category: string;
}

const RELIGION_ORDER: Religion[] = ['gita', 'bible', 'quran'];
const LEVEL_ORDER: QuizLevel[] = ['beginner', 'intermediate', 'advanced', 'scholar'];
const OPTION_KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];
const MIN_QUESTIONS = 4;
const MAX_QUESTIONS = 25;
const LEADERBOARD_KEY = 'roko_quiz_leaderboard_v2';
const PLAYER_NAME_KEY = 'roko_quiz_player_name_v1';

const RELIGION_META: Record<Religion, ReligionMeta> = {
  gita: {
    label: 'Bhagavad Gita',
    description: 'Krishna teachings, yoga paths, and dharma-based decisions.',
    pillClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    selectedClass:
      'ring-2 ring-amber-400 bg-gradient-to-r from-amber-500 to-orange-500 text-white border-transparent',
  },
  bible: {
    label: 'The Bible',
    description: 'Biblical history, wisdom literature, and teachings of Jesus.',
    pillClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    selectedClass:
      'ring-2 ring-blue-400 bg-gradient-to-r from-blue-500 to-indigo-500 text-white border-transparent',
  },
  quran: {
    label: 'The Quran',
    description: 'Surah foundations, prophetic stories, ethics, and worship.',
    pillClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    selectedClass:
      'ring-2 ring-emerald-400 bg-gradient-to-r from-emerald-500 to-teal-500 text-white border-transparent',
  },
};

const LEVEL_META: Record<QuizLevel, LevelMeta> = {
  beginner: {
    label: 'Beginner',
    description: 'Foundational recall and straightforward references.',
    difficulty: 'easy',
    defaultQuestions: 8,
    defaultTimerSeconds: 40,
    passScore: 60,
  },
  intermediate: {
    label: 'Intermediate',
    description: 'Balanced understanding with moderate challenge.',
    difficulty: 'medium',
    defaultQuestions: 10,
    defaultTimerSeconds: 32,
    passScore: 70,
  },
  advanced: {
    label: 'Advanced',
    description: 'Deep concepts, tighter distractors.',
    difficulty: 'hard',
    defaultQuestions: 12,
    defaultTimerSeconds: 26,
    passScore: 80,
  },
  scholar: {
    label: 'Scholar',
    description: 'Mixed high-pressure challenge mode.',
    difficulty: 'all',
    defaultQuestions: 15,
    defaultTimerSeconds: 22,
    passScore: 85,
  },
};

function shuffleArray<T>(items: T[]): T[] {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function clampQuestionCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 8;
  }
  return Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, Math.trunc(value)));
}

function getQuestionMax(availableCount: number | null): number {
  if (availableCount === null) return MAX_QUESTIONS;
  if (availableCount <= 0) return MIN_QUESTIONS;
  return Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, availableCount));
}

function formatCategory(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getDifficultyLabel(difficulty: Difficulty): string {
  return difficulty === 'all' ? 'Mixed' : `${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)}`;
}

function getSourceLabel(mode: QuizSourceMode): string {
  return mode === 'database' ? 'Database' : 'AI Generated';
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.trunc(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getScoreMessage(scorePercentage: number, passScore: number): string {
  if (scorePercentage >= passScore + 10) {
    return 'Outstanding performance. Strong command of key themes and references.';
  }
  if (scorePercentage >= passScore) {
    return 'Great result. You cleared this level successfully.';
  }
  if (scorePercentage >= Math.max(passScore - 12, 50)) {
    return 'Close call. One more focused attempt should clear this level.';
  }
  return 'Good effort. Review concepts and references, then try again.';
}

function getAchievementBadge(scorePercentage: number, bestStreak: number, hasPassed: boolean): string {
  if (!hasPassed) {
    return bestStreak >= 3 ? 'Persistent Seeker' : 'Learning Explorer';
  }

  if (scorePercentage >= 95 || bestStreak >= 6) {
    return 'Scripture Champion';
  }

  if (scorePercentage >= 85 || bestStreak >= 4) {
    return 'Wisdom Guardian';
  }

  return 'Steady Learner';
}

function parseLeaderboard(raw: string | null): LeaderboardEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LeaderboardEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (b.scorePercentage !== a.scorePercentage) return b.scorePercentage - a.scorePercentage;
    if (b.score !== a.score) return b.score - a.score;
    if (a.durationSeconds !== b.durationSeconds) return a.durationSeconds - b.durationSeconds;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function truncate(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const sliced = clean.slice(0, maxChars);
  const breakAt = sliced.lastIndexOf(' ');
  return `${(breakAt > 40 ? sliced.slice(0, breakAt) : sliced).trim()}...`;
}

function getAiExcerptLength(difficulty: Exclude<Difficulty, 'all'>): number {
  if (difficulty === 'easy') return 180;
  if (difficulty === 'medium') return 130;
  return 95;
}

function getAiPrompt(difficulty: Exclude<Difficulty, 'all'>): string {
  if (difficulty === 'easy') return 'AI-generated: Identify the correct reference for this passage.';
  if (difficulty === 'medium') return 'AI-generated: Which reference best matches this excerpt?';
  return 'AI-generated: Select the exact reference for this short excerpt.';
}

async function fetchAiReferencePool(religion: Religion): Promise<AiReference[]> {
  if (religion === 'gita') {
    const { data, error } = await supabase
      .from('gita_verses')
      .select('chapter,verse,translation_en,transliteration,sanskrit')
      .limit(1500);
    if (error) throw error;

    return ((data ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const chapter = Number(row.chapter);
        const verse = Number(row.verse);
        const text = String(row.translation_en ?? row.transliteration ?? row.sanskrit ?? '').trim();
        if (!Number.isFinite(chapter) || !Number.isFinite(verse) || text.length === 0) return null;
        return {
          reference: `Gita ${chapter}:${verse}`,
          text,
          category: `chapter_${chapter}`,
        } as AiReference;
      })
      .filter((item): item is AiReference => Boolean(item));
  }

  if (religion === 'bible') {
    const { data, error } = await supabase
      .from('bible_verses')
      .select('book,chapter,verse,text,testament')
      .limit(2000);
    if (error) throw error;

    return ((data ?? []) as Array<Record<string, unknown>>)
      .map((row) => {
        const book = String(row.book ?? '').trim();
        const chapter = Number(row.chapter);
        const verse = Number(row.verse);
        const text = String(row.text ?? '').trim();
        if (!book || !Number.isFinite(chapter) || !Number.isFinite(verse) || text.length === 0) return null;
        return {
          reference: `Bible ${book} ${chapter}:${verse}`,
          text,
          category: String(row.testament ?? 'bible'),
        } as AiReference;
      })
      .filter((item): item is AiReference => Boolean(item));
  }

  const { data, error } = await supabase
    .from('quran_ayahs')
    .select('surah_no,ayah_no_surah,ayah_en,surah_name_roman,surah_name_en')
    .limit(2200);
  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const surah = String(row.surah_no ?? '').trim();
      const ayah = String(row.ayah_no_surah ?? '').trim();
      const text = String(row.ayah_en ?? '').trim();
      const surahName = String(row.surah_name_roman ?? row.surah_name_en ?? '').trim();
      if (!surah || !ayah || text.length === 0) return null;
      return {
        reference: `Quran ${surah}:${ayah}${surahName ? ` (${surahName})` : ''}`,
        text,
        category: `surah_${surah}`,
      } as AiReference;
    })
    .filter((item): item is AiReference => Boolean(item));
}

function buildAiGeneratedQuestions(
  religion: Religion,
  references: AiReference[],
  desiredCount: number,
  difficulty: Exclude<Difficulty, 'all'>
): QuizQuestion[] {
  const uniqueMap = new Map<string, AiReference>();
  for (const reference of references) {
    if (!uniqueMap.has(reference.reference)) {
      uniqueMap.set(reference.reference, reference);
    }
  }

  const pool = shuffleArray(Array.from(uniqueMap.values()));
  if (pool.length < 4) return [];

  const questionPrompt = getAiPrompt(difficulty);
  const excerptLength = getAiExcerptLength(difficulty);
  const maxQuestions = Math.min(desiredCount, pool.length);
  const generated: QuizQuestion[] = [];

  for (let i = 0; i < maxQuestions; i += 1) {
    const source = pool[i];
    const distractors = shuffleArray(pool.filter((item) => item.reference !== source.reference))
      .slice(0, 3)
      .map((item) => item.reference);
    if (distractors.length < 3) continue;

    const optionRefs = shuffleArray([source.reference, ...distractors]).slice(0, 4);
    const correctIndex = optionRefs.findIndex((item) => item === source.reference);
    if (correctIndex < 0) continue;

    generated.push({
      id: `ai-${religion}-${Date.now()}-${i}`,
      religion,
      category: 'ai_generated_reference',
      question: `${questionPrompt}\n"${truncate(source.text, excerptLength)}"`,
      option_a: optionRefs[0],
      option_b: optionRefs[1],
      option_c: optionRefs[2],
      option_d: optionRefs[3],
      correct_answer: OPTION_KEYS[correctIndex],
      explanation: `AI generated this from ${source.reference}.`,
      difficulty,
      source: 'ai_generated',
      reference: source.reference,
    });
  }

  return generated;
}

export default function QuizPage() {
  const [religion, setReligion] = useState<Religion | null>(null);
  const [level, setLevel] = useState<QuizLevel>('beginner');
  const [difficulty, setDifficulty] = useState<Difficulty>(LEVEL_META.beginner.difficulty);
  const [sourceMode, setSourceMode] = useState<QuizSourceMode>('database');
  const [category, setCategory] = useState('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [numQuestions, setNumQuestions] = useState(LEVEL_META.beginner.defaultQuestions);
  const [timedMode, setTimedMode] = useState(false);
  const [timePerQuestion, setTimePerQuestion] = useState(LEVEL_META.beginner.defaultTimerSeconds);
  const [timeLeft, setTimeLeft] = useState(0);
  const [playerName, setPlayerName] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(PLAYER_NAME_KEY) ?? '';
  });
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [quizStarted, setQuizStarted] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filteredQuestionCount, setFilteredQuestionCount] = useState<number | null>(null);
  const [questionCounts, setQuestionCounts] = useState<Record<Religion, number>>({
    gita: 0,
    bible: 0,
    quran: 0,
  });
  const [aiCounts, setAiCounts] = useState<Record<Religion, number>>({
    gita: 0,
    bible: 0,
    quran: 0,
  });
  const [quizState, setQuizState] = useState<QuizState>({
    currentQuestion: 0,
    selectedAnswer: null,
    answered: false,
    score: 0,
    totalQuestions: 0,
    streak: 0,
    bestStreak: 0,
    xp: 0,
  });
  const [showResult, setShowResult] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [optionOrder, setOptionOrder] = useState<OptionKey[]>(OPTION_KEYS);
  const [quizStartedAt, setQuizStartedAt] = useState<number | null>(null);
  const [quizFinishedAt, setQuizFinishedAt] = useState<number | null>(null);
  const [scoreSaved, setScoreSaved] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => {
    if (typeof window === 'undefined') return [];
    return sortLeaderboard(parseLeaderboard(window.localStorage.getItem(LEADERBOARD_KEY)));
  });

  const currentQuestion = questions[quizState.currentQuestion] ?? null;
  const maxSelectableQuestions = getQuestionMax(filteredQuestionCount);
  const scorePercentage =
    quizState.totalQuestions > 0 ? Math.round((quizState.score / quizState.totalQuestions) * 100) : 0;
  const progressPercentage =
    quizState.totalQuestions > 0
      ? Math.round(((quizState.currentQuestion + 1) / quizState.totalQuestions) * 100)
      : 0;
  const isQuizComplete = quizState.currentQuestion === quizState.totalQuestions - 1 && quizState.answered;
  const passScore = LEVEL_META[level].passScore;
  const hasPassed = scorePercentage >= passScore;
  const achievementBadge = getAchievementBadge(scorePercentage, quizState.bestStreak, hasPassed);
  const elapsedSeconds =
    quizStartedAt === null
      ? 0
      : Math.max(1, Math.round(((quizFinishedAt ?? Date.now()) - quizStartedAt) / 1000));
  const insufficientAiPool =
    sourceMode === 'ai_generated' && filteredQuestionCount !== null && filteredQuestionCount > 0 && filteredQuestionCount < 4;

  const totalAvailable =
    sourceMode === 'database'
      ? questionCounts.gita + questionCounts.bible + questionCounts.quran
      : aiCounts.gita + aiCounts.bible + aiCounts.quran;

  const options = useMemo(() => {
    if (!currentQuestion) return [] as Array<{ key: OptionKey; text: string }>;

    const optionMap: Record<OptionKey, string> = {
      A: currentQuestion.option_a,
      B: currentQuestion.option_b,
      C: currentQuestion.option_c,
      D: currentQuestion.option_d,
    };

    return optionOrder.map((key) => ({ key, text: optionMap[key] }));
  }, [currentQuestion, optionOrder]);

  const topLeaderboard = useMemo(() => leaderboard.slice(0, 10), [leaderboard]);

  useEffect(() => {
    const meta = LEVEL_META[level];
    setDifficulty(meta.difficulty);
    setNumQuestions(clampQuestionCount(meta.defaultQuestions));
    setTimePerQuestion(meta.defaultTimerSeconds);
  }, [level]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PLAYER_NAME_KEY, playerName);
    }
  }, [playerName]);

  useEffect(() => {
    const loadCounts = async () => {
      try {
        const dbCountEntries = await Promise.all(
          RELIGION_ORDER.map(async (item) => {
            const { count, error } = await supabase
              .from('quiz_questions')
              .select('*', { head: true, count: 'exact' })
              .eq('religion', item);
            if (error) throw error;
            return [item, count ?? 0] as const;
          })
        );

        const nextDb: Record<Religion, number> = { gita: 0, bible: 0, quran: 0 };
        for (const [item, count] of dbCountEntries) {
          nextDb[item] = count;
        }
        setQuestionCounts(nextDb);

        const [gitaRes, bibleRes, quranRes] = await Promise.all([
          supabase.from('gita_verses').select('id', { head: true, count: 'exact' }),
          supabase.from('bible_verses').select('id', { head: true, count: 'exact' }),
          supabase.from('quran_ayahs').select('id', { head: true, count: 'exact' }),
        ]);

        setAiCounts({
          gita: gitaRes.count ?? 0,
          bible: bibleRes.count ?? 0,
          quran: quranRes.count ?? 0,
        });
      } catch (error) {
        console.error('Error loading quiz counts:', error);
      }
    };

    void loadCounts();
  }, []);

  useEffect(() => {
    if (!religion || sourceMode === 'ai_generated') {
      setAvailableCategories([]);
      setCategory('all');
      return;
    }

    const loadCategories = async () => {
      setLoadingCategories(true);
      try {
        let query = supabase
          .from('quiz_questions')
          .select('category')
          .eq('religion', religion);

        if (difficulty !== 'all') {
          query = query.eq('difficulty', difficulty);
        }

        const { data, error } = await query;
        if (error) throw error;

        const categories = Array.from(
          new Set(
            ((data ?? []) as Array<{ category: string | null }>)
              .map((row) => row.category ?? '')
              .filter((item) => item.length > 0)
          )
        ).sort((a, b) => a.localeCompare(b));

        setAvailableCategories(categories);
        setCategory((prev) => (prev === 'all' || categories.includes(prev) ? prev : 'all'));
      } catch (error) {
        console.error('Error loading categories:', error);
        setAvailableCategories([]);
        setCategory('all');
      } finally {
        setLoadingCategories(false);
      }
    };

    void loadCategories();
  }, [religion, sourceMode, difficulty]);

  useEffect(() => {
    if (!religion) {
      setFilteredQuestionCount(null);
      return;
    }

    const loadFilteredCount = async () => {
      try {
        if (sourceMode === 'database') {
          let query = supabase
            .from('quiz_questions')
            .select('*', { head: true, count: 'exact' })
            .eq('religion', religion);

          if (difficulty !== 'all') {
            query = query.eq('difficulty', difficulty);
          }

          if (category !== 'all') {
            query = query.eq('category', category);
          }

          const { count, error } = await query;
          if (error) throw error;
          setFilteredQuestionCount(count ?? 0);
          return;
        }

        const tableName = religion === 'gita' ? 'gita_verses' : religion === 'bible' ? 'bible_verses' : 'quran_ayahs';
        const { count, error } = await supabase
          .from(tableName)
          .select('id', { head: true, count: 'exact' });
        if (error) throw error;
        setFilteredQuestionCount(count ?? 0);
      } catch (error) {
        console.error('Error loading filtered count:', error);
        setFilteredQuestionCount(null);
      }
    };

    void loadFilteredCount();
  }, [religion, sourceMode, difficulty, category]);

  useEffect(() => {
    if (!religion) return;
    const clamped = Math.min(maxSelectableQuestions, clampQuestionCount(numQuestions));
    if (clamped !== numQuestions) {
      setNumQuestions(clamped);
    }
  }, [religion, numQuestions, maxSelectableQuestions]);

  useEffect(() => {
    setLoadError(null);
  }, [religion, level, sourceMode, category, numQuestions, timedMode, timePerQuestion]);

  useEffect(() => {
    if (currentQuestion) {
      setOptionOrder(shuffleArray(OPTION_KEYS));
    }
  }, [currentQuestion?.id]);

  useEffect(() => {
    if (!quizStarted) return;
    if (!timedMode) {
      setTimeLeft(0);
      return;
    }
    if (!quizState.answered) {
      setTimeLeft(timePerQuestion);
    }
  }, [quizStarted, timedMode, timePerQuestion, quizState.currentQuestion, quizState.answered]);

  const handleTimeExpired = useCallback(() => {
    setQuizState((prev) => {
      if (prev.answered) return prev;
      return {
        ...prev,
        selectedAnswer: null,
        answered: true,
        streak: 0,
      };
    });
    setTimedOut(true);
    setShowResult(true);
  }, []);

  useEffect(() => {
    if (!quizStarted || !timedMode || quizState.answered || isQuizComplete) return;
    if (timeLeft <= 0) {
      handleTimeExpired();
      return;
    }

    const timer = window.setTimeout(() => {
      setTimeLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [quizStarted, timedMode, quizState.answered, isQuizComplete, timeLeft, handleTimeExpired]);

  useEffect(() => {
    if (isQuizComplete && quizFinishedAt === null) {
      setQuizFinishedAt(Date.now());
    }
  }, [isQuizComplete, quizFinishedAt]);

  const loadDatabaseQuestions = useCallback(async (requestedCount: number): Promise<QuizQuestion[]> => {
    if (!religion) return [];

    let query = supabase
      .from('quiz_questions')
      .select('*')
      .eq('religion', religion);

    if (difficulty !== 'all') {
      query = query.eq('difficulty', difficulty);
    }

    if (category !== 'all') {
      query = query.eq('category', category);
    }

    const fetchLimit = Math.max(requestedCount * 5, 60);
    const { data, error } = await query.limit(fetchLimit);
    if (error) throw error;

    const safeData = (data ?? []) as Omit<QuizQuestion, 'source'>[];
    return shuffleArray(safeData)
      .slice(0, requestedCount)
      .map((item) => ({ ...item, source: 'database' as const }));
  }, [religion, difficulty, category]);

  const loadAiQuestions = useCallback(async (requestedCount: number): Promise<QuizQuestion[]> => {
    if (!religion) return [];
    const pool = await fetchAiReferencePool(religion);
    if (pool.length < 4) return [];

    const generationDifficulty: Exclude<Difficulty, 'all'> = difficulty === 'all' ? 'medium' : difficulty;
    return buildAiGeneratedQuestions(religion, pool, requestedCount, generationDifficulty);
  }, [religion, difficulty]);

  const loadQuestions = async () => {
    if (!religion) return;

    const requestedCount = Math.min(maxSelectableQuestions, clampQuestionCount(numQuestions));
    if (requestedCount !== numQuestions) {
      setNumQuestions(requestedCount);
    }

    setLoading(true);
    setLoadError(null);

    try {
      const loadedQuestions = sourceMode === 'database'
        ? await loadDatabaseQuestions(requestedCount)
        : await loadAiQuestions(requestedCount);

      if (loadedQuestions.length === 0) {
        setQuizStarted(false);
        setQuestions([]);
        setLoadError(sourceMode === 'database'
          ? 'No questions found for the selected filters. Try a different setup.'
          : 'Could not generate enough AI questions. Use lower count or switch scripture.');
        return;
      }

      const finalCount = Math.min(requestedCount, loadedQuestions.length);
      if (finalCount !== numQuestions) {
        setNumQuestions(finalCount);
      }

      setQuestions(loadedQuestions.slice(0, finalCount));
      setQuizStarted(true);
      setShowResult(false);
      setTimedOut(false);
      setQuizStartedAt(Date.now());
      setQuizFinishedAt(null);
      setScoreSaved(false);
      setQuizState({
        currentQuestion: 0,
        selectedAnswer: null,
        answered: false,
        score: 0,
        totalQuestions: finalCount,
        streak: 0,
        bestStreak: 0,
        xp: 0,
      });
      setTimeLeft(timedMode ? timePerQuestion : 0);
    } catch (error) {
      console.error('Error loading questions:', error);
      setQuizStarted(false);
      setQuestions([]);
      setLoadError('Could not load quiz questions right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerClick = (answer: OptionKey) => {
    if (!currentQuestion || quizState.answered) return;

    setQuizState((prev) => {
      const isCorrect = answer === currentQuestion.correct_answer;
      const nextStreak = isCorrect ? prev.streak + 1 : 0;
      const streakBonus = isCorrect && nextStreak >= 3 ? 3 : isCorrect && nextStreak === 2 ? 1 : 0;
      const questionXp = isCorrect ? (timedMode ? 14 : 10) + streakBonus : 0;

      return {
        ...prev,
        selectedAnswer: answer,
        answered: true,
        score: isCorrect ? prev.score + 1 : prev.score,
        streak: nextStreak,
        bestStreak: Math.max(prev.bestStreak, nextStreak),
        xp: prev.xp + questionXp,
      };
    });
    setTimedOut(false);
    setShowResult(true);
  };

  const handleNextQuestion = () => {
    if (quizState.currentQuestion >= quizState.totalQuestions - 1) return;

    setQuizState((prev) => ({
      ...prev,
      currentQuestion: prev.currentQuestion + 1,
      selectedAnswer: null,
      answered: false,
    }));
    setTimedOut(false);
    setShowResult(false);
  };

  const handleRestartQuiz = () => {
    setQuizStarted(false);
    setQuestions([]);
    setQuizState({
      currentQuestion: 0,
      selectedAnswer: null,
      answered: false,
      score: 0,
      totalQuestions: 0,
      streak: 0,
      bestStreak: 0,
      xp: 0,
    });
    setShowResult(false);
    setTimedOut(false);
    setQuizStartedAt(null);
    setQuizFinishedAt(null);
    setScoreSaved(false);
    setTimeLeft(0);
    if (sourceMode === 'database') {
      setCategory('all');
    }
  };

  const saveToLeaderboard = () => {
    if (!isQuizComplete || scoreSaved || !religion) return;

    const entry: LeaderboardEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      playerName: playerName.trim() || 'Anonymous',
      religion,
      level,
      sourceMode,
      timedMode,
      score: quizState.score,
      totalQuestions: quizState.totalQuestions,
      scorePercentage,
      durationSeconds: elapsedSeconds,
      createdAt: new Date().toISOString(),
    };

    const nextBoard = sortLeaderboard([...leaderboard, entry]).slice(0, 100);
    setLeaderboard(nextBoard);
    setScoreSaved(true);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(nextBoard));
    }
  };

  const downloadCertificate = () => {
    if (!isQuizComplete || !hasPassed || !religion) return;

    const learner = playerName.trim() || 'Learner';
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();

    const outerMargin = 24;
    const innerMargin = 42;
    const now = new Date();
    const issueDate = now.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const certificateId = `ROKO-${now.getFullYear()}-${String(Date.now()).slice(-6)}`;

    const drawCenteredFittedText = (
      text: string,
      y: number,
      maxWidth: number,
      maxSize: number,
      minSize: number,
      font: 'helvetica' | 'times' | 'courier',
      style: 'normal' | 'bold' | 'italic' | 'bolditalic'
    ) => {
      let fontSize = maxSize;
      doc.setFont(font, style);
      doc.setFontSize(fontSize);
      while (doc.getTextWidth(text) > maxWidth && fontSize > minSize) {
        fontSize -= 1;
        doc.setFontSize(fontSize);
      }
      doc.text(text, width / 2, y, { align: 'center' });
      return fontSize;
    };

    doc.setFillColor(250, 250, 248);
    doc.rect(0, 0, width, height, 'F');

    doc.setDrawColor(15, 118, 110);
    doc.setLineWidth(4);
    doc.rect(outerMargin, outerMargin, width - outerMargin * 2, height - outerMargin * 2);

    doc.setDrawColor(180, 140, 65);
    doc.setLineWidth(1.2);
    doc.rect(innerMargin, innerMargin, width - innerMargin * 2, height - innerMargin * 2);

    doc.setFillColor(15, 118, 110);
    doc.roundedRect(innerMargin + 26, innerMargin + 16, width - (innerMargin + 26) * 2, 28, 8, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('ROKO SPIRITUAL LEARNING PLATFORM', width / 2, innerMargin + 35, { align: 'center' });

    doc.setTextColor(18, 52, 86);
    drawCenteredFittedText('Certificate of Achievement', 132, width - 220, 44, 30, 'times', 'bold');

    doc.setDrawColor(180, 140, 65);
    doc.setLineWidth(1);
    doc.line(width / 2 - 120, 148, width / 2 + 120, 148);

    doc.setTextColor(55, 65, 81);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(16);
    doc.text('This is to proudly certify that', width / 2, 185, { align: 'center' });

    doc.setTextColor(17, 24, 39);
    drawCenteredFittedText(learner, 236, width - 200, 40, 24, 'times', 'bold');

    doc.setTextColor(31, 41, 55);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(15);
    doc.text(
      `has successfully completed the ${LEVEL_META[level].label} level assessment in ${RELIGION_META[religion].label}.`,
      width / 2,
      274,
      { align: 'center' }
    );

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.8);
    doc.roundedRect(118, 300, width - 236, 118, 10, 10, 'FD');

    doc.setTextColor(17, 24, 39);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`Achievement: ${achievementBadge}`, 140, 328);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(13);
    doc.text(`Score: ${quizState.score}/${quizState.totalQuestions} (${scorePercentage}%)`, 140, 352);
    doc.text(`Completion Time: ${formatDuration(elapsedSeconds)} | Pass Threshold: ${passScore}%`, 140, 374);

    doc.setDrawColor(180, 140, 65);
    doc.setLineWidth(1.5);
    const sealX = width - 150;
    const sealY = 359;
    const sealRadius = 50;
    doc.circle(sealX, sealY, sealRadius);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 118, 110);
    doc.text('VERIFIED', sealX, sealY - 10, { align: 'center' });
    doc.setFontSize(20);
    doc.text(`${scorePercentage}%`, sealX, sealY + 14, { align: 'center' });
    doc.setFontSize(9);
    doc.text('ROKO QUIZ', sealX, sealY + 30, { align: 'center' });

    doc.setFontSize(10);
    doc.text(`Issued on ${issueDate} | Certificate ID: ${certificateId}`, width / 2, 506, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 118, 110);
    doc.text('ROKO Spiritual Learning Platform', width / 2, 524, { align: 'center' });

    const safeName = learner.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    doc.save(`roko-certificate-${safeName || 'learner'}-${Date.now()}.pdf`);
  };

  if (!quizStarted) {
    return (
      <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-emerald-50 via-green-50 to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-emerald-300/20 blur-3xl"></div>
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-cyan-300/20 blur-3xl"></div>

        <div className="max-w-6xl mx-auto px-4 py-10 sm:px-6 lg:px-8 relative">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 dark:bg-gray-800/70 border border-white/70 dark:border-gray-700 mb-4">
              <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Advanced Quiz System</span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white tracking-tight">ROKO Text Quiz</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-3 max-w-3xl mx-auto">
              Level-based quiz, timed mode, leaderboard, AI-generated questions, and PDF certificate generation.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6 mb-8">
            <div className="lg:col-span-2 bg-white/85 dark:bg-gray-800/85 rounded-2xl shadow-xl p-6 border border-white/70 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">1. Select Text</h2>
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                  {totalAvailable} sources available
                </span>
              </div>

              <div className="grid md:grid-cols-3 gap-3 mb-6">
                {RELIGION_ORDER.map((item) => {
                  const meta = RELIGION_META[item];
                  const selected = religion === item;
                  const count = sourceMode === 'database' ? questionCounts[item] : aiCounts[item];

                  return (
                    <button
                      key={item}
                      onClick={() => {
                        setReligion(item);
                        setCategory('all');
                      }}
                      className={`rounded-xl border p-4 transition-all duration-200 text-left ${
                        selected
                          ? meta.selectedClass
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:-translate-y-0.5 hover:shadow-md'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <BookOpen className="h-5 w-5" />
                        <span className="text-xs font-bold">{count} refs</span>
                      </div>
                      <p className="font-semibold">{meta.label}</p>
                      <p className={`text-xs mt-1 ${selected ? 'text-white/90' : 'text-gray-600 dark:text-gray-300'}`}>
                        {meta.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">2. Level (Beginner -{'>'} Scholar)</label>
              <div className="grid sm:grid-cols-2 gap-2">
                {LEVEL_ORDER.map((item) => {
                  const meta = LEVEL_META[item];
                  const selected = level === item;
                  return (
                    <button
                      key={item}
                      onClick={() => setLevel(item)}
                      className={`rounded-xl border p-3 text-left transition-all ${
                        selected
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <p className="font-semibold text-gray-900 dark:text-white">{meta.label}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{meta.description}</p>
                      <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-2">
                        Pass {meta.passScore}% | Difficulty: {getDifficultyLabel(meta.difficulty)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white/85 dark:bg-gray-800/85 rounded-2xl shadow-xl p-6 border border-white/70 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">3. Configure</h2>

              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Player Name</label>
              <div className="relative mb-4">
                <User className="h-4 w-4 text-gray-500 dark:text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>

              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Question Source</label>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  onClick={() => {
                    setSourceMode('database');
                    setCategory('all');
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    sourceMode === 'database'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  Database
                </button>
                <button
                  onClick={() => {
                    setSourceMode('ai_generated');
                    setCategory('all');
                  }}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                    sourceMode === 'ai_generated'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  AI Generated
                </button>
              </div>

              <div className="mb-4 rounded-lg bg-gray-50 dark:bg-gray-700/50 px-3 py-2">
                <p className="text-xs text-gray-700 dark:text-gray-200">
                  Active level: <span className="font-semibold">{LEVEL_META[level].label}</span>
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                  Difficulty: <span className="font-semibold">{getDifficultyLabel(difficulty)}</span> | Source mode:{' '}
                  <span className="font-semibold">{getSourceLabel(sourceMode)}</span>
                </p>
              </div>

              {sourceMode === 'database' && (
                <>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    disabled={!religion || loadingCategories}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white mb-4 disabled:opacity-60"
                  >
                    <option value="all">All Categories</option>
                    {availableCategories.map((item) => (
                      <option key={item} value={item}>
                        {formatCategory(item)}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={timedMode}
                    onChange={(e) => setTimedMode(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Timed Mode
                </label>

                {timedMode && (
                  <div className="mt-3">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300 block mb-1">
                      Seconds per question: <span className="font-semibold">{timePerQuestion}s</span>
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      step={2}
                      value={timePerQuestion}
                      onChange={(e) =>
                        setTimePerQuestion(Math.max(10, Math.min(90, Number.parseInt(e.target.value, 10) || 10)))
                      }
                      className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                )}
              </div>

              <div className="mb-5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                  Number of Questions: <span className="font-bold">{numQuestions}</span>
                </label>
                <input
                  type="range"
                  min={MIN_QUESTIONS}
                  max={maxSelectableQuestions}
                  value={numQuestions}
                  onChange={(e) =>
                    setNumQuestions(Math.min(maxSelectableQuestions, clampQuestionCount(Number.parseInt(e.target.value, 10))))
                  }
                  className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  {religion
                    ? filteredQuestionCount === null
                      ? 'Checking available source data...'
                      : `${filteredQuestionCount} available for this setup`
                    : 'Select a text to see availability'}
                </p>
              </div>

              <button
                onClick={loadQuestions}
                disabled={!religion || loading || filteredQuestionCount === 0 || insufficientAiPool}
                className="w-full px-6 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 disabled:from-gray-400 disabled:to-gray-400 text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl disabled:cursor-not-allowed"
              >
                {loading
                  ? 'Loading Quiz...'
                  : insufficientAiPool
                  ? 'Need At Least 4 Source Verses'
                  : filteredQuestionCount === 0
                  ? 'No Questions Available'
                  : 'Start Advanced Quiz'}
              </button>
            </div>
          </div>

          {loadError && (
            <div className="mb-6 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-4">
              <p className="text-rose-700 dark:text-rose-300 font-medium">{loadError}</p>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white/80 dark:bg-gray-800/80 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Mode Summary</p>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Level: {LEVEL_META[level].label}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">Difficulty: {getDifficultyLabel(difficulty)}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">Question source: {getSourceLabel(sourceMode)}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">Timed mode: {timedMode ? `${timePerQuestion}s/question` : 'off'}</p>
            </div>

            <div className="bg-white/80 dark:bg-gray-800/80 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Leaderboard Preview</p>
              </div>
              {topLeaderboard.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-300">No scores yet. Complete a quiz and save your result.</p>
              ) : (
                <div className="space-y-2">
                  {topLeaderboard.slice(0, 5).map((entry, index) => (
                    <div key={entry.id} className="rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">#{index + 1} {entry.playerName}</p>
                        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{entry.scorePercentage}%</p>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300">
                        {RELIGION_META[entry.religion].label} | {LEVEL_META[entry.level].label} | {formatDuration(entry.durationSeconds)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-green-50 to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Preparing advanced quiz...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-green-50 to-cyan-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 transition-colors duration-300">
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {isQuizComplete ? (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 text-center border border-gray-100 dark:border-gray-700">
              <div className="mb-6">
                {hasPassed ? (
                  <CheckCircle className="h-20 w-20 text-emerald-500 mx-auto mb-4" />
                ) : (
                  <XCircle className="h-20 w-20 text-orange-500 mx-auto mb-4" />
                )}
              </div>

              <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Quiz Complete</h2>
              <p className="text-6xl font-bold text-emerald-600 dark:text-emerald-400 mb-4">{scorePercentage}%</p>

              <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-5 mb-6">
                <p className="text-lg text-gray-900 dark:text-white font-semibold">
                  Correct answers: <span className="text-emerald-600 dark:text-emerald-400">{quizState.score}</span> /{' '}
                  <span className="text-blue-600 dark:text-blue-400">{quizState.totalQuestions}</span>
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                  Level target: {passScore}% ({LEVEL_META[level].label}) | Duration: {formatDuration(elapsedSeconds)}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                  Best streak: <span className="font-semibold text-amber-600 dark:text-amber-300">{quizState.bestStreak}</span> | XP earned:{' '}
                  <span className="font-semibold text-purple-600 dark:text-purple-300">{quizState.xp}</span>
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{getScoreMessage(scorePercentage, passScore)}</p>
              </div>

              <p className="mb-6 inline-flex rounded-full bg-violet-100 dark:bg-violet-900/30 px-4 py-1.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
                Achievement: {achievementBadge}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={() => {
                    void loadQuestions();
                  }}
                  className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-bold rounded-xl transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Retry Same Settings
                </button>
                <button
                  onClick={saveToLeaderboard}
                  disabled={scoreSaved}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold rounded-xl transition-all duration-200"
                >
                  {scoreSaved ? 'Saved to Leaderboard' : 'Save to Leaderboard'}
                </button>
                <button
                  onClick={downloadCertificate}
                  disabled={!hasPassed}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-bold rounded-xl transition-all duration-200"
                >
                  <Download className="h-4 w-4" />
                  {hasPassed ? 'Download Certificate PDF' : 'Need Pass Score for Certificate'}
                </button>
                <button
                  onClick={handleRestartQuiz}
                  className="flex items-center justify-center space-x-2 px-6 py-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white font-bold rounded-xl transition-all duration-200"
                >
                  <RotateCw className="h-5 w-5" />
                  <span>Change Settings</span>
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">Leaderboard</h3>
              </div>
              {topLeaderboard.length === 0 ? (
                <p className="text-gray-600 dark:text-gray-300">No leaderboard entries yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
                        <th className="py-2 pr-2">Rank</th>
                        <th className="py-2 pr-2">Player</th>
                        <th className="py-2 pr-2">Score</th>
                        <th className="py-2 pr-2">Level</th>
                        <th className="py-2 pr-2">Mode</th>
                        <th className="py-2 pr-2">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topLeaderboard.map((entry, index) => (
                        <tr key={entry.id} className="border-b border-gray-100 dark:border-gray-700/60">
                          <td className="py-2 pr-2 font-semibold text-gray-900 dark:text-white">#{index + 1}</td>
                          <td className="py-2 pr-2 text-gray-800 dark:text-gray-200">{entry.playerName}</td>
                          <td className="py-2 pr-2 text-emerald-700 dark:text-emerald-300 font-semibold">{entry.scorePercentage}%</td>
                          <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{LEVEL_META[entry.level].label}</td>
                          <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{getSourceLabel(entry.sourceMode)}</td>
                          <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{formatDuration(entry.durationSeconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-5 mb-5 border border-gray-100 dark:border-gray-700">
              <div className="flex flex-wrap justify-between gap-3 mb-4">
                <div>
                  <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                    Question {quizState.currentQuestion + 1} / {quizState.totalQuestions}
                  </p>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{religion ? RELIGION_META[religion].label : 'Quiz'}</h3>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Score: {quizState.score}</p>
                  <div className="flex flex-wrap gap-2 justify-end mt-1">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                      {LEVEL_META[level].label}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                      {getSourceLabel(sourceMode)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                      Streak {quizState.streak}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                      XP {quizState.xp}
                    </span>
                    {timedMode && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                        timeLeft <= 8
                          ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      }`}>
                        <Clock3 className="h-3.5 w-3.5" />
                        {timeLeft}s
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-emerald-600 to-green-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-100 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 leading-snug whitespace-pre-line">
                {currentQuestion.question}
              </h2>

              <div className="space-y-3 mb-8">
                {options.map((option) => {
                  const isSelected = quizState.selectedAnswer === option.key;
                  const isCorrect = option.key === currentQuestion.correct_answer;
                  const showCorrect = quizState.answered && isCorrect;
                  const showIncorrect = quizState.answered && isSelected && !isCorrect;

                  return (
                    <button
                      key={option.key}
                      onClick={() => handleAnswerClick(option.key)}
                      disabled={quizState.answered}
                      className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-200 ${
                        showCorrect
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                          : showIncorrect
                          ? 'border-rose-500 bg-rose-50 dark:bg-rose-900/20'
                          : isSelected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:-translate-y-0.5'
                      } ${quizState.answered ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className="flex items-start space-x-3">
                        <div
                          className={`flex items-center justify-center w-8 h-8 rounded-full font-bold flex-shrink-0 ${
                            showCorrect
                              ? 'bg-emerald-500 text-white'
                              : showIncorrect
                              ? 'bg-rose-500 text-white'
                              : isSelected
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                          }`}
                        >
                          {option.key}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 dark:text-white">{option.text}</p>
                          {showCorrect && (
                            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-semibold">Correct</p>
                          )}
                          {showIncorrect && (
                            <p className="text-xs text-rose-600 dark:text-rose-400 mt-1 font-semibold">Incorrect</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {showResult && (
                <div className={`rounded-xl p-4 mb-6 border ${
                  timedOut
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                    : quizState.selectedAnswer === currentQuestion.correct_answer
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                    : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                }`}>
                  <p className={`font-semibold mb-2 ${
                    timedOut
                      ? 'text-amber-900 dark:text-amber-100'
                      : quizState.selectedAnswer === currentQuestion.correct_answer
                      ? 'text-emerald-900 dark:text-emerald-100'
                      : 'text-orange-900 dark:text-orange-100'
                  }`}>
                    {timedOut
                      ? 'Time up!'
                      : quizState.selectedAnswer === currentQuestion.correct_answer
                      ? 'Correct answer!'
                      : 'Good try!'}
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
                    Correct option: <span className="font-semibold">{currentQuestion.correct_answer}</span>
                  </p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{currentQuestion.explanation}</p>
                </div>
              )}

              {quizState.answered && (
                <button
                  onClick={handleNextQuestion}
                  className={`w-full px-6 py-3 rounded-xl font-bold transition-all duration-200 ${
                    isQuizComplete
                      ? 'bg-gray-400 text-white cursor-not-allowed'
                      : 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white shadow-lg hover:shadow-xl'
                  }`}
                >
                  {isQuizComplete ? 'Quiz Complete' : 'Next Question'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
