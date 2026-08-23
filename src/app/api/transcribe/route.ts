import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logCall } from '@/lib/logUsage';
import { checkDailyBudget, budgetExceededResponse } from '@/lib/usageGuard';

// Supports Groq (free Whisper) or OpenAI Whisper — whichever key is set.
// Groq: https://console.groq.com  model: whisper-large-v3-turbo  ~$0.04/hr
// OpenAI: model: whisper-1  $0.006/min

// Flat per-call cost floor for the daily budget accounting. Whisper is billed
// by audio minute, which we don't know here; a small floor keeps the cap
// meaningful without under- or wildly over-counting a short voice note.
const TRANSCRIBE_COST_FLOOR = 0.01;

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const budget = await checkDailyBudget(userId);
  if (!budget.ok) {
    return NextResponse.json(budgetExceededResponse(budget.spentUsd, budget.capUsd), { status: 429 });
  }

  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const apiKey = groqKey || openaiKey;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'No transcription key. Set GROQ_API_KEY (free) or OPENAI_API_KEY in Vercel env vars.' },
      { status: 500 }
    );
  }

  const endpoint = groqKey
    ? 'https://api.groq.com/openai/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';
  const model = groqKey ? 'whisper-large-v3-turbo' : 'whisper-1';

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const audio = formData.get('audio') as File | null;
  if (!audio || audio.size === 0) {
    return NextResponse.json({ error: 'No audio file' }, { status: 400 });
  }
  // Vercel caps the request body at 4.5 MB; reject early with a clear message
  // instead of letting the platform return an opaque 413.
  if (audio.size > 4 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'Audio too large (max ~4 MB per clip). Record a shorter note.' },
      { status: 413 }
    );
  }

  const whisperForm = new FormData();
  whisperForm.append('file', audio, audio.name);
  whisperForm.append('model', model);
  whisperForm.append('response_format', 'json');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: whisperForm,
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Whisper error:', body);
    return NextResponse.json({ error: 'Transcription failed' }, { status: 502 });
  }

  const data = await res.json();
  logCall('whisper', groqKey ? 'transcribe:groq' : 'transcribe:openai', {
    userId,
    costUsd: TRANSCRIBE_COST_FLOOR,
  });
  return NextResponse.json({ text: data.text ?? '' });
}
