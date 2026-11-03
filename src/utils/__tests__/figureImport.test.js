import { describe, expect, it } from 'vitest'
import { FIGURE_LIMITS } from '../figureLibrary.js'
import { importFigureFiles, partitionFigureFiles } from '../figureImport.js'
import { importLibraryFiles } from '../libraryImport.js'
import { jsonFile } from './coachTestHelpers.js'
import { figureData, figureDataV2, withFigure } from './figureTestHelpers.js'

const quizLibrary = () => ({
  type: 'businessEnglishLibrary', schemaVersion: 1, libraryId: 'quiz-test', libraryVersion: 1, areaId: 'test-area', areaTitle: 'Test',
  lessons: [{ lessonId: 'l1', lessonTitle: 'L', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S', items: [
    { itemId: 'item-a', type: 'choice', prompt: 'Q?', options: ['A', 'B'], correctAnswer: 'A', explanation: 'E' },
  ] }] }],
})

describe('Figuren-Import: Typerkennung', () => {
  it('trennt Figuren-Dateien von Quiz-Bibliotheken, defektem JSON und Nicht-Objekten', async () => {
    const broken = new File(['{kaputt'], 'kaputt.json', { type: 'application/json' })
    const { figureFiles, otherFiles } = await partitionFigureFiles([
      jsonFile(figureData(), 'figuren.json'), jsonFile(quizLibrary(), 'quiz.json'), broken, jsonFile([1, 2], 'liste.json'),
    ])
    expect(figureFiles.map((file) => file.name)).toEqual(['figuren.json'])
    expect(otherFiles.map((file) => file.name)).toEqual(['quiz.json', 'kaputt.json', 'liste.json'])
  })
})

describe('Figuren-Import: Registry (nur Speicher)', () => {
  it('laedt eine gueltige Datei ohne etwas zu persistieren', async () => {
    window.localStorage.clear()
    const result = await importFigureFiles([jsonFile(figureData(), 'f.json')])
    expect(result.entry.library.figures).toHaveLength(2)
    expect(result.entry.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(result.report.loaded).toHaveLength(1)
    expect(window.localStorage.length).toBe(0)
  })

  it('meldet Schemafehler lesbar auf Deutsch und laedt nichts', async () => {
    const result = await importFigureFiles([jsonFile(withFigure(figureData(), { series: [{ name: 'A', values: [1, 2] }] }), 'schlecht.json')])
    expect(result.entry).toBeNull()
    expect(result.report.errors[0]).toMatchObject({ fileName: 'schlecht.json' })
    expect(result.report.errors[0].reason).toContain('genau 3 Werte')
  })

  it('meldet kaputtes JSON und zu grosse Dateien, ohne die geladene Figuren-Bibliothek zu veraendern', async () => {
    const loaded = await importFigureFiles([jsonFile(figureData(), 'ok.json')])
    const broken = new File(['{kaputt'], 'kaputt.json', { type: 'application/json' })
    const huge = new File([JSON.stringify({ ...figureData(), pad: 'x'.repeat(FIGURE_LIMITS.fileBytes + 10) })], 'riesig.json', { type: 'application/json' })
    const result = await importFigureFiles([broken, huge], loaded)
    expect(result.entry).toBe(loaded.entry)
    expect(result.report.errors.map((entry) => entry.fileName).sort()).toEqual(['kaputt.json', 'riesig.json'])
    expect(result.report.errors.find((entry) => entry.fileName === 'riesig.json').reason).toContain('zu groß')
  })

  it('Duplikat, Upgrade, aeltere Version und Konflikt folgen den Bibliotheksregeln', async () => {
    const v1 = await importFigureFiles([jsonFile(figureData(), 'v1.json')])
    const duplicate = await importFigureFiles([jsonFile(figureData(), 'kopie.json')], v1)
    expect(duplicate.report.duplicates).toHaveLength(1)

    const v2Data = withFigure({ ...figureData(), libraryVersion: 2 }, { title: 'Demo line v2' })
    const upgrade = await importFigureFiles([jsonFile(v2Data, 'v2.json')], v1)
    expect(upgrade.report.upgrades).toHaveLength(1)
    expect(upgrade.entry.library.figures[0].title).toBe('Demo line v2')

    const older = await importFigureFiles([jsonFile(figureData(), 'alt.json')], upgrade)
    expect(older.report.ignored).toHaveLength(1)
    expect(older.entry.library.libraryVersion).toBe(2)

    const conflict = await importFigureFiles([jsonFile(withFigure(figureData(), { title: 'Anders' }), 'konflikt.json')], v1)
    expect(conflict.report.conflicts).toHaveLength(1)
    expect(conflict.entry).toBeNull()
    expect(conflict.conflict.reason).toBe('same-version-different-fingerprint')
  })

  it('ist unabhaengig von der Dateireihenfolge im Batch', async () => {
    const a = jsonFile(figureData(), 'A.json')
    const b = jsonFile(withFigure(figureData(), { title: 'Variante B' }), 'B.json')
    const ab = await importFigureFiles([a, b])
    const ba = await importFigureFiles([b, a])
    expect(ab.entry).toBeNull()
    expect(ba.entry).toBeNull()
    expect(ab.report.conflicts.map((entry) => entry.fileName).sort()).toEqual(ba.report.conflicts.map((entry) => entry.fileName).sort())
  })
})

describe('Figuren-Import: Unabhaengigkeit von der W3-Bibliothek', () => {
  it('Quiz-Bibliothek und Figuren koennen in beliebiger Reihenfolge geladen werden (gleiches Ergebnis)', async () => {
    const quizFirst = await importLibraryFiles([jsonFile(quizLibrary(), 'quiz.json')])
    const figuresAfter = await importFigureFiles([jsonFile(figureData(), 'f.json')])
    const figuresFirst = await importFigureFiles([jsonFile(figureData(), 'f.json')])
    const quizAfter = await importLibraryFiles([jsonFile(quizLibrary(), 'quiz.json')])
    expect(figuresAfter.entry.fingerprint).toBe(figuresFirst.entry.fingerprint)
    expect(quizFirst.libraryByAreaId['test-area'].fingerprint).toBe(quizAfter.libraryByAreaId['test-area'].fingerprint)
  })

  it('eine fehlerhafte Figuren-Datei laesst die Quiz-Bibliothek unberuehrt', async () => {
    const quiz = await importLibraryFiles([jsonFile(quizLibrary(), 'quiz.json')])
    const before = JSON.stringify(quiz.libraryByAreaId)
    const bad = await importFigureFiles([jsonFile({ ...figureData(), figures: [] }, 'bad.json')])
    expect(bad.entry).toBeNull()
    expect(JSON.stringify(quiz.libraryByAreaId)).toBe(before)
    expect(Object.keys(quiz.conflictsByAreaId)).toHaveLength(0)
  })
})

describe('Figuren-Import: Schema 1 und 2', () => {
  it('eine Schema-2-Datei mit Sprechtraining aktualisiert eine geladene Schema-1-Datei (Upgrade) und umgekehrt wird die neuere behalten', async () => {
    const v1 = await importFigureFiles([jsonFile(figureData(), 'alt.json')])
    expect(v1.entry.library.figures[0].speaking).toBeUndefined()
    const v2 = await importFigureFiles([jsonFile(figureDataV2(), 'neu.json')], v1)
    expect(v2.report.upgrades).toHaveLength(1)
    expect(v2.entry.library.figures[0].speaking.sentences).toHaveLength(5)
    const back = await importFigureFiles([jsonFile(figureData(), 'alt.json')], v2)
    expect(back.report.ignored).toHaveLength(1)
    expect(back.entry.library.figures[0].speaking).toBeDefined()
  })

  it('eine fehlerhafte Sprechtrainings-Datei laesst die geladene Bibliothek unveraendert', async () => {
    const loaded = await importFigureFiles([jsonFile(figureDataV2(), 'ok.json')])
    const broken = figureDataV2({ libraryVersion: 3 })
    broken.figures[0].speaking.sentences[0].role = 'unbekannt'
    const result = await importFigureFiles([jsonFile(broken, 'kaputt.json')], loaded)
    expect(result.entry).toBe(loaded.entry)
    expect(result.report.errors[0].reason).toContain('role')
  })
})
