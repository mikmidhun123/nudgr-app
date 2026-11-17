/**
 * Cloudflare Worker: nudgr-voice-api
 * Secure R2 Audio Storage Gateway for Nudgr V2
 *
 * R2 Binding:
 * - env.VOICE_BUCKET (bound to bucket: nudgr-voice-notes)
 *
 * Supported Routes:
 * - POST   /getVoiceUploadUrl   -> Returns authenticated upload endpoint & storageKey
 * - PUT    /upload/*            -> Streams audio binary directly into env.VOICE_BUCKET
 * - POST   /getVoiceDownloadUrl -> Returns secure playback download endpoint
 * - GET    /media/*             -> Streams audio binary from env.VOICE_BUCKET to expo-audio
 * - POST   /deleteVoice         -> Deletes voice note object from env.VOICE_BUCKET
 * - DELETE /media/*             -> Deletes voice note object from env.VOICE_BUCKET
 * - GET    /health              -> Health check & binding status
 */

const FIREBASE_PROJECT_ID = 'nudgr-e6049';
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit
const ALLOWED_CONTENT_TYPES = [
  'audio/m4a',
  'audio/mp4',
  'audio/aac',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/mp3',
  'application/octet-stream',
];

/**
 * Standard CORS response headers
 */
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Helper to build JSON responses with CORS headers
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cachedSigningKeys = null;
let signingKeysExpireAt = 0;

function decodeBase64Url(value) {
  const encoded = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')), c => c.charCodeAt(0));
}

/** Verify Firebase's RS256 signature and required claims, failing closed. */
async function parseAndValidateFirebaseToken(token, expectedProjectId = FIREBASE_PROJECT_ID) {
  if (!token || typeof token !== 'string') return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
        payload.iss !== expectedIssuer || payload.aud !== expectedProjectId ||
        typeof payload.exp !== 'number' || payload.exp <= now ||
        typeof payload.iat !== 'number' || payload.iat > now + 60 ||
        typeof payload.auth_time !== 'number' || payload.auth_time > now + 60 ||
        typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 ||
        (payload.user_id && payload.user_id !== payload.sub)) {
      return null;
    }

    if (!cachedSigningKeys || Date.now() >= signingKeysExpireAt) {
      const response = await fetch(FIREBASE_JWKS_URL);
      if (!response.ok) return null;
      const jwks = await response.json();
      if (!Array.isArray(jwks.keys)) return null;
      cachedSigningKeys = jwks.keys;
      const maxAge = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] || 300);
      signingKeysExpireAt = Date.now() + Math.min(maxAge, 3600) * 1000;
    }
    const jwk = cachedSigningKeys.find(key => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
      decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return valid ? { uid: payload.sub, token } : null;
  } catch (err) {
    return null;
  }
}

/**
 * Authenticates requests without placing bearer credentials in URLs.
 */
async function authenticateRequest(request, env) {
  const projectId = env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;

  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match && match[1]) {
    return parseAndValidateFirebaseToken(match[1].trim(), projectId);
  }

  return null;
}

/**
 * Sanitizes object keys to prevent directory traversal
 */
function sanitizeStorageKey(key) {
  if (typeof key !== 'string' || key.includes('..') || !/^voice\/[^/]+\/[^/]+$/.test(key)) return null;
  return key;
}

async function canReadVoice(auth, nudgeId, storageKey, env) {
  if (typeof nudgeId !== 'string' || !nudgeId || nudgeId.includes('/')) return false;
  const projectId = env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;
  try {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/nudges/${encodeURIComponent(nudgeId)}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!response.ok) return false;
    const { fields = {} } = await response.json();
    return storageKey.startsWith(`voice/${fields.senderUid?.stringValue}/`) &&
      (fields.senderUid?.stringValue === auth.uid || fields.recipientUid?.stringValue === auth.uid) &&
      fields.voiceNote?.mapValue?.fields?.storageKey?.stringValue === storageKey;
  } catch (_) {
    return false;
  }
}

/**
 * Verifies whether the authenticated user is authorized to delete a voice object.
 * Strictly requires the key to be under `voice/${auth.uid}/` (sender-owned namespace).
 * When a nudgeId is supplied, also verifies the document either belongs to auth.uid as sender
 * or has already been deleted (404).
 */
async function canDeleteVoice(auth, nudgeId, storageKey, env) {
  if (!auth?.uid || !storageKey.startsWith(`voice/${auth.uid}/`)) {
    return false;
  }
  if (!nudgeId) {
    // Orphan cleanup of caller's own uploaded voice file (under voice/{auth.uid}/)
    return true;
  }
  if (typeof nudgeId !== 'string' || nudgeId.includes('/')) {
    return false;
  }
  const projectId = env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;
  try {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/nudges/${encodeURIComponent(nudgeId)}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (response.status === 404) {
      // Document already deleted; allow owner to remove their voice object
      return true;
    }
    if (!response.ok) return false;
    const { fields = {} } = await response.json();
    return fields.senderUid?.stringValue === auth.uid &&
      (!fields.voiceNote?.mapValue?.fields?.storageKey?.stringValue ||
        fields.voiceNote.mapValue.fields.storageKey.stringValue === storageKey);
  } catch (_) {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Check that R2 bucket binding is present
    if (!env.VOICE_BUCKET) {
      return jsonResponse({
        error: 'R2_BINDING_MISSING',
        message: 'VOICE_BUCKET binding is not attached to this Worker.',
      }, 500);
    }

    // -----------------------------------------------------------
    // Route: GET /health
    // -----------------------------------------------------------
    if (pathname === '/health' || pathname === '/') {
      return jsonResponse({
        status: 'healthy',
        worker: 'nudgr-voice-api',
        bucketBound: true,
        project: env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID,
        timestamp: new Date().toISOString(),
      });
    }

    // -----------------------------------------------------------
    // Route: POST /getVoiceUploadUrl
    // -----------------------------------------------------------
    if (pathname === '/getVoiceUploadUrl' && request.method === 'POST') {
      const auth = await authenticateRequest(request, env);
      if (!auth) {
        return jsonResponse({
          error: 'UNAUTHORIZED',
          message: 'Valid Firebase Auth ID token required.',
        }, 401);
      }

      try {
        let body = {};
        try {
          body = await request.json();
        } catch (_) {}

        const safeNudgeId = String(body.nudgeId || Date.now()).replace(/[^a-zA-Z0-9_-]/g, '');
        const storageKey = `voice/${auth.uid}/${safeNudgeId}_${Date.now()}.m4a`;

        // Direct upload endpoint on this Worker
        const uploadUrl = `${url.origin}/upload/${storageKey}`;

        return jsonResponse({
          uploadUrl,
          storageKey,
          expiresInSeconds: 900,
        });
      } catch (err) {
        return jsonResponse({
          error: 'UPLOAD_PREPARE_FAILED',
          message: err.message,
        }, 500);
      }
    }

    // -----------------------------------------------------------
    // Route: PUT /upload/*
    // Streams binary audio directly into env.VOICE_BUCKET
    // -----------------------------------------------------------
    if (pathname.startsWith('/upload/') && (request.method === 'PUT' || request.method === 'POST')) {
      const rawKey = pathname.replace('/upload/', '');
      const storageKey = sanitizeStorageKey(rawKey);

      if (!storageKey) {
        return jsonResponse({ error: 'INVALID_KEY', message: 'Invalid storage key path.' }, 400);
      }

      const auth = await authenticateRequest(request, env);
      if (!auth) {
        return jsonResponse({
          error: 'UNAUTHORIZED',
          message: 'Valid Firebase Auth ID token required to upload.',
        }, 401);
      }

      if (!storageKey.startsWith(`voice/${auth.uid}/`)) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403);
      }

      const contentType = request.headers.get('Content-Type') || 'audio/m4a';
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        return jsonResponse({ error: 'INVALID_CONTENT_TYPE' }, 415);
      }

      const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (contentLength > MAX_AUDIO_SIZE_BYTES) {
        return jsonResponse({
          error: 'FILE_TOO_LARGE',
          message: `Audio file exceeds maximum size of 10MB (${contentLength} bytes).`,
        }, 413);
      }

      try {
        const chunks = [];
        let size = 0;
        const reader = request.body?.getReader();
        if (!reader) return jsonResponse({ error: 'EMPTY_AUDIO' }, 400);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_AUDIO_SIZE_BYTES) {
            await reader.cancel();
            return jsonResponse({ error: 'FILE_TOO_LARGE' }, 413);
          }
          chunks.push(value);
        }
        if (!size) return jsonResponse({ error: 'EMPTY_AUDIO' }, 400);
        const audio = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.byteLength; }
        const object = await env.VOICE_BUCKET.put(storageKey, audio, {
          httpMetadata: {
            contentType: contentType,
            cacheControl: 'private, max-age=86400',
          },
          customMetadata: {
            uploaderUid: auth.uid,
            uploadedAt: new Date().toISOString(),
          },
        });

        return jsonResponse({
          success: true,
          storageKey: storageKey,
          etag: object.httpEtag,
          size: object.size,
        }, 200);
      } catch (err) {
        return jsonResponse({
          error: 'R2_PUT_FAILED',
          message: err.message,
        }, 500);
      }
    }

    // -----------------------------------------------------------
    // Route: POST /getVoiceDownloadUrl
    // -----------------------------------------------------------
    if (pathname === '/getVoiceDownloadUrl' && request.method === 'POST') {
      const auth = await authenticateRequest(request, env);
      if (!auth) {
        return jsonResponse({
          error: 'UNAUTHORIZED',
          message: 'Valid Firebase Auth ID token required.',
        }, 401);
      }

      try {
        const body = await request.json();
        const rawKey = body.storageKey;
        const storageKey = sanitizeStorageKey(rawKey);

        if (!storageKey) {
          return jsonResponse({ error: 'MISSING_KEY', message: 'storageKey is required.' }, 400);
        }

        if (!await canReadVoice(auth, body.nudgeId, storageKey, env)) {
          return jsonResponse({ error: 'FORBIDDEN' }, 403);
        }
        const downloadUrl = `${url.origin}/media/${storageKey}?nudgeId=${encodeURIComponent(body.nudgeId)}`;

        return jsonResponse({
          downloadUrl,
          expiresInSeconds: 900,
        });
      } catch (err) {
        return jsonResponse({
          error: 'DOWNLOAD_PREPARE_FAILED',
          message: err.message,
        }, 500);
      }
    }

    // -----------------------------------------------------------
    // Route: POST /deleteVoice or DELETE /media/*
    // Permanently deletes a sender's voice note from env.VOICE_BUCKET
    // -----------------------------------------------------------
    if (
      (pathname === '/deleteVoice' && request.method === 'POST') ||
      (pathname.startsWith('/media/') && request.method === 'DELETE')
    ) {
      const auth = await authenticateRequest(request, env);
      if (!auth) {
        return jsonResponse({
          error: 'UNAUTHORIZED',
          message: 'Valid Firebase Auth ID token required.',
        }, 401);
      }

      try {
        let rawKey = null;
        let nudgeId = null;
        if (pathname === '/deleteVoice') {
          const body = await request.json().catch(() => ({}));
          rawKey = body.storageKey;
          nudgeId = body.nudgeId || null;
        } else {
          rawKey = pathname.replace('/media/', '');
          nudgeId = url.searchParams.get('nudgeId') || null;
        }

        const storageKey = sanitizeStorageKey(rawKey);
        if (!storageKey) {
          return jsonResponse({ error: 'INVALID_KEY', message: 'Valid storageKey is required.' }, 400);
        }

        if (!await canDeleteVoice(auth, nudgeId, storageKey, env)) {
          return jsonResponse({
            error: 'FORBIDDEN',
            message: 'Only the sender who owns this voice recording may delete it.',
          }, 403);
        }

        if (typeof env.VOICE_BUCKET.delete === 'function') {
          await env.VOICE_BUCKET.delete(storageKey);
        }

        return jsonResponse({
          success: true,
          deletedKey: storageKey,
        }, 200);
      } catch (err) {
        return jsonResponse({
          error: 'R2_DELETE_FAILED',
          message: err.message,
        }, 500);
      }
    }

    // -----------------------------------------------------------
    // Route: GET / HEAD /media/*
    // Streams audio binary from env.VOICE_BUCKET to recipient
    // -----------------------------------------------------------
    if (pathname.startsWith('/media/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const rawKey = pathname.replace('/media/', '');
      const storageKey = sanitizeStorageKey(rawKey);

      if (!storageKey) {
        return jsonResponse({ error: 'INVALID_KEY', message: 'Invalid storage key path.' }, 400);
      }

      const auth = await authenticateRequest(request, env);
      if (!auth) return jsonResponse({ error: 'UNAUTHORIZED' }, 401);
      if (!await canReadVoice(auth, url.searchParams.get('nudgeId'), storageKey, env)) {
        return jsonResponse({ error: 'FORBIDDEN' }, 403);
      }

      try {
        const object = await env.VOICE_BUCKET.get(storageKey);

        if (!object) {
          return jsonResponse({
            error: 'NOT_FOUND',
            message: 'Voice note audio file not found in storage.',
          }, 404);
        }

        const headers = new Headers();
        headers.set('Content-Type', object.httpMetadata?.contentType || 'audio/m4a');
        headers.set('Content-Length', String(object.size));
        headers.set('ETag', object.httpEtag);
        headers.set('Cache-Control', 'private, no-store');
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Access-Control-Allow-Origin', '*');

        if (request.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers,
          });
        }

        return new Response(object.body, {
          status: 200,
          headers,
        });
      } catch (err) {
        return jsonResponse({
          error: 'R2_GET_FAILED',
          message: err.message,
        }, 500);
      }
    }

    return jsonResponse({
      error: 'NOT_FOUND',
      message: `Route ${request.method} ${pathname} not recognized.`,
    }, 404);
  },
};
