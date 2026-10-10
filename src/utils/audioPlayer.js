// Ein einziges, wiederverwendetes HTMLAudioElement (kein Web Audio).
//
// - Immer nur ein Audio gleichzeitig: play() stoppt das vorherige.
// - Race-Schutz: jedes play()/stop() erhoeht requestId; verspaetete
//   play()-Promises (AbortError nach Wechsel, spaete Rejections) werden als
//   "stale" verworfen und nie als Fehler gewertet.
// - Auf iOS muss das Element einmal per Nutzergeste "entsperrt" werden;
//   danach duerfen programmatische play()-Aufrufe (Autoplay) klappen.
//   unlock() spielt dafuer ein winziges stilles Audio.

function silentWavUrl() {
  const sampleCount = 800
  const bytes = new Uint8Array(44 + sampleCount)
  const view = new DataView(bytes.buffer)
  const writeText = (offset, text) => [...text].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0) })
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + sampleCount, true)
  writeText(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true) // 8 bit
  writeText(36, 'data')
  view.setUint32(40, sampleCount, true)
  bytes.fill(128, 44) // 8-bit PCM: 128 = Stille
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:audio/wav;base64,${btoa(binary)}`
}

export function createAudioPlayer({ createAudio = () => new Audio(), onError = () => {} } = {}) {
  let audio = null
  let requestId = 0
  let currentUrl = null
  let unlocked = false
  let playbackRate = 1

  // Beim Laden einer neuen Quelle setzt der Browser playbackRate auf
  // defaultPlaybackRate zurueck - deshalb werden beide gesetzt, und zwar
  // NACH dem Setzen von src.
  function applyRate(target) {
    target.defaultPlaybackRate = playbackRate
    target.playbackRate = playbackRate
  }

  function element() {
    if (!audio) {
      audio = createAudio()
      audio.preload = 'auto'
      audio.addEventListener?.('error', () => {
        // Nur Fehler der aktuell gewaehlten Quelle melden (nicht die stille Unlock-Datei).
        if (currentUrl && audio.src === currentUrl) onError(currentUrl)
      })
      // Safari setzt die Rate teils erst beim Laden der Metadaten zurueck.
      audio.addEventListener?.('loadedmetadata', () => { if (currentUrl && audio.src === currentUrl) applyRate(audio) })
    }
    return audio
  }

  function stop() {
    requestId++
    if (!audio) return
    try {
      audio.pause()
      audio.currentTime = 0
    } catch {
      // z. B. Element ohne geladene Quelle - harmlos.
    }
  }

  // Liefert { ok: true } | { ok: false, stale: true } | { ok: false, error }.
  async function play(url) {
    const id = ++requestId
    const target = element()
    try {
      target.pause()
      target.muted = false // ein noch laufender unlock() darf echte Wiedergabe nicht stummschalten
      if (currentUrl !== url || target.src !== url) {
        currentUrl = url
        target.src = url
      }
      target.currentTime = 0
      applyRate(target) // gilt fuer Frage, Loesung, Wiederholen und Autoplay gleich
      await target.play()
      if (id !== requestId) return { ok: false, stale: true }
      unlocked = true
      return { ok: true }
    } catch (error) {
      if (id !== requestId) return { ok: false, stale: true }
      return { ok: false, error }
    }
  }

  // Muss synchron aus einem Nutzer-Klick/Tap aufgerufen werden.
  function unlock() {
    if (unlocked) return
    const target = element()
    const id = ++requestId
    try {
      currentUrl = null
      target.src = silentWavUrl()
      target.muted = true
      const attempt = target.play()
      Promise.resolve(attempt).then(() => {
        if (id === requestId) target.pause()
        unlocked = true
      }).catch(() => {}).finally(() => { target.muted = false })
    } catch {
      target.muted = false
    }
  }

  // Gibt die Quelle des Elements frei (z. B. vor dem Revoken der Object-URLs bei Packwechsel/dispose).
  function release() {
    requestId++
    currentUrl = null
    if (!audio) return
    try {
      audio.pause()
      if (typeof audio.removeAttribute === 'function') audio.removeAttribute('src')
      else audio.src = ''
    } catch {
      // Element ohne Quelle - harmlos.
    }
  }

  // Wirkt sofort auch auf laufende Wiedergabe und auf jede folgende.
  function setPlaybackRate(rate) {
    playbackRate = rate
    if (audio && currentUrl) applyRate(audio)
  }

  return {
    play,
    stop,
    unlock,
    release,
    setPlaybackRate,
    get isUnlocked() { return unlocked },
    get currentUrl() { return currentUrl },
  }
}
