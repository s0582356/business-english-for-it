import { beforeEach, describe, expect, it, vi } from 'vitest'
import FDBObjectStore from 'fake-indexeddb/lib/FDBObjectStore'
import { importLibraryFiles } from '../libraryImport.js'
import { importCoachFiles } from '../coachImport.js'
import { LIBRARY_KIND, STORE_ERROR, createPrivateLibraryStore } from '../privateLibraryStore.js'
import { STORED_MARKER_KEY, collectAcceptedRecords, createLibraryPersistence, recordToFile } from '../privateLibraryPersistence.js'
import { fingerprintFile } from '../fingerprint.js'
import { coachLibraryData } from './coachTestHelpers.js'
import { fileOf, freshEnvironment, quizData, quotaError, resetIndexedDb } from './privateStorageTestHelpers.js'

const EMPTY = { libraryByAreaId: {}, conflictsByAreaId: {} }

async function importQuiz(files, registry = EMPTY) {
  const result = await importLibraryFiles(files, registry)
  return { result, records: await collectAcceptedRecords(LIBRARY_KIND.QUIZ, files, result) }
}

beforeEach(freshEnvironment)

describe('collectAcceptedRecords: nur aktivierte Dateien werden gespeichert', () => {
  it('neue Bibliothek: ein Datensatz mit Original-Bytes, Fingerabdruck und Metadaten', async () => {
    const file = fileOf(quizData(), 'a.json')
    const { records } = await importQuiz([file])
    expect(records).toHaveLength(1)
    const [record] = records
    expect(record).toMatchObject({ key: 'quiz:test-area', kind: 'quiz', areaId: 'test-area', libraryId: 'quiz-test', libraryVersion: 1, fileName: 'a.json' })
    expect(record.fingerprint).toBe(await fingerprintFile(file))
    expect(new TextDecoder().decode(record.bytes)).toBe(JSON.stringify(quizData()))
  })

  it('Upgrade auf hoehere Version: Datensatz der neuen Version', async () => {
    const first = await importQuiz([fileOf(quizData(), 'v1.json')])
    const { records } = await importQuiz([fileOf(quizData({ libraryVersion: 2 }), 'v2.json')], first.result)
    expect(records.map((record) => record.libraryVersion)).toEqual([2])
  })

  it.each([
    ['kein JSON', 'kaputt.json', '{ nicht gueltig'],
    ['falscher Typ', 'typ.json', JSON.stringify({ type: 'etwas-anderes' })],
    ['Schemafehler', 'schema.json', JSON.stringify({ ...quizData(), lessons: [] })],
  ])('ungueltige Datei (%s) erzeugt keinen Datensatz', async (_label, name, content) => {
    const { records, result } = await importQuiz([fileOf(content, name)])
    expect(result.report.errors).toHaveLength(1)
    expect(records).toEqual([])
  })

  it('aeltere Version und Konflikt erzeugen keinen Datensatz', async () => {
    const first = await importQuiz([fileOf(quizData({ libraryVersion: 3 }), 'v3.json')])
    const older = await importQuiz([fileOf(quizData({ libraryVersion: 1 }), 'v1.json')], first.result)
    expect(older.result.report.ignored).toHaveLength(1)
    expect(older.records).toEqual([])

    const conflict = await importQuiz([fileOf(quizData({ libraryVersion: 3, prompt: 'Andere Frage?' }), 'v3b.json')], first.result)
    expect(conflict.result.report.conflicts).toHaveLength(1)
    expect(conflict.records).toEqual([])
  })

  it('Duplikat der aktiven Bibliothek liefert denselben Datensatz (zum Wiederherstellen eines verlorenen Bestands)', async () => {
    const first = await importQuiz([fileOf(quizData(), 'a.json')])
    const again = await importQuiz([fileOf(quizData(), 'a-kopie.json')], first.result)
    expect(again.result.report.duplicates).toHaveLength(1)
    expect(again.records.map((record) => record.fingerprint)).toEqual(first.records.map((record) => record.fingerprint))
  })

  it('mehrere Bereiche in einem Batch: je Bereich ein Datensatz', async () => {
    const { records } = await importQuiz([fileOf(quizData({ areaId: 'a', libraryId: 'la' }), 'a.json'), fileOf(quizData({ areaId: 'b', libraryId: 'lb' }), 'b.json')])
    expect(records.map((record) => record.key).sort()).toEqual(['quiz:a', 'quiz:b'])
  })

  it('Lerncoach: Datensatz unter dem festen Schluessel "coach"', async () => {
    const files = [fileOf(coachLibraryData(), 'coach.json')]
    const result = await importCoachFiles(files)
    const records = await collectAcceptedRecords(LIBRARY_KIND.COACH, files, result)
    expect(records.map((record) => record.key)).toEqual(['coach'])
  })
})

describe('Persistenz: speichern und wiederherstellen', () => {
  const newPersistence = () => createLibraryPersistence({ store: createPrivateLibraryStore() })

  it('gespeicherte Dateien kommen als File mit identischem Fingerabdruck zurueck und laufen durch den normalen Import', async () => {
    const original = fileOf(quizData(), 'a.json')
    const { records } = await importQuiz([original])
    const { saved, failed } = await newPersistence().save(records)
    expect(saved).toHaveLength(1)
    expect(failed).toEqual([])

    const restored = await newPersistence().load() // "Neustart": neue Instanzen
    expect(restored.status).toBe('ready')
    expect(restored.invalid).toEqual([])
    expect(restored.missing).toEqual([])
    expect(await fingerprintFile(restored.files[0])).toBe(await fingerprintFile(original))
    const again = await importLibraryFiles(restored.files, EMPTY)
    expect(again.report.loaded).toHaveLength(1)
    expect(again.libraryByAreaId['test-area'].library.libraryVersion).toBe(1)
  })

  it('geaenderte Bytes bei gleichem Fingerabdruck gelten als beschaedigt und werden nicht aktiviert, aber auch nicht geloescht', async () => {
    const { records } = await importQuiz([fileOf(quizData(), 'a.json')])
    const tampered = { ...records[0], bytes: new TextEncoder().encode(JSON.stringify(quizData({ prompt: 'Manipuliert?' }))).buffer }
    tampered.size = tampered.bytes.byteLength
    await createPrivateLibraryStore().forcePut(tampered)

    const restored = await newPersistence().load()
    expect(restored.files).toEqual([])
    expect(restored.invalid.map((entry) => entry.key)).toEqual(['quiz:test-area'])
    expect((await createPrivateLibraryStore().list()).records).toHaveLength(1)
  })

  it('Speicherfehler: gemeldet statt geworfen, bisheriger Stand und Merkliste bleiben', async () => {
    const persistence = newPersistence()
    const v1 = await importQuiz([fileOf(quizData(), 'v1.json')])
    await persistence.save(v1.records)
    const v2 = await importQuiz([fileOf(quizData({ libraryVersion: 2 }), 'v2.json')], v1.result)

    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quotaError()
    })
    const outcome = await persistence.save(v2.records)
    vi.restoreAllMocks()
    expect(outcome.saved).toEqual([])
    expect(outcome.failed).toMatchObject([{ key: 'quiz:test-area', code: STORE_ERROR.QUOTA }])
    expect(outcome.failed[0].message).not.toContain('Demo')

    const restored = await newPersistence().load()
    expect(restored.records.map((record) => record.libraryVersion)).toEqual([1])
    expect(JSON.parse(window.localStorage.getItem(STORED_MARKER_KEY))[0].libraryVersion).toBe(1)
  })

  it('remove entfernt Datensatz und Merklisten-Eintrag', async () => {
    const persistence = newPersistence()
    await persistence.save((await importQuiz([fileOf(quizData(), 'a.json')])).records)
    await persistence.remove('quiz:test-area', await persistence.prepareRemoval('quiz:test-area'))
    const restored = await newPersistence().load()
    expect(restored.records).toEqual([])
    expect(restored.missing).toEqual([])
    expect(window.localStorage.getItem(STORED_MARKER_KEY)).toBeNull()
  })

  it('Merkliste enthaelt nur Schluessel, IDs, Version und Dateiname - keine Inhalte', async () => {
    await newPersistence().save((await importQuiz([fileOf(quizData({ prompt: 'GEHEIMER-INHALT' }), 'a.json')])).records)
    const raw = window.localStorage.getItem(STORED_MARKER_KEY)
    expect(raw).not.toContain('GEHEIMER-INHALT')
    expect(Object.keys(JSON.parse(raw)[0]).sort()).toEqual(['areaId', 'fileName', 'key', 'kind', 'libraryId', 'libraryVersion'])
  })

  it('wurde der Bestand vom System entfernt, meldet load() die Bibliothek als fehlend; Ausblenden vergisst sie', async () => {
    await newPersistence().save((await importQuiz([fileOf(quizData(), 'a.json')])).records)
    resetIndexedDb() // iOS/Browser raeumt IndexedDB auf, localStorage-Merkliste bleibt
    const persistence = newPersistence()
    const restored = await persistence.load()
    expect(restored.status).toBe('ready')
    expect(restored.records).toEqual([])
    expect(restored.missing).toMatchObject([{ key: 'quiz:test-area', fileName: 'a.json', libraryVersion: 1 }])
    persistence.dismissMissing('quiz:test-area')
    expect((await newPersistence().load()).missing).toEqual([])
  })

  it('ohne IndexedDB: Status unavailable, nichts wird geschrieben', async () => {
    globalThis.indexedDB = undefined
    const persistence = newPersistence()
    expect((await persistence.load()).status).toBe('unavailable')
    expect(window.localStorage.length).toBe(0)
  })

  it('leerer Speicher und leere Merkliste: load() schreibt nichts in localStorage', async () => {
    const restored = await newPersistence().load()
    expect(restored).toMatchObject({ status: 'ready', records: [], files: [], invalid: [], missing: [] })
    expect(window.localStorage.length).toBe(0)
  })

  it('recordToFile erhaelt Dateiname und Inhalt', async () => {
    const { records } = await importQuiz([fileOf(quizData(), 'name.json')])
    const file = recordToFile(records[0])
    expect(file.name).toBe('name.json')
    expect(await file.text()).toBe(JSON.stringify(quizData()))
  })
})
