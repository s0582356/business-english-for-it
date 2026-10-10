// Audio-Einstellungen: zwei Booleans und eine Zahl (Sprechtempo), lokal
// gespeichert. Es werden niemals Inhalte, Dateinamen oder Audio-Daten persistiert.

export const AUDIO_SETTINGS_KEY = 'businessEnglishAudio:v1'

export const PLAYBACK_RATE_MIN = 0.75
export const PLAYBACK_RATE_MAX = 1.2
export const PLAYBACK_RATE_STEP = 0.05
export const DEFAULT_PLAYBACK_RATE = 1

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({ audioEnabled: true, autoPlay: true, playbackRate: DEFAULT_PLAYBACK_RATE })

// Gueltig sind nur die zehn Rasterwerte 0.75, 0.80 ... 1.20. Alles andere
// (andere Typen, NaN, ausserhalb des Bereichs, neben dem Raster) -> null.
export function parsePlaybackRate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const steps = Math.round(value / PLAYBACK_RATE_STEP)
  if (Math.abs(value / PLAYBACK_RATE_STEP - steps) > 1e-6) return null
  const rate = Math.round(steps * PLAYBACK_RATE_STEP * 100) / 100
  return rate >= PLAYBACK_RATE_MIN && rate <= PLAYBACK_RATE_MAX ? rate : null
}

// Anzeige mit Komma (deutsche UI): 0.9 -> "0,90×". Intern bleibt es eine Zahl.
export function formatPlaybackRate(rate) {
  return `${rate.toFixed(2).replace('.', ',')}×`
}

export function loadAudioSettings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AUDIO_SETTINGS_KEY))
    return {
      audioEnabled: typeof parsed?.audioEnabled === 'boolean' ? parsed.audioEnabled : DEFAULT_AUDIO_SETTINGS.audioEnabled,
      autoPlay: typeof parsed?.autoPlay === 'boolean' ? parsed.autoPlay : DEFAULT_AUDIO_SETTINGS.autoPlay,
      playbackRate: parsePlaybackRate(parsed?.playbackRate) ?? DEFAULT_PLAYBACK_RATE,
    }
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS }
  }
}

export function saveAudioSettings({ audioEnabled, autoPlay, playbackRate }) {
  try {
    window.localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({
      audioEnabled: Boolean(audioEnabled),
      autoPlay: Boolean(autoPlay),
      playbackRate: parsePlaybackRate(playbackRate) ?? DEFAULT_PLAYBACK_RATE,
    }))
    return true
  } catch {
    return false
  }
}
