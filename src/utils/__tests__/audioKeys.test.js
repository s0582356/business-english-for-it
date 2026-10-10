import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AUDIO_PROFILE, audioTextHash, buildAudioFileName, getAudioFileNames } from '../audioKeys.js'
import { sha256Hex, sha256HexSync } from '../sha256.js'
import { choiceItem, orderedStructureItem } from './audioTestHelpers.js'

const encode = (text) => new TextEncoder().encode(text)
const nodeSha = (text) => createHash('sha256').update(text).digest('hex')

describe('sha256 (WebCrypto + JS-Fallback)', () => {
  it.each(['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), 'Grüße ✓ …'])('JS-Fallback entspricht Node-SHA-256 fuer "%s"', (text) => {
    expect(sha256HexSync(encode(text))).toBe(nodeSha(text))
  })

  it('bekannter Testvektor', () => {
    expect(sha256HexSync(encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('async Variante liefert dasselbe Ergebnis, auch ohne crypto.subtle (HTTP im LAN)', async () => {
    const expected = nodeSha('Hallo Welt')
    expect(await sha256Hex(encode('Hallo Welt'))).toBe(expected)
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true })
    try {
      expect(await sha256Hex(encode('Hallo Welt'))).toBe(expected)
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original)
    }
  })
})

describe('Audio-Hash und Dateiname (App und Generator teilen diese Logik)', () => {
  it('Profil ist festgelegt', () => {
    expect(AUDIO_PROFILE).toBe('kokoro-bf_emma-v1')
  })

  it('Testvektor: hash8 = erste 8 Hex-Zeichen von sha256(profil|text)', async () => {
    const text = 'Hello from the test suite. This sentence is invented.'
    expect(await audioTextHash(text)).toBe(nodeSha(`kokoro-bf_emma-v1|${text}`).slice(0, 8))
    expect(await audioTextHash(text)).toBe('c62549ab') // fester Vektor: aendert sich nur, wenn Profil oder Hash-Regel geaendert werden
  })

  it('Dateiname hat das Schema <areaId>__<itemId>__<kind>__<hash8>.mp3', () => {
    expect(buildAudioFileName('telephoning', 'tel-example-01', 'q', 'a3f9c21b')).toBe('telephoning__tel-example-01__q__a3f9c21b.mp3')
  })

  it('anderes Profil oder anderer Text ergibt einen anderen Hash (kein veraltetes Audio)', async () => {
    expect(await audioTextHash('Hello')).not.toBe(await audioTextHash('Hello!'))
    expect(await audioTextHash('Hello')).not.toBe(await audioTextHash('Hello', 'kokoro-bf_emma-v2'))
  })

  it('Dateinamen enthalten keine Lerntexte', async () => {
    const names = await getAudioFileNames('telephoning', choiceItem)
    expect(names.q).toMatch(/^telephoning__tel-test-01__q__[0-9a-f]{8}\.mp3$/)
    expect(names.s).toMatch(/^telephoning__tel-test-01__s__[0-9a-f]{8}\.mp3$/)
    expect(`${names.q}${names.s}`).not.toMatch(/Kim|greeting/i)
  })

  it('Strukturliste: nur q, kein s; ohne areaId oder id gibt es keine Namen', async () => {
    const names = await getAudioFileNames('email-writing', orderedStructureItem)
    expect(names.q).toBeTruthy()
    expect(names.s).toBeNull()
    expect(await getAudioFileNames('', choiceItem)).toEqual({ q: null, s: null })
    expect(await getAudioFileNames('telephoning', { type: 'choice', prompt: 'x' })).toEqual({ q: null, s: null })
  })

  it('geaenderter Text bei gleicher itemId aendert den Dateinamen', async () => {
    const before = await getAudioFileNames('telephoning', choiceItem)
    const after = await getAudioFileNames('telephoning', { ...choiceItem, prompt: `${choiceItem.prompt} Really?` })
    expect(after.q).not.toBe(before.q)
    expect(after.s).toBe(before.s)
  })
})
