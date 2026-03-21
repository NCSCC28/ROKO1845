import { useState, useCallback, useEffect, useRef } from 'react';

const MAX_CHARS_PER_CHUNK = 220;
const LANG_CHUNK_SIZE_OVERRIDES: Record<string, number> = {
  ar: 150,
};

const VOICE_HINTS_BY_LANG: Record<string, string[]> = {
  en: ['google us english', 'microsoft aria', 'microsoft jenny', 'samantha', 'alex', 'daniel'],
  te: [
    'telugu', 'te-in', 'india', 
    'google telugu', 'microsoft sampath', 'microsoft chandra',
    'telugu-india', 'te-IN', 'telugu (india)'
  ],
  hi: ['hindi', 'hi-in', 'india', 'google hindi', 'microsoft himani'],
  ar: ['arabic', 'ar-sa', 'google arabic'],
};

function normalizeLang(lang: string): string {
  return (lang || 'en-US').toLowerCase().replace('_', '-');
}

function cleanSpeechText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\u0000-\u001F]/g, '').trim();
}

function splitLongSegment(segment: string, maxChars: number): string[] {
  const words = segment.split(' ').filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = word;
      continue;
    }

    chunks.push(word.slice(0, maxChars));
    current = word.slice(maxChars);
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitTextIntoChunks(text: string, lang: string): string[] {
  const baseLang = normalizeLang(lang).split('-')[0];
  const maxChars = LANG_CHUNK_SIZE_OVERRIDES[baseLang] ?? MAX_CHARS_PER_CHUNK;
  const cleaned = cleanSpeechText(text);
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  // Split by sentence-like boundaries first to keep speech natural.
  const sentenceParts = cleaned.match(/[^.!?\u0964\u061F]+[.!?\u0964\u061F]?/g) ?? [cleaned];
  const chunks: string[] = [];
  let buffer = '';

  for (const rawPart of sentenceParts) {
    const part = rawPart.trim();
    if (!part) continue;

    const combined = buffer ? `${buffer} ${part}` : part;
    if (combined.length <= maxChars) {
      buffer = combined;
      continue;
    }

    if (buffer) {
      chunks.push(buffer);
      buffer = '';
    }

    if (part.length <= maxChars) {
      buffer = part;
    } else {
      chunks.push(...splitLongSegment(part, maxChars));
    }
  }

  if (buffer) {
    chunks.push(buffer);
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function scoreVoice(voice: SpeechSynthesisVoice, lang: string): number {
  const targetLang = normalizeLang(lang);
  const targetBase = targetLang.split('-')[0];
  const voiceLang = normalizeLang(voice.lang);
  const voiceBase = voiceLang.split('-')[0];
  const voiceName = voice.name.toLowerCase();
  let score = 0;

  // Exact match gets highest priority
  if (voiceLang === targetLang) {
    score += 120;
  } else if (voiceLang.startsWith(`${targetBase}-`)) {
    score += 90;
  } else if (voiceBase === targetBase) {
    score += 70;
  }

  // Prefer remote voices (Google, etc.) as they typically have better language coverage
  if (!voice.localService) {
    score += 25;
  }

  if (voice.default) {
    score += 15;
  }

  const hints = VOICE_HINTS_BY_LANG[targetBase] ?? [];
  for (const hint of hints) {
    if (voiceName.includes(hint)) {
      score += 20;
    }
  }

  return score;
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  let bestVoice: SpeechSynthesisVoice | null = null;
  let bestScore = -1;

  for (const voice of voices) {
    const score = scoreVoice(voice, lang);
    if (score > bestScore) {
      bestScore = score;
      bestVoice = voice;
    }
  }

  return bestVoice ?? voices.find((voice) => voice.default) ?? voices[0] ?? null;
}

function getRateForLang(lang: string): number {
  const base = normalizeLang(lang).split('-')[0];
  if (base === 'ar') return 0.92;
  if (base === 'te') return 0.9;
  if (base === 'hi') return 0.94;
  return 1;
}

function getPitchForLang(lang: string): number {
  const base = normalizeLang(lang).split('-')[0];
  if (base === 'ar') return 1;
  if (base === 'te') return 0.98;
  return 1;
}

export function useSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const sessionRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (typeof window === 'undefined') {
      return () => {
        mountedRef.current = false;
      };
    }

    const supported =
      'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    setIsSupported(supported);

    if (!supported) {
      return () => {
        mountedRef.current = false;
      };
    }

    synthesisRef.current = window.speechSynthesis;
    const synthesis = window.speechSynthesis;

    const loadVoices = () => {
      const availableVoices = synthesis.getVoices();
      if (availableVoices.length > 0) {
        voicesRef.current = availableVoices;
        if (mountedRef.current) {
          setVoices(availableVoices);
        }
      }
    };

    loadVoices();
    const retries = window.setInterval(() => {
      if (voicesRef.current.length > 0) {
        window.clearInterval(retries);
        return;
      }
      loadVoices();
    }, 400);

    synthesis.addEventListener('voiceschanged', loadVoices);

    return () => {
      mountedRef.current = false;
      window.clearInterval(retries);
      synthesis.removeEventListener('voiceschanged', loadVoices);
      sessionRef.current += 1;
      synthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    if (!isSupported) return;
    const synthesis = synthesisRef.current ?? window.speechSynthesis;
    sessionRef.current += 1;
    synthesis.cancel();
    if (mountedRef.current) {
      setIsSpeaking(false);
    }
  }, [isSupported]);

  const speak = useCallback(
    (text: string, lang: string = 'en-US') => {
      if (!isSupported) {
        console.warn('Speech synthesis not supported');
        return;
      }

      const synthesis = synthesisRef.current ?? window.speechSynthesis;
      const normalizedText = cleanSpeechText(text);
      if (!normalizedText) return;

      sessionRef.current += 1;
      const currentSession = sessionRef.current;
      synthesis.cancel();

      const chunks = splitTextIntoChunks(normalizedText, lang);
      if (chunks.length === 0) return;

      if (mountedRef.current) {
        setIsSpeaking(true);
      }

      const availableVoices =
        voicesRef.current.length > 0 ? voicesRef.current : synthesis.getVoices();
      
      // Debug: Log available voices and selected language
      console.log('[useSpeech] Speaking:', { 
        lang, 
        textLength: normalizedText.length,
        chunksCount: chunks.length,
        availableVoicesCount: availableVoices.length,
        voices: availableVoices.map(v => ({ name: v.name, lang: v.lang, localService: v.localService }))
      });
      
      const selectedVoice = pickVoice(availableVoices, lang);
      
      console.log('[useSpeech] Selected voice:', selectedVoice ? { 
        name: selectedVoice.name, 
        lang: selectedVoice.lang 
      } : 'None - using fallback');

      // Always ensure the lang is set properly, even if no matching voice is found
      const utteranceLang = selectedVoice?.lang || lang;
      
      console.log('[useSpeech] Using language:', utteranceLang, 'for text:', normalizedText.substring(0, 50) + '...');

      const speakChunk = (index: number) => {
        if (currentSession !== sessionRef.current) return;

        if (index >= chunks.length) {
          if (mountedRef.current) {
            setIsSpeaking(false);
          }
          return;
        }

        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = utteranceLang;
        if (selectedVoice) {
          utterance.voice = selectedVoice;
        }
        utterance.rate = getRateForLang(utteranceLang);
        utterance.pitch = getPitchForLang(utteranceLang);
        utterance.volume = 1;

        utterance.onstart = () => {
          if (currentSession === sessionRef.current && mountedRef.current) {
            setIsSpeaking(true);
          }
        };

        utterance.onend = () => {
          if (currentSession !== sessionRef.current) return;
          speakChunk(index + 1);
        };

        utterance.onerror = () => {
          if (currentSession !== sessionRef.current) return;
          if (index < chunks.length - 1) {
            speakChunk(index + 1);
            return;
          }
          if (mountedRef.current) {
            setIsSpeaking(false);
          }
        };

        synthesis.speak(utterance);
      };

      speakChunk(0);
    },
    [isSupported]
  );

  return { speak, stop, isSpeaking, isSupported, voices };
}

