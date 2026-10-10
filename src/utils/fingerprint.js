import { sha256Hex } from './sha256.js'

// Ergebnis ist identisch zu crypto.subtle.digest('SHA-256', ...); der Fallback in
// sha256.js greift nur, wo crypto.subtle fehlt (z. B. http://<LAN-IP> beim Test
// auf dem iPhone).
export async function fingerprintFile(file) {
  const bytes = await file.arrayBuffer()
  return sha256Hex(new Uint8Array(bytes))
}
