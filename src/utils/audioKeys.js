// Gemeinsame, reine Hash-/Dateinamen-Logik fuer Audio (App UND Generator).
//
// Dateiname: <areaId>__<itemId>__<kind>__<hash8>.mp3
//   kind  : q = Frage, s = Loesung
//   hash8 : erste 8 Hex-Zeichen von sha256(AUDIO_PROFILE + "|" + spokenText)
//
// Aendert sich der Sprechtext oder das Profil (Stimme/Engine), aendert sich der
// Dateiname: veraltetes Audio wird dann nicht gefunden und schweigt, statt
// falsch zu sprechen. Kein Text im Dateinamen, kein Manifest.

import { sha256Hex } from './sha256.js'
import { getSpokenTexts } from './audioText.js'

export const AUDIO_PROFILE = 'kokoro-bf_emma-v1'
export const AUDIO_EXTENSION = '.mp3'
export const AUDIO_KIND_QUESTION = 'q'
export const AUDIO_KIND_SOLUTION = 's'

export async function audioTextHash(spokenText, profile = AUDIO_PROFILE) {
  const bytes = new TextEncoder().encode(`${profile}|${spokenText}`)
  return (await sha256Hex(bytes)).slice(0, 8)
}

export function buildAudioFileName(areaId, itemId, kind, hash8) {
  return `${areaId}__${itemId}__${kind}__${hash8}${AUDIO_EXTENSION}`
}

// Liefert { q, s } mit Dateinamen oder null, wenn es keinen Sprechtext gibt.
export async function getAudioFileNames(areaId, item, profile = AUDIO_PROFILE) {
  const result = { q: null, s: null }
  const itemId = item?.itemId ?? item?.id
  if (typeof areaId !== 'string' || areaId === '' || typeof itemId !== 'string' || itemId === '') return result

  const { question, solution } = getSpokenTexts(item)
  if (question) result.q = buildAudioFileName(areaId, itemId, AUDIO_KIND_QUESTION, await audioTextHash(question, profile))
  if (solution) result.s = buildAudioFileName(areaId, itemId, AUDIO_KIND_SOLUTION, await audioTextHash(solution, profile))
  return result
}
