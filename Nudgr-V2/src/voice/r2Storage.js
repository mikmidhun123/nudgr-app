import { getAuth } from '../firebase';

// Deployed Cloudflare Worker endpoint for Nudgr Voice API
const CLOUDFLARE_WORKER_ENDPOINT =
  process.env.EXPO_PUBLIC_R2_BACKEND_URL ||
  'https://nudgr-voice-api.mikmidhun123.workers.dev';

/**
 * Requests an authenticated upload endpoint from the Cloudflare Worker.
 * Validates the user's Firebase Auth identity.
 *
 * @param {string} [nudgeId] - Associated Nudgr ID or temporary identifier
 * @param {object} [meta] - { durationMs, sizeBytes, mimeType }
 * @returns {Promise<{ uploadUrl: string, storageKey: string, expiresInSeconds: number }>}
 */
export async function getVoiceUploadUrl(nudgeId, meta = {}) {
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error('You must be signed in to upload a voice note.');
  }

  const idToken = await user.getIdToken();
  const endpoint = `${CLOUDFLARE_WORKER_ENDPOINT}/getVoiceUploadUrl`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        nudgeId: nudgeId || `temp_${Date.now()}`,
        durationMs: meta.durationMs || 0,
        sizeBytes: meta.sizeBytes || 0,
        mimeType: meta.mimeType || 'audio/m4a',
      }),
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      if (!response.ok) {
        throw new Error(`Voice server error (${response.status}: ${response.statusText || 'Service unavailable'})`);
      }
      throw new Error(`Voice server returned unexpected format (${response.status})`);
    }

    if (!response.ok || data.error) {
      const errorMsg = data.message || data.error || `Server responded with ${response.status}`;
      const err = new Error(errorMsg);
      err.code = data.code || 'R2_UPLOAD_URL_FAILED';
      throw err;
    }

    return {
      uploadUrl: data.uploadUrl,
      storageKey: data.storageKey,
      expiresInSeconds: data.expiresInSeconds || 900,
    };
  } catch (err) {
    if (__DEV__) console.warn('[r2:getVoiceUploadUrl]', err.message);
    throw err;
  }
}

/**
 * Uploads recorded audio binary directly to the Cloudflare Worker gateway for R2.
 * Never exposes Cloudflare R2 secrets or API keys to the client device.
 *
 * @param {string} uploadUrl - Worker PUT URL (e.g. /upload/voice/uid/xxx.m4a)
 * @param {string} localUri - Local file URI (file://...)
 * @param {string} [mimeType] - Audio MIME type
 * @returns {Promise<boolean>}
 */
export async function uploadVoiceNoteToR2(uploadUrl, localUri, mimeType = 'audio/m4a') {
  if (!uploadUrl || !localUri) {
    throw new Error('Missing upload URL or local file path.');
  }

  const user = getAuth().currentUser;
  const idToken = user ? await user.getIdToken() : null;

  try {
    // Read local file as binary Blob
    const fileResponse = await fetch(localUri);
    const blob = await fileResponse.blob();

    const headers = {
      'Content-Type': mimeType,
    };

    if (idToken) {
      headers['Authorization'] = `Bearer ${idToken}`;
    }

    // Upload binary stream directly to Cloudflare Worker -> R2
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers,
      body: blob,
    });

    if (!uploadResponse.ok) {
      let errorDetail = `HTTP ${uploadResponse.status}`;
      try {
        const rawText = await uploadResponse.text();
        const errJson = JSON.parse(rawText);
        if (errJson.message) errorDetail = errJson.message;
        else if (errJson.error) errorDetail = errJson.error;
      } catch (_) {}
      throw new Error(`R2 voice upload failed (${errorDetail})`);
    }

    return true;
  } catch (err) {
    if (__DEV__) console.warn('[r2:uploadVoiceNoteToR2]', err.message);
    throw err;
  }
}

/**
 * Requests a secure playback streaming URL from the Cloudflare Worker.
 *
 * @param {string} nudgeId - The Nudgr document ID
 * @param {string} storageKey - The R2 storage object key
 * @returns {Promise<{ downloadUrl: string }>}
 */
export async function getVoiceDownloadUrl(nudgeId, storageKey) {
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error('You must be signed in to listen to a voice note.');
  }

  const idToken = await user.getIdToken();
  const endpoint = `${CLOUDFLARE_WORKER_ENDPOINT}/getVoiceDownloadUrl`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        nudgeId,
        storageKey,
      }),
    });

    const rawText = await response.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (_) {
      if (!response.ok) {
        throw new Error(`Voice server error (${response.status}: ${response.statusText || 'Service unavailable'})`);
      }
      throw new Error(`Voice server returned unexpected format (${response.status})`);
    }

    if (!response.ok || data.error) {
      const errorMsg = data.message || data.error || `Server responded with ${response.status}`;
      const err = new Error(errorMsg);
      err.code = data.code || 'R2_DOWNLOAD_URL_FAILED';
      throw err;
    }

    return {
      downloadUrl: data.downloadUrl,
    };
  } catch (err) {
    if (__DEV__) console.warn('[r2:getVoiceDownloadUrl]', err.message);
    throw err;
  }
}
