const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT =
  'You are ROKO, a concise spiritual guide. Answer with clear, empathetic language, cite a scripture source (Bhagavad Gita, Bible, or Quran) when relevant, keep replies under 120 words, and end with one practical action step.';

function getApiKey(): string {
  const key =
    import.meta.env.VITE_OPENROUTER_API_KEY ||
    import.meta.env.VITE_GEMINI_API_KEY; // fallback if env not renamed yet
  if (!key) {
    throw new Error('Missing OpenRouter API key. Add VITE_OPENROUTER_API_KEY to your .env file.');
  }
  return key;
}

function getModel(): string {
  return (
    import.meta.env.VITE_OPENROUTER_MODEL?.trim() ||
    'openai/gpt-4o-mini'
  );
}

export async function askOpenRouter(message: string): Promise<string> {
  const apiKey = getApiKey();
  const model = getModel();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
    'X-Title': 'ROKO',
  };

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message.trim() },
    ],
  };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('OpenRouter returned an empty response');
  }

  return text;
}
