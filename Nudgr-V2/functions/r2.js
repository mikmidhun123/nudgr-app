const admin = require('firebase-admin');

/**
 * Cloudflare R2 Presigned URL Generator for Firebase Functions
 * Uses S3-compatible API to generate secure, short-lived upload & download URLs.
 * 
 * Required Environment Variables (set via Firebase environment or Cloud Functions secrets):
 * - R2_ACCOUNT_ID: Cloudflare account ID
 * - R2_ACCESS_KEY_ID: Cloudflare R2 API token access key ID
 * - R2_SECRET_ACCESS_KEY: Cloudflare R2 API token secret access key
 * - R2_BUCKET_NAME: Cloudflare R2 bucket name (e.g. "nudgr-voice")
 */

let s3ClientInstance = null;

function getS3Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }

  if (!s3ClientInstance) {
    try {
      const { S3Client } = require('@aws-sdk/client-s3');
      s3ClientInstance = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    } catch (e) {
      console.warn('[r2:getS3Client] S3Client init error:', e.message);
      return null;
    }
  }

  return s3ClientInstance;
}

async function verifyAuthToken(req) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer (.*)$/);
  if (!match) {
    return null;
  }
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (e) {
    return null;
  }
}

/**
 * Generates a presigned PUT URL for uploading audio to Cloudflare R2.
 */
async function handleGetVoiceUploadUrl(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  const authUser = await verifyAuthToken(req);
  if (!authUser) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid Firebase Auth token required.' });
  }

  const { nudgeId, mimeType = 'audio/m4a' } = req.body || {};
  const bucketName = process.env.R2_BUCKET_NAME || 'nudgr-voice';
  const s3 = getS3Client();

  if (!s3) {
    return res.status(503).json({
      error: 'R2_CONFIG_MISSING',
      message: 'Cloudflare R2 storage credentials are not yet configured on the server.',
    });
  }

  try {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

    const safeNudgeId = String(nudgeId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '');
    const storageKey = `voice/${authUser.uid}/${safeNudgeId}_${Date.now()}.m4a`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: storageKey,
      ContentType: mimeType,
    });

    const expiresInSeconds = 900; // 15 minutes
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });

    return res.json({
      uploadUrl,
      storageKey,
      expiresInSeconds,
    });
  } catch (err) {
    console.error('[r2:handleGetVoiceUploadUrl]', err);
    return res.status(500).json({ error: 'R2_PRESIGN_FAILED', message: err.message });
  }
}

/**
 * Generates a presigned GET URL for playing an audio file from Cloudflare R2.
 */
async function handleGetVoiceDownloadUrl(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  const authUser = await verifyAuthToken(req);
  if (!authUser) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Valid Firebase Auth token required.' });
  }

  const { nudgeId, storageKey } = req.body || {};
  if (!storageKey) {
    return res.status(400).json({ error: 'MISSING_KEY', message: 'storageKey is required.' });
  }

  // Authorize: check if user is sender or recipient of the Nudgr
  if (nudgeId) {
    try {
      const nudgeSnap = await admin.firestore().collection('nudges').doc(nudgeId).get();
      if (nudgeSnap.exists) {
        const nudge = nudgeSnap.data();
        const isAuthorized = nudge.senderUid === authUser.uid || nudge.recipientUid === authUser.uid;
        if (!isAuthorized) {
          return res.status(403).json({ error: 'FORBIDDEN', message: 'You are not authorized to access this voice note.' });
        }
      }
    } catch (e) {
      console.warn('[r2:authCheck]', e.message);
    }
  }

  const bucketName = process.env.R2_BUCKET_NAME || 'nudgr-voice';
  const s3 = getS3Client();

  if (!s3) {
    return res.status(503).json({
      error: 'R2_CONFIG_MISSING',
      message: 'Cloudflare R2 storage credentials are not yet configured on the server.',
    });
  }

  try {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: storageKey,
    });

    const expiresInSeconds = 900; // 15 minutes
    const downloadUrl = await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });

    return res.json({
      downloadUrl,
      expiresInSeconds,
    });
  } catch (err) {
    console.error('[r2:handleGetVoiceDownloadUrl]', err);
    return res.status(500).json({ error: 'R2_DOWNLOAD_PRESIGN_FAILED', message: err.message });
  }
}

module.exports = {
  handleGetVoiceUploadUrl,
  handleGetVoiceDownloadUrl,
};
