import { useState } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import Navbar from './components/Navbar';
import HomePage from './components/HomePage';
import GitaPage from './components/GitaPage';
import BiblePage from './components/BiblePage';
import QuranPage from './components/QuranPage';
import QuizPage from './components/QuizPage';
import FavoritesPage from './components/FavoritesPage';
import { SlokaViewer } from './components/SlokaViewer';
import NotesPage from './components/NotesPage';
import RokoAssistant from './components/RokoAssistant';

function App() {
  const [activeTab, setActiveTab] = useState('home');

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return <HomePage />;
      case 'gita':
        return <GitaPage />;
      case 'bible':
        return <BiblePage />;
      case 'quran':
        return <QuranPage />;
      case 'quiz':
        return <QuizPage />;
      case 'favorites':
        return <FavoritesPage />;
      case 'slokas':
        return <SlokaViewer />;
      case 'notes':
        return <NotesPage />;
      case 'roko':
        return <RokoAssistant />;
      default:
        return <HomePage />;
    }
  };

  return (
    <ThemeProvider>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
        {renderContent()}
      </div>
    </ThemeProvider>
  );
}

export default App;
