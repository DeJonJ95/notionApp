import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Supports Groq (free Whisper) or OpenAI Whisper — whichever key is set.
// Groq: https://console.groq.com  model: whisper-large-v3-turbo  ~$0.04/hr
// OpenAI: model: whisper-1  $0.006/min

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(session?.user as any)?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
  return NextResponse.json({ text: data.text ?? '' });
}
