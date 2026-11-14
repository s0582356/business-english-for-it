// Import und lokale Wiederherstellung der Sprech-Bibliothek ueber den gemeinsamen Pfad (Controller + IndexedDB).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPrivateLibraryController } from '../privateLibraryController.js'
import { createLibraryPersistence } from '../privateLibraryPersistence.js'
import { createPrivateLibraryStore } from '../privateLibraryStore.js'
import { importSpeakingFiles, partitionSpeakingFiles } from '../speakingImport.js'
import { fileOf, freshEnvironment } from './privateStorageTestHelpers.js'
import { speakingData } from './speakingTestHelpers.js'

const tabs = []
function makeSpeakingTab() {
  const registries = {
    quiz: { libraryByAreaId: {}, conflictsByAreaId: {} },
    coach: { entry: null, conflict: null },
    figures: { entry: null, conflict: null },
    practice: { entry: null, conflict: null },
    speaking: { entry: null, conflict: null },
  }
  const store = createPrivateLibraryStore()
  const controller = createPrivateLibraryController({
    persistence: createLibraryPersistence({ store }),
    getRegistries: () => registries,
    apply: {
      quiz() {},
      coach() {},
      figures() {},
      practice() {},
      speaking: (result) => { registries.speaking = { entry: result.entry, conflict: result.conflict } },
    },
    sync: null,
  })
  const tab = {
    registries,
    controller,
    importFiles: (files) => controller.enqueue(async () => controller.persistOutcomes(await controller.importJson(files))),
    close() { controller.dispose(); store.close() },
  }
  tabs.push(tab)
  return tab
}

beforeEach(freshEnvironment)
afterEach(() => { while (tabs.length) tabs.pop().close() })

describe('Sprech-Bibliothek: Import', () => {
  it('wird am type erkannt und von anderen Dateien getrennt', async () => {
    const { speakingFiles, otherFiles } = await partitionSpeakingFiles([fileOf(speakingData(), 'speak.json'), fileOf({ type: 'businessEnglishLibrary' }, 'quiz.json'), fileOf('{kaputt', 'bad.json')])
    expect(speakingFiles.map((file) => file.name)).toEqual(['speak.json'])
    expect(otherFiles.map((file) => file.name)).toEqual(['quiz.json', 'bad.json'])
  })

  it('laedt, erkennt Duplikate, aktualisiert und meldet Fehler je Datei', async () => {
    const first = await importSpeakingFiles([fileOf(speakingData(), 'v1.json')])
    expect(first.report.loaded).toHaveLength(1)
    expect(first.entry.library.exercises).toHaveLength(8)

    const duplicate = await importSpeakingFiles([fileOf(speakingData(), 'copy.json')], first)
    expect(duplicate.report.duplicates).toHaveLength(1)

    const upgrade = await importSpeakingFiles([fileOf(speakingData({ libraryVersion: 2 }), 'v2.json')], first)
    expect(upgrade.report.upgrades).toHaveLength(1)
    expect(upgrade.entry.library.libraryVersion).toBe(2)

    const broken = speakingData()
    broken.exercises[0].category = 'unbekannt'
    const failed = await importSpeakingFiles([fileOf(broken, 'broken.json')], first)
    expect(failed.report.errors[0].fileName).toBe('broken.json')
    expect(failed.entry.library.libraryVersion).toBe(1) // bisherige Bibliothek bleibt aktiv
  })

  it('zu grosse Dateien werden abgelehnt', async () => {
    const big = new File(['x'.repeat(10)], 'big.json')
    Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 })
    const result = await importSpeakingFiles([big])
    expect(result.report.errors[0].reason).toMatch(/zu groß/)
  })
})

describe('Sprech-Bibliothek: lokale Speicherung und Wiederherstellung', () => {
  it('wird gespeichert und nach "Neustart" ueber denselben Importpfad wieder aktiviert', async () => {
    const tab = makeSpeakingTab()
    await tab.importFiles([fileOf(speakingData(), 'speak.json')])
    expect(tab.registries.speaking.entry.library.libraryId).toBe('demo-speaking-v1')
    expect(tab.controller.state.records.map((record) => record.kind)).toContain('speaking')

    const restarted = makeSpeakingTab()
    expect(restarted.registries.speaking.entry).toBeNull()
    await restarted.controller.restore()
    expect(restarted.controller.state.status).toBe('ready')
    expect(restarted.registries.speaking.entry.library.exercises).toHaveLength(8)
    expect(restarted.controller.isActive(restarted.controller.state.records.find((record) => record.kind === 'speaking'))).toBe(true)
  })

  it('Entfernen deaktiviert die Bibliothek', async () => {
    const tab = makeSpeakingTab()
    await tab.importFiles([fileOf(speakingData(), 'speak.json')])
    const record = tab.controller.state.records.find((entry) => entry.kind === 'speaking')
    const prepared = await tab.controller.prepareRemoval(record.key)
    expect(prepared.snapshot).toBeTruthy()
    await tab.controller.remove(record.key, prepared.snapshot)
    expect(tab.registries.speaking.entry).toBeNull()
  })
})
