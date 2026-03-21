import { Book, BookOpen, Home, Heart, Moon, Sun, BarChart3, MessageCircle } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

interface NavbarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export default function Navbar({ activeTab, onTabChange }: NavbarProps) {
  const { isDark, toggleTheme } = useTheme();

  const tabs = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'gita', label: 'Bhagavad Gita', icon: BookOpen },
    { id: 'bible', label: 'Bible', icon: Book },
    { id: 'quran', label: 'Quran', icon: Book },
    { id: 'slokas', label: 'Scripture Search', icon: BookOpen },
    { id: 'roko', label: 'Roko AI', icon: MessageCircle },
    { id: 'quiz', label: 'Quiz', icon: BarChart3 },
    { id: 'favorites', label: 'Favorites', icon: Heart },
  ];

  return (
    <nav className="sticky top-0 z-50 px-3 sm:px-4 pt-3 transition-colors duration-300">
      <div className="max-w-7xl mx-auto rounded-2xl border border-white/50 dark:border-slate-700/60 bg-white/75 dark:bg-slate-900/75 backdrop-blur-xl shadow-[0_12px_32px_-16px_rgba(15,23,42,0.55)]">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              onClick={() => onTabChange('home')}
              className="flex items-center space-x-3 rounded-xl px-2 py-1.5 hover:bg-white/60 dark:hover:bg-slate-800/70 transition-colors duration-200"
              title="Realm of Knowledge and Oneness"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <BookOpen className="h-5 w-5" />
              </span>
              <span className="text-2xl font-serif font-semibold tracking-tight text-slate-900 dark:text-white">
                ROKO
              </span>
            </button>

            {/* Desktop Tabs */}
            <div className="hidden md:flex items-center gap-1.5">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl transition-all duration-200 border ${
                      activeTab === tab.id
                        ? 'bg-gradient-to-r from-amber-100 to-orange-100 text-amber-900 border-amber-300/80 shadow-sm dark:from-amber-900/40 dark:to-orange-900/30 dark:text-amber-200 dark:border-amber-700/70'
                        : 'border-transparent text-slate-600 dark:text-slate-300 hover:bg-white/70 hover:text-slate-900 dark:hover:bg-slate-800/80 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="font-medium">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/80 bg-white/70 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800 transition-colors duration-200"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <Sun className="h-5 w-5 text-amber-400" />
              ) : (
                <Moon className="h-5 w-5 text-slate-700" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Tabs */}
        <div className="md:hidden flex overflow-x-auto border-t border-slate-200/70 dark:border-slate-800 px-3 pb-3 pt-2 space-x-2 scrollbar-hide">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center space-x-2 px-3 py-2 rounded-lg whitespace-nowrap transition-all duration-200 border ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-amber-100 to-orange-100 text-amber-900 border-amber-300/80 dark:from-amber-900/40 dark:to-orange-900/30 dark:text-amber-200 dark:border-amber-700/70'
                    : 'border-transparent text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-800/80'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="text-sm font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
