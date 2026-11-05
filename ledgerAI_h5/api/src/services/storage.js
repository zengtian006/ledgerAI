import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
export const ALLOWED_MIME = Object.keys(EXT);

const URL_TTL_SECONDS = 15 * 60;
const isS3 = config.storage.driver === 's3';

let s3Promise;
function s3() {
  s3Promise ??= (async () => {
    const [sdk, presigner] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);
    return { client: new sdk.S3Client({ region: config.storage.s3Region }), presigner, sdk };
  })();
  return s3Promise;
}

export const keyBelongsToUser = (key, userId) => key.startsWith(`receipts/${userId}/`) && !key.includes('..');

export function newKey(userId, mime) {
  return `receipts/${userId}/${randomUUID()}.${EXT[mime] || 'jpg'}`;
}

function localPath(key) {
  const full = path.resolve(config.storage.localDir, key);
  if (!full.startsWith(path.resolve(config.storage.localDir) + path.sep)) throw new Error('Invalid key');
  return full;
}

export async function saveImage(key, buffer, mime) {
  if (isS3) {
    const { client, sdk } = await s3();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: config.storage.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: mime,
        ServerSideEncryption: 'AES256',
      }),
    );
    return;
  }
  const file = localPath(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
}

export async function deleteImage(key) {
  if (!key) return;
  try {
    if (isS3) {
      const { client, sdk } = await s3();
      await client.send(new sdk.DeleteObjectCommand({ Bucket: config.storage.s3Bucket, Key: key }));
    } else {
      await unlink(localPath(key));
    }
  } catch {
    // best effort
  }
}

export const readLocalImage = (key) => readFile(localPath(key));

const sign = (key, exp) => createHmac('sha256', config.jwtSecret).update(`${key}.${exp}`).digest('hex');

export function verifySignedUrl(key, exp, sig) {
  if (!key || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(key, exp));
  const actual = Buffer.from(String(sig));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// Short-lived URL usable directly in <img src>
export async function getImageUrl(key) {
  if (!key) return null;
  if (isS3) {
    const { client, presigner, sdk } = await s3();
    return presigner.getSignedUrl(client, new sdk.GetObjectCommand({ Bucket: config.storage.s3Bucket, Key: key }), {
      expiresIn: URL_TTL_SECONDS,
    });
  }
  const exp = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
  return `/api/files?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign(key, exp)}`;
}
