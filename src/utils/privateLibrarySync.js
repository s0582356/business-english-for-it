// Leichte Synchronisierung zwischen gleichzeitig geoeffneten App-Instanzen (Tabs, Safari + Home-Bildschirm-App
// desselben Browsers). Sie verbessert nur die ANZEIGE: Der eigentliche Schutz vor veralteten Staenden liegt in den
// atomaren IndexedDB-Transaktionen (privateLibraryStore.js) und funktioniert auch ohne diese Nachrichten.
//
// Datenschutz und Robustheit:
//   - Die Nachricht ist ein reines "Es hat sich etwas geaendert"-Signal { type, from }. Sie enthaelt weder JSON-Inhalte
//     noch Dateinamen, Versionen, Antworten oder Lernstaende.
//   - Der Empfaenger liest daraufhin nur den Speicherstand neu (inspect). Er importiert nichts, schreibt nichts und
//     sendet nichts zurueck -> keine Schleifen, keine Aenderung des Fortschritts.
//   - Ausloeser: BroadcastChannel, `storage`-Ereignis der kleinen Merkliste (Fallback) und erneutes Sichtbarwerden
//     der App (visibilitychange / pageshow, z. B. nach dem Wechsel zurueck zur iPhone-App).

export const SYNC_CHANNEL_NAME = 'businessEnglishPrivateLibraries:sync'
export const SYNC_MESSAGE_TYPE = 'private-libraries-changed'
// Gleicher Wert wie STORED_MARKER_KEY (privateLibraryPersistence.js); hier fest eingetragen, um keine Abhaengigkeit
// in die Gegenrichtung zu schaffen.
const MARKER_STORAGE_KEY = 'businessEnglishStoredLibraries:v1'

function randomId() {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `i-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  } catch {
    return `i-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  }
}

// `BroadcastChannelImpl`, `win` und `doc` sind austauschbar (Tests). Fehlt etwas, entfaellt nur der jeweilige Ausloeser.
export function createSyncChannel({
  BroadcastChannelImpl = globalThis.BroadcastChannel,
  win = globalThis.window,
  doc = globalThis.document,
} = {}) {
  const instanceId = randomId()
  const listeners = new Set()
  let channel = null
  const cleanups = []

  const emitChange = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // ein fehlerhafter Listener darf die Synchronisierung nicht stoppen
      }
    }
  }

  try {
    if (typeof BroadcastChannelImpl === 'function') {
      channel = new BroadcastChannelImpl(SYNC_CHANNEL_NAME)
      channel.onmessage = (event) => {
        const data = event?.data
        // Strikte Pruefung: nur das eigene Signal, nie die eigene Instanz, nie fremde Inhalte.
        if (data && typeof data === 'object' && data.type === SYNC_MESSAGE_TYPE && typeof data.from === 'string' && data.from !== instanceId) emitChange()
      }
    }
  } catch {
    channel = null
  }

  if (win?.addEventListener) {
    const onStorage = (event) => {
      if (event?.key === MARKER_STORAGE_KEY) emitChange()
    }
    const onPageShow = () => emitChange()
    win.addEventListener('storage', onStorage)
    win.addEventListener('pageshow', onPageShow)
    cleanups.push(() => win.removeEventListener('storage', onStorage), () => win.removeEventListener('pageshow', onPageShow))
  }
  if (doc?.addEventListener) {
    const onVisibility = () => {
      if (doc.visibilityState === 'visible') emitChange()
    }
    doc.addEventListener('visibilitychange', onVisibility)
    cleanups.push(() => doc.removeEventListener('visibilitychange', onVisibility))
  }

  return {
    instanceId,
    // Meldet anderen Instanzen: "Der gespeicherte Bestand hat sich geaendert" (ohne Inhalt).
    notifyChanged() {
      try {
        channel?.postMessage({ type: SYNC_MESSAGE_TYPE, from: instanceId })
      } catch {
        // ohne Kanal bleibt es bei den anderen Ausloesern
      }
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      listeners.clear()
      cleanups.splice(0).forEach((cleanup) => cleanup())
      try {
        channel?.close()
      } catch {
        // schon geschlossen
      }
      channel = null
    },
  }
}
