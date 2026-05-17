import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { putBytes } from '@/lib/r2';
import { detectResumeType, parseResumeFile, mimeFor } from '@/lib/jobs/resumeFiles';
import { logCall } from '@/lib/logUsage';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;
// Real resumes run a few thousand characters; well under this usually means a
// scanned / image-based PDF that pdf-parse couldn't read (no OCR here).
const MIN_GOOD_CHARS = 400;

export async function GET() {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const resumes = await prisma.resume.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, label: true, r2Key: true, fileType: true, createdAt: true },
  });
  return NextResponse.json({ resumes });
}

// Upload + register a base resume. Accepts multipart/form-data with a `file`
// (.docx or .pdf) and a `label`. Parses the text server-side so the AI match
// step has it cached, and stores the original under a userId-prefixed key.
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const label = (form?.get('label') as string | null)?.trim() || 'Resume';
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'A .docx or .pdf file is required' }, { status: 400 });
  }
  const fileType = detectResumeType(file.name, file.type);
  if (!fileType) {
    return NextResponse.json({ error: 'Only .docx or .pdf resumes are supported' }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Resume too large (max 5MB)' }, { status: 413 });
  }

  let parsedText: string;
  try {
    parsedText = await parseResumeFile(buffer, fileType);
  } catch {
    return NextResponse.json({ error: `Could not read that .${fileType} file` }, { status: 422 });
  }
  if (!parsedText) {
    return NextResponse.json({ error: `That .${fileType} appears to have no readable text` }, { status: 422 });
  }

  const r2Key = `${userId}/resumes/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
  await putBytes(r2Key, buffer, mimeFor(fileType));

  const resume = await prisma.resume.create({
    data: { userId, label, r2Key, fileType, parsedText },
    select: { id: true, label: true, r2Key: true, fileType: true, createdAt: true },
  });

  // Soft warning: the file uploaded fine, but we got suspiciously little text.
  const warning =
    parsedText.length < MIN_GOOD_CHARS
      ? `We extracted very little text from this ${fileType} (${parsedText.length} characters). If it's a scanned or image-based PDF, the AI may not read it well — try a text-based .docx or an exported (not scanned) PDF.`
      : null;

  logCall('applykit', 'resume-upload', { userId });
  return NextResponse.json({ resume, warning });
}
