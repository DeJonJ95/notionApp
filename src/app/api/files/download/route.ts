import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getBytes } from '@/lib/r2';

export const runtime = 'nodejs';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Streams a private R2 object (resume / tailored resume) to its owner.
// Authorization is a prefix check: every ApplyKit key is `${userId}/...`, so a
// user can only read keys under their own id. No presigned public URLs.
export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key = req.nextUrl.searchParams.get('key') ?? '';
  if (!key || !key.startsWith(`${userId}/`)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let bytes: Buffer;
  try {
    bytes = await getBytes(key);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const filename = key.split('/').pop() || 'resume.docx';
  const contentType = key.toLowerCase().endsWith('.pdf') ? 'application/pdf' : DOCX_MIME;
  // Hand NextResponse a plain ArrayBuffer slice — Buffer's ArrayBufferLike
  // generic doesn't satisfy BodyInit under the newer TS lib.
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
