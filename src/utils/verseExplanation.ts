type Tradition = 'bible' | 'quran';

interface ThemeRule {
  keywords: string[];
  explanation: string;
}

const bibleRules: ThemeRule[] = [
  {
    keywords: ['love', 'charity', 'kindness', 'compassion'],
    explanation: 'this verse teaches practical love through kindness, service, and care for others.',
  },
  {
    keywords: ['faith', 'trust', 'believe', 'hope'],
    explanation: 'this verse calls you to trust God even when outcomes are unclear.',
  },
  {
    keywords: ['forgive', 'mercy', 'grace', 'pardon'],
    explanation: 'this verse highlights forgiveness and mercy as the path to healing relationships.',
  },
  {
    keywords: ['wisdom', 'understanding', 'discern', 'knowledge'],
    explanation: 'this verse emphasizes wise choices grounded in humility and discernment.',
  },
  {
    keywords: ['peace', 'gentle', 'reconcile', 'calm'],
    explanation: 'this verse encourages peace-building through gentle words and self-control.',
  },
  {
    keywords: ['pray', 'prayer', 'supplication', 'thanksgiving', 'gratitude'],
    explanation: 'this verse directs the heart toward prayer and gratitude instead of anxiety.',
  },
];

const quranRules: ThemeRule[] = [
  {
    keywords: ['mercy', 'compassion', 'forgiving', 'rahman', 'rahim'],
    explanation: 'this ayah centers divine mercy and invites you to reflect that mercy in daily conduct.',
  },
  {
    keywords: ['patience', 'sabr', 'steadfast', 'endure'],
    explanation: 'this ayah teaches patient endurance and spiritual steadiness during hardship.',
  },
  {
    keywords: ['justice', 'fair', 'equity', 'truth'],
    explanation: 'this ayah emphasizes justice, fairness, and moral responsibility in society.',
  },
  {
    keywords: ['remember', 'remembrance', 'dhikr', 'heart', 'peace'],
    explanation: 'this ayah points to inner peace through remembrance of Allah.',
  },
  {
    keywords: ['guidance', 'path', 'straight', 'light'],
    explanation: 'this ayah asks you to seek guidance and walk the straight path with sincerity.',
  },
  {
    keywords: ['charity', 'zakat', 'spend', 'poor', 'generous'],
    explanation: 'this ayah teaches generosity and care for others as a sign of faith.',
  },
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countMatches(normalizedText: string, keywords: string[]): number {
  return keywords.reduce((score, keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) {
      return score;
    }

    const regex = new RegExp(`\\b${normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return regex.test(normalizedText) ? score + 1 : score;
  }, 0);
}

function buildSnippet(text: string, wordLimit = 20): string {
  const words = text.split(/\s+/).filter(Boolean);
  const snippet = words.slice(0, wordLimit).join(' ');
  return words.length > wordLimit ? `${snippet}…` : snippet;
}

function getFallbackExplanation(tradition: Tradition, text: string): string {
  if (tradition === 'bible') {
    return 'this verse calls for faithful character, wise action, and practical love in everyday life.';
  }

  // For Quran, avoid identical boilerplate—surface a short snippet of the ayah itself.
  const snippet = buildSnippet(text, 18);
  return snippet
    ? `this ayah emphasizes: "${snippet}"`
    : 'this ayah invites reflection, sincerity, and disciplined good action in daily life.';
}

export function generateBriefVerseExplanation(
  tradition: Tradition,
  text: string,
  referenceLabel?: string
): string {
  const normalizedText = normalizeText(text);
  const rules = tradition === 'bible' ? bibleRules : quranRules;

  let bestRule: ThemeRule | null = null;
  let bestScore = 0;

  for (const rule of rules) {
    const score = countMatches(normalizedText, rule.keywords);
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  const prefix = referenceLabel ? `In ${referenceLabel}, ` : 'This verse ';
  const body = bestRule && bestScore > 0 ? bestRule.explanation : getFallbackExplanation(tradition, text);
  return `${prefix}${body}`;
}
