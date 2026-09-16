import { describe, expect, it } from 'vitest'
import { fingerprintFile } from '../fingerprint.js'

// Hinweis: In der jsdom-Testumgebung liefert die polyfillte File/Blob-Klasse
// einen ArrayBuffer aus einem anderen Realm, den Node's natives WebCrypto
// ablehnt ("2nd argument is not instance of ArrayBuffer..."). Das ist eine
// jsdom/Node-Interop-Eigenheit der Testumgebung, kein Fehler in fingerprint.js
// (im echten Browser funktioniert File.arrayBuffer() korrekt). Der Test
// verwendet daher ein minimales Objekt mit derselben arrayBuffer()-Schnittstelle
// wie ein echtes File, erzeugt über TextEncoder statt über File/Blob.
function fakeFile(text) {
  return { arrayBuffer: async () => new TextEncoder().encode(text).buffer }
}

describe('fingerprintFile', () => {
  it('erzeugt einen stabilen SHA-256-Hex-Fingerprint für denselben Inhalt', async () => {
    const fingerprintA = await fingerprintFile(fakeFile('{"a":1}'))
    const fingerprintB = await fingerprintFile(fakeFile('{"a":1}'))

    expect(fingerprintA).toBe(fingerprintB)
    expect(fingerprintA).toMatch(/^[a-f0-9]{64}$/)
  })

  it('erzeugt unterschiedliche Fingerprints für unterschiedlichen Inhalt', async () => {
    const fingerprintA = await fingerprintFile(fakeFile('{"a":1}'))
    const fingerprintB = await fingerprintFile(fakeFile('{"a":2}'))

    expect(fingerprintA).not.toBe(fingerprintB)
  })
})
