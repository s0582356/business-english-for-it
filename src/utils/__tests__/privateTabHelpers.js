// Test-Helfer fuer Mehrtab-Szenarien (Auftrag 091): "Tab" = eigener Controller + eigener Store + eigenes Register,
// aber gemeinsamer IndexedDB-Datenbestand. Nur kuenstliche Demo-Daten.
import { createPrivateLibraryController } from '../privateLibraryController.js'
import { createLibraryPersistence } from '../privateLibraryPersistence.js'
import { createPrivateLibraryStore } from '../privateLibraryStore.js'

export function makeTab({ sync = null, now } = {}) {
  const registries = {
    quiz: { libraryByAreaId: {}, conflictsByAreaId: {} },
    coach: { entry: null, conflict: null },
    figures: { entry: null, conflict: null },
    practice: { entry: null, conflict: null },
  }
  const store = createPrivateLibraryStore()
  const controller = createPrivateLibraryController({
    persistence: createLibraryPersistence({ store }),
    getRegistries: () => registries,
    apply: {
      quiz: (result) => { registries.quiz = { libraryByAreaId: result.libraryByAreaId, conflictsByAreaId: result.conflictsByAreaId } },
      coach: (result) => { registries.coach = { entry: result.entry, conflict: result.conflict } },
      figures: (result) => { registries.figures = { entry: result.entry, conflict: result.conflict } },
      practice: (result) => { registries.practice = { entry: result.entry, conflict: result.conflict } },
    },
    sync,
    ...(now ? { now } : {}),
  })
  return {
    registries,
    controller,
    store,
    // Entspricht der Dateiauswahl im Importer: importieren, dann lokal speichern (eine Warteschlange).
    importFiles: (files) =>
      controller.enqueue(async () => {
        const outcomes = await controller.importJson(files)
        await controller.persistOutcomes(outcomes)
      }),
    restore: () => controller.restore(),
    activeVersion: (areaId = 'test-area') => registries.quiz.libraryByAreaId[areaId]?.library.libraryVersion ?? null,
    close() {
      controller.dispose()
      store.close()
    },
  }
}

// Was wirklich im gemeinsamen Speicher steht (unabhaengig von jedem Tab).
export async function storedSnapshot() {
  const store = createPrivateLibraryStore()
  try {
    const { records, corrupt } = await store.list()
    return { keys: records.map((record) => `${record.key}@${record.libraryVersion}`).sort(), records, corrupt }
  } finally {
    store.close()
  }
}

// Ersatz fuer BroadcastChannel mit gemeinsamem "Draht" und Mitschnitt aller Nachrichten.
export function createFakeBroadcast({ drop = false } = {}) {
  const channels = new Set()
  const log = []
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name
      this.onmessage = null
      channels.add(this)
    }
    postMessage(message) {
      log.push(JSON.parse(JSON.stringify(message)))
      if (drop) return
      for (const other of channels) {
        if (other !== this && other.name === this.name) setTimeout(() => other.onmessage?.({ data: JSON.parse(JSON.stringify(message)) }), 0)
      }
    }
    close() {
      channels.delete(this)
    }
  }
  return { FakeBroadcastChannel, log }
}
