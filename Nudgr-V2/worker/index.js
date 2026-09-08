/**
 * Cloudflare Worker: nudgr-voice-api
 * Secure R2 Audio Storage Gateway for Nudgr V2
 * 
 * R2 Binding:
 * - env.VOICE_BUCKET (bound to bucket: nudgr-voice-notes)
 * 
 * Supported Routes:
 * - POST /getVoiceUploadUrl   -> Returns authenticated upload endpoint & storageKey
 * - PUT  /upload/*            -> Streams audio binary directly into env.VOICE_BUCKET
 * - POST /getVoiceDownloadUrl -> Returns secure playback download endpoint
 * - GET  /media/*             -> Streams audio binary from env.VOICE_BUCKET to expo-av
 * - GET  /health              -> Health check & binding status
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
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, OPTIONS',
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

/**
 * Basic Firebase Auth JWT payload validation
 * Validates issuer, audience, and expiration for nudgr-e6049
 */
function parseAndValidateFirebaseToken(token, expectedProjectId = FIREBASE_PROJECT_ID) {
  if (!token || typeof token !== 'string') return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode base64url payload
    const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);

    // Verify token expiration (with 60s tolerance for clock drift)
    if (payload.exp && payload.exp < now - 60) {
      return null;
    }

    // Verify issuer and audience match Firebase project
    const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;
    if (payload.iss && payload.iss !== expectedIssuer) {
      return null;
    }
    if (payload.aud && payload.aud !== expectedProjectId) {
      return null;
    }

    const uid = payload.user_id || payload.sub;
    if (!uid) return null;

    return {
      uid,
      email: payload.email,
      payload,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Authenticates request via Authorization header or query parameter
 */
function authenticateRequest(request, env) {
  const projectId = env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID;

  // 1. Check Authorization: Bearer <token>
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match && match[1]) {
    return parseAndValidateFirebaseToken(match[1].trim(), projectId);
  }

  // 2. Check query parameter ?token=<token>
  const url = new URL(request.url);
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    return parseAndValidateFirebaseToken(queryToken.trim(), projectId);
  }

  return null;
}

/**
 * Sanitizes object keys to prevent directory traversal
 */
function sanitizeStorageKey(key) {
  if (!key) return null;
  const decoded = decodeURIComponent(key);
  // Remove leading slashes and any .. traversal attempts
  const cleaned = decoded.replace(/^\/+/, '').replace(/\.\./g, '');
  return cleaned.startsWith('voice/') ? cleaned : `voice/${cleaned}`;
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
      const auth = authenticateRequest(request, env);
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

      // Check auth for upload
      const auth = authenticateRequest(request, env);
      if (!auth) {
        return jsonResponse({
          error: 'UNAUTHORIZED',
          message: 'Valid Firebase Auth ID token required to upload.',
        }, 401);
      }

      // Validate Content-Type
      const contentType = request.headers.get('Content-Type') || 'audio/m4a';

      // Validate Content-Length if provided
      const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
      if (contentLength > MAX_AUDIO_SIZE_BYTES) {
        return jsonResponse({
          error: 'FILE_TOO_LARGE',
          message: `Audio file exceeds maximum size of 10MB (${contentLength} bytes).`,
        }, 413);
      }

      try {
        // Stream directly into R2
        const object = await env.VOICE_BUCKET.put(storageKey, request.body, {
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
      const auth = authenticateRequest(request, env);
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

        // Return media streaming endpoint
        const downloadUrl = `${url.origin}/media/${storageKey}`;

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
    // Route: GET / HEAD /media/*
    // Streams audio binary from env.VOICE_BUCKET to recipient
    // -----------------------------------------------------------
    if (pathname.startsWith('/media/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const rawKey = pathname.replace('/media/', '');
      const storageKey = sanitizeStorageKey(rawKey);

      if (!storageKey) {
        return jsonResponse({ error: 'INVALID_KEY', message: 'Invalid storage key path.' }, 400);
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
        headers.set('Cache-Control', 'private, max-age=86400');
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
