const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}
function base64ToBytes(value) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }

export async function hashPassword(password) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(password));
  return bytesToBase64(new Uint8Array(digest));
}

export async function deriveKey(password, saltValue) {
  const salt = saltValue ? base64ToBytes(saltValue) : crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, salt: bytesToBase64(salt) };
}

export async function encryptJson(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
}

export async function decryptJson(payload, key) {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.ciphertext));
  return JSON.parse(decoder.decode(decrypted));
}
