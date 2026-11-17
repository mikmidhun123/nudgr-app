import { uuid } from 'expo-modules-core';

// Connection codes: 8 chars from an unambiguous alphabet (no 0/O/1/I).
// 32^8 = 2^40 combinations — plenty for collision resistance.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateConnectionCode() {
  // The first 40 UUID-v4 bits are random; version/variant bits occur later.
  // Expo's native UUID generator avoids an insecure Math.random fallback.
  let entropy = Number.parseInt(uuid.v4().replace(/-/g, '').slice(0, 10), 16);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[entropy % CODE_ALPHABET.length];
    entropy = Math.floor(entropy / CODE_ALPHABET.length);
  }
  return code;
}

export function normalizeConnectionCode(raw) {
  return String(raw || '').replace(/[\s-]+/g, '').toUpperCase();
}
