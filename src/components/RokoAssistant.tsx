import { useEffect, useRef, useState } from 'react';
import { Loader, Send, X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { askOpenRouter } from '../utils/geminiAi';

interface Message {
  id: string;
  speaker: 'user' | 'roko';
  text: string;
  timestamp: number;
}

export default function RokoAssistant() {
  const { isDark } = useTheme();

  const bgGradient = isDark
    ? 'from-slate-950 via-indigo-950 to-slate-900'
    : 'from-slate-50 via-indigo-50 to-slate-100';
  const accentGradient = isDark
    ? 'from-indigo-400 to-cyan-300'
    : 'from-indigo-600 to-cyan-400';
  const botTitleColor = isDark ? 'text-white' : 'text-slate-900';
  const baseText = isDark ? 'text-slate-100' : 'text-slate-900';
  const secondaryText = isDark ? 'text-slate-100' : 'text-slate-600';
  const placeholderText = isDark ? 'placeholder:text-slate-100' : 'placeholder:text-slate-500';

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = (speaker: 'user' | 'roko', text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, speaker, text, timestamp: Date.now() },
    ]);
  };

  const sendMessage = async () => {
    const cleaned = inputText.trim();
    if (!cleaned || isProcessing) return;
    setError(null);
    setIsProcessing(true);
    addMessage('user', cleaned);
    setInputText('');

    try {
      const reply = await askOpenRouter(cleaned);
      addMessage('roko', reply);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to reach ROKO right now.';
      setError(message);
      addMessage('roko', 'Sorry, I had trouble responding. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={`relative min-h-screen bg-gradient-to-br ${bgGradient} ${baseText} overflow-hidden`}>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-in { animation: fadeIn 0.3s ease; }
        @keyframes blink {
          0%, 80%, 100% { opacity: 0; }
          40% { opacity: 1; }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute -right-32 top-10 h-96 w-96 rounded-full bg-violet-400/12 blur-3xl" />
        <div className="absolute inset-x-24 bottom-12 h-64 rounded-full bg-cyan-400/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 sm:px-8 py-10">
        <header className="flex items-center justify-between mb-6">
          <div className="space-y-1">
            <h1 className={`text-3xl sm:text-4xl font-bold tracking-tight ${botTitleColor}`}>ROKO</h1>
          </div>
          <button
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-slate-200 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
            title="Clear conversation"
          >
            <X className="h-4 w-4" />
            Clear
          </button>
        </header>

        <div className="relative mx-auto max-w-4xl rounded-[28px] border border-white/15 bg-white/10 backdrop-blur-xl shadow-[0_25px_80px_-35px_rgba(0,0,0,0.8)] overflow-hidden">
          <div className="max-h-[70vh] overflow-y-auto px-5 sm:px-8 py-6 space-y-4">
            {messages.length === 0 ? (
              <div className={`text-center ${secondaryText} text-sm py-12 fade-in`}>
                Ask anything spiritual, comparative, or reflective. AI ROKO replies with calm, concise guidance.
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`fade-in flex ${msg.speaker === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`relative max-w-[80%] rounded-2xl px-4 py-3 shadow-md ${
                      msg.speaker === 'user'
                        ? 'bg-gradient-to-br from-indigo-700 to-slate-900 text-slate-50'
                        : 'bg-gradient-to-br from-slate-800/90 to-slate-900/90 text-slate-50 border border-white/10'
                    }`}
                  >
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    <span className="absolute -bottom-5 right-2 text-[10px] text-slate-400">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))
            )}

            {isProcessing && (
              <div className="fade-in flex items-center gap-2 text-slate-300 text-sm">
                <span className="inline-flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-slate-300" style={{ animation: 'blink 1s infinite' }} />
                  <span
                    className="h-2 w-2 rounded-full bg-slate-300"
                    style={{ animation: 'blink 1s infinite 0.2s' }}
                  />
                  <span
                    className="h-2 w-2 rounded-full bg-slate-300"
                    style={{ animation: 'blink 1s infinite 0.4s' }}
                  />
                </span>
                AI ROKO is thinking...
              </div>
            )}
          </div>

          {error && (
            <div className="px-5 pb-3 text-xs text-amber-300">
              {error}
            </div>
          )}

          <div className="sticky bottom-0 border-t border-white/10 bg-gradient-to-r from-slate-900/70 via-slate-900/60 to-slate-900/70 backdrop-blur-xl px-4 sm:px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 shadow-inner focus-within:ring-2 focus-within:ring-indigo-400/70 transition-all">
                <input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Ask AI ROKO..."
                  className={`w-full bg-transparent outline-none text-sm ${baseText} ${placeholderText}`}
                />
              </div>
              <button
                onClick={sendMessage}
                disabled={isProcessing}
                className={`inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold text-slate-900 bg-gradient-to-r ${accentGradient} hover:from-indigo-300 hover:to-cyan-200 disabled:opacity-60 shadow-lg transition-all`}
              >
                {isProcessing ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
