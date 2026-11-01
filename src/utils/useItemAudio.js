// Composable fuer die Renderer (Choice/Gap/Ordered): bindet ein Item an den
// Audio-Controller. Ohne bereitgestellten Controller (z. B. Komponententests
// oder kein Audio-Pack) ist alles inaktiv - die Renderer verhalten sich dann
// exakt wie vorher.
//
// getItem()    -> aktuelles Item
// isRevealed() -> true erst NACH der Abgabe. Die Loesungs-Audio kann nur dann
//                 abgespielt oder angeboten werden.
// options.autoplay (Standard true) -> false schaltet das automatische Vorlesen fuer dieses Item ab
//                 (Lerncoach-Beispielzeilen: mehrere Zeilen gleichzeitig duerfen nicht von selbst starten).
// playQuestion({ slow: true }) / playSolution({ slow: true }) spielt einmalig langsam (kleinstes
//                 Raster-Tempo), ohne die globale Tempo-Einstellung zu aendern.

import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { AUDIO_CONTROLLER_KEY } from './audioController.js'
import { PLAYBACK_RATE_MIN } from './audioSettings.js'

export function useItemAudio(getItem, isRevealed, { autoplay = true } = {}) {
  const audio = inject(AUDIO_CONTROLLER_KEY, null)
  if (!audio) {
    return {
      canPlayQuestion: computed(() => false),
      canPlaySolution: computed(() => false),
      playQuestion() {},
      playSolution() {},
    }
  }

  const owner = Symbol('item-audio')
  const files = ref({ q: null, s: null })
  let loadId = 0

  async function loadFiles(item) {
    const id = ++loadId
    const resolved = await audio.resolveFiles(item)
    if (id !== loadId) return null
    files.value = resolved
    return resolved
  }

  // Itemwechsel: altes Audio stoppen, Dateien suchen, vorbereiten, ggf. Frage starten.
  watch(getItem, async (item) => {
    audio.stop(owner)
    files.value = { q: null, s: null }
    const resolved = await loadFiles(item)
    if (!resolved) return
    audio.prepare(resolved)
    if (autoplay && audio.audioEnabled.value && audio.autoPlay.value && resolved.q && !isRevealed()) {
      audio.playFile(resolved.q, { owner, auto: true })
    }
  }, { immediate: true })

  // Defekte Datei / neues Pack: Verfuegbarkeit neu berechnen (ohne Autoplay).
  watch([() => audio.packRevision.value, () => audio.brokenRevision.value], () => {
    const item = getItem()
    if (item) loadFiles(item)
  })

  // Erst nach der Abgabe: richtige Loesung automatisch sprechen.
  watch(isRevealed, (revealed) => {
    if (revealed && autoplay && audio.audioEnabled.value && audio.autoPlay.value && files.value.s) {
      audio.playFile(files.value.s, { owner, auto: true })
    }
  })

  onBeforeUnmount(() => audio.stop(owner))

  return {
    canPlayQuestion: computed(() => audio.audioEnabled.value && Boolean(files.value.q)),
    canPlaySolution: computed(() => audio.audioEnabled.value && isRevealed() && Boolean(files.value.s)),
    playQuestion(options) {
      if (files.value.q) audio.playFile(files.value.q, { owner, rate: options?.slow === true ? PLAYBACK_RATE_MIN : null })
    },
    playSolution(options) {
      // Harte Sperre: vor der Abgabe wird die Loesung nie gesprochen.
      if (isRevealed() && files.value.s) audio.playFile(files.value.s, { owner, rate: options?.slow === true ? PLAYBACK_RATE_MIN : null })
    },
  }
}
