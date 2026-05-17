import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

export async function getUploadUrl(key: string, contentType: string) {
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(r2, cmd, { expiresIn: 60 * 5 });
  return { url, publicUrl: `${process.env.R2_PUBLIC_URL}/${key}` };
}

// Server-side direct upload — for cases where bytes are fetched on the server
// (e.g. mood-board images we pull from Unsplash) and never reach the browser.
export async function putBytes(key: string, body: Buffer | Uint8Array, contentType: string) {
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return { publicUrl: `${process.env.R2_PUBLIC_URL}/${key}` };
}

// Remove an object. Used when a resume or job listing is deleted so its
// private file (original / tailored resume) doesn't linger in the bucket.
export async function deleteObject(key: string) {
  await r2.send(
    new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
  );
}

// Fetch object bytes server-side. Used for private files (resumes) that must
// not be public, so they're streamed through an auth-checked route instead.
export async function getBytes(key: string): Promise<Buffer> {
  const res = await r2.send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}
