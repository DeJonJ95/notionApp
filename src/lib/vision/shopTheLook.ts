// Vision analysis for the "Shop This Look" feature.
// Uses Google Gemini 1.5 Flash — ~20x cheaper than GPT-4o and has a generous
// free tier (1,500 req/day). Same Google account as CSE; just needs a
// separate Gemini API key from https://aistudio.google.com/app/apikey

export type DetectedItem = {
  name: string;
  category: string | null;
  description: string | null;
  color: string | null;
  estimatedPriceRange: string | null;
  searchQuery: string; // pre-formed query for Google CSE
  confidence?: number; // 0-1, optional
};

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Model IDs are retired on Google's schedule, and a retired ID answers with a
// bare 404 that looks nothing like a model problem. gemini-1.5-flash-latest was
// shut down and cost this feature a confusing outage. So: allow an env override,
// and fall through a list rather than hard-failing on the first 404.
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash-lite',
].filter(Boolean) as string[];

const VISION_SYSTEM = `You are a product-recognition assistant. Look at the image and identify every distinct product or item that could be purchased (clothing, furniture, accessories, decor, beauty products, etc.).

For each item, return:
- "name": a short, specific name (e.g. "Oversized Camel Wool Coat")
- "category": one of clothing, shoes, accessories, furniture, decor, beauty, home-goods, electronics, other
- "description": a concise 1-sentence description of what it looks like
- "color": dominant color
- "estimatedPriceRange": rough price range (e.g. "$80–120") — only if you can reasonably guess from visible brand cues or category norms; otherwise null
- "searchQuery": a single-line web-search query designed to find retailers selling this exact or very similar item. Include color, material, style, and category.

IMPORTANT rules:
- Only describe items that are clearly visible and identifiable. Do NOT guess or hallucinate hidden items.
- If an item has a visible brand logo, include the brand in searchQuery.
- Return ONLY a JSON array. No markdown, no explanation, no prose outside the JSON.
Example: [{"name": "Brown Leather Chelsea Boots", "category": "shoes", "description": "...", ...}]
- If no identifiable products exist (e.g. abstract art, pure landscape), return an empty array []`;

export async function analyzeImage(
  imageUrl: string,
  apiKey: string,
): Promise<{ items: DetectedItem[]; usage?: { prompt_tokens: number; completion_tokens: number } }> {
  // Gemini expects the image inline as base64, but it also accepts a URL
  // via parts. We fetch the image bytes, base64 them, and send inline.
  const imgRes = await fetch(imageUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    },
  });
  if (!imgRes.ok) throw new Error(`Could not fetch image for analysis (${imgRes.status})`);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const b64 = imgBuffer.toString('base64');
  const mime = imgRes.headers.get('content-type') || 'image/jpeg';

  const payload = JSON.stringify({
    contents: [
      {
        parts: [
          { text: VISION_SYSTEM },
          {
            inline_data: {
              mime_type: mime,
              data: b64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1500,
      responseMimeType: 'application/json',
    },
  });

  // Walk the candidates until one answers. A 404 means that model ID is
  // gone, so try the next; any other error is a real failure and stops here.
  let res: Response | null = null;
  let lastStatus = 0;
  let lastBody = '';

  for (const model of MODEL_CANDIDATES) {
    const url = new URL(`${GEMINI_BASE}/${model}:generateContent`);
    url.searchParams.set('key', apiKey);

    const attempt = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    if (attempt.ok) {
      res = attempt;
      break;
    }

    lastStatus = attempt.status;
    lastBody = await attempt.text().catch(() => '');
    console.error('Gemini vision error:', model, attempt.status, lastBody.slice(0, 500));

    if (attempt.status !== 404) break;
  }

  if (!res) {
    if (lastStatus === 404) {
      throw new Error(
        `No usable Gemini model. Tried: ${MODEL_CANDIDATES.join(', ')}. ` +
          `Set GEMINI_MODEL to a current model ID.`,
      );
    }
    if (lastStatus === 400 || lastStatus === 403) {
      throw new Error(`Gemini rejected the API key (${lastStatus}). Check GEMINI_API_KEY.`);
    }
    throw new Error(`Gemini vision request failed (${lastStatus})`);
  }

  const json = await res.json();
  const raw = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

  // Gemini does not return token counts in the same shape; estimate from
  // characters for cost logging (good enough for budgeting).
  const usage = {
    prompt_tokens: Math.ceil(VISION_SYSTEM.length / 4 + b64.length / 4),
    completion_tokens: Math.ceil(raw.length / 4),
  };

  let items: DetectedItem[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) items = parsed;
    else if (Array.isArray(parsed.items)) items = parsed.items;
    else if (parsed.results && Array.isArray(parsed.results)) items = parsed.results;
  } catch {
    console.error('Failed to parse vision JSON:', raw.slice(0, 200));
  }

  return {
    items: items.filter((it) => it.name && it.searchQuery),
    usage,
  };
}
