import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PrivateContentImporter from '../PrivateContentImporter.vue'
import { FIGURE_LIMITS } from '../../utils/figureLibrary.js'
import { MAX_JSON_FILE_BYTES, isOversizedFile, oversizeReason } from '../../utils/importLimits.js'
import { importLibraryFiles } from '../../utils/libraryImport.js'
import { importCoachFiles, partitionCoachFiles } from '../../utils/coachImport.js'
import { importFigureFiles, partitionFigureFiles } from '../../utils/figureImport.js'
import { coachLibraryData, jsonFile } from '../../utils/__tests__/coachTestHelpers.js'
import { figureData } from '../../utils/__tests__/figureTestHelpers.js'

const quizData = () => ({
  type: 'businessEnglishLibrary', schemaVersion: 1, libraryId: 'quiz-test', libraryVersion: 1, areaId: 'test-area', areaTitle: 'Test',
  lessons: [{ lessonId: 'l1', lessonTitle: 'L', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S', items: [
    { itemId: 'item-a', type: 'choice', prompt: 'Q?', options: ['A', 'B'], correctAnswer: 'A', explanation: 'E' },
  ] }] }],
})
// Gueltige Figuren-Datei, aufgeblaeht ueber ein unbekanntes Feld (wird vom Validator verworfen).
const paddedFigureFile = (bytes, name) => jsonFile({ ...figureData(), pad: 'x'.repeat(bytes) }, name)
const bigFile = (bytes, name) => new File(['x'.repeat(bytes)], name, { type: 'application/json' })

async function pick(wrapper, files, expectedEvents) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await vi.waitFor(() => { for (const name of expectedEvents) expect(wrapper.emitted(name)).toBeTruthy() })
}

describe('Groessenlimits vor dem Lesen (MINOR-03)', () => {
  it('Limit-Hilfen: exakt am Limit erlaubt, ein Byte darueber nicht; Meldung nennt das Limit', () => {
    expect(isOversizedFile({ size: MAX_JSON_FILE_BYTES })).toBe(false)
    expect(isOversizedFile({ size: MAX_JSON_FILE_BYTES + 1 })).toBe(true)
    expect(isOversizedFile({ size: FIGURE_LIMITS.fileBytes + 1 }, FIGURE_LIMITS.fileBytes)).toBe(true)
    expect(oversizeReason()).toBe('Datei ist zu groß (höchstens 5 MB).')
    expect(oversizeReason(FIGURE_LIMITS.fileBytes)).toBe('Datei ist zu groß (höchstens 512 KB).')
  })

  it('das uebergreifende Limit liegt weit ueber den vorhandenen Bibliotheken (keine Einschraenkung legitimer Dateien)', () => {
    expect(MAX_JSON_FILE_BYTES).toBeGreaterThanOrEqual(30 * 132 * 1024) // groesste vorhandene Bibliothek ca. 130 KB
  })

  it('eine sehr grosse JSON-Datei wird in keinem Importpfad gelesen (text/arrayBuffer/slice nie aufgerufen)', async () => {
    const huge = bigFile(MAX_JSON_FILE_BYTES + 1, 'riesig.json')
    const spies = ['text', 'arrayBuffer', 'slice'].map((method) => vi.spyOn(huge, method))
    const partitionedCoach = await partitionCoachFiles([huge])
    const partitionedFigure = await partitionFigureFiles([huge])
    const library = await importLibraryFiles([huge])
    const coach = await importCoachFiles([huge])
    const figures = await importFigureFiles([huge])
    expect(partitionedCoach.otherFiles).toEqual([huge])
    expect(partitionedFigure.otherFiles).toEqual([huge])
    for (const report of [library.report, coach.report, figures.report]) {
      expect(report.errors).toEqual([{ fileName: 'riesig.json', reason: expect.stringContaining('zu groß') }])
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('Dateiwaehler: uebergrosse Datei wird gemeldet, ohne gelesen zu werden; gueltige Dateien im selben Batch laden', async () => {
    const wrapper = mount(PrivateContentImporter)
    const huge = bigFile(MAX_JSON_FILE_BYTES + 10, 'riesig.json')
    const spy = vi.spyOn(huge, 'text')
    const broken = new File(['{kaputt'], 'kaputt.json', { type: 'application/json' })
    await pick(wrapper, [huge, jsonFile(quizData(), 'quiz.json'), jsonFile(figureData(), 'f.json'), jsonFile(coachLibraryData(), 'coach.json'), broken], ['libraries-loaded', 'figures-loaded', 'coach-loaded'])
    expect(spy).not.toHaveBeenCalled()
    const libraries = wrapper.emitted('libraries-loaded')[0][0]
    expect(libraries.libraryByAreaId['test-area']).toBeTruthy()
    const errors = Object.fromEntries(libraries.report.errors.map((entry) => [entry.fileName, entry.reason]))
    expect(errors['riesig.json']).toContain('zu groß')
    expect(errors['kaputt.json']).toContain('kein gültiges JSON')
    expect(wrapper.emitted('figures-loaded')[0][0].entry.library.libraryId).toBe('test-figures-v1')
    expect(wrapper.emitted('coach-loaded')[0][0].entry.library.libraryId).toBe('test-coach-v1')
  })

  it('gueltige Figurendatei wird angenommen (Grenzfall: knapp unter 512 KB)', async () => {
    const file = paddedFigureFile(FIGURE_LIMITS.fileBytes - 4096, 'knapp-unter.json')
    expect(file.size).toBeLessThanOrEqual(FIGURE_LIMITS.fileBytes)
    const result = await importFigureFiles([file])
    expect(result.entry).not.toBeNull()
    expect(result.report.errors).toEqual([])
  })

  it('Figurendatei knapp ueber 512 KB: als Figuren-Datei erkannt, mit Groessenfehler abgelehnt, nicht im Bibliotheksimport', async () => {
    const wrapper = mount(PrivateContentImporter)
    const file = paddedFigureFile(FIGURE_LIMITS.fileBytes + 1, 'knapp-ueber.json')
    expect(file.size).toBeGreaterThan(FIGURE_LIMITS.fileBytes)
    await pick(wrapper, [file], ['figures-loaded'])
    await flushPromises()
    const figures = wrapper.emitted('figures-loaded')[0][0]
    expect(figures.entry).toBeNull()
    expect(figures.report.errors).toEqual([{ fileName: 'knapp-ueber.json', reason: 'Datei ist zu groß (höchstens 512 KB).' }])
    expect(wrapper.emitted('libraries-loaded')).toBeUndefined() // landete nicht im normalen Bibliotheksimport
  })

  it('eine uebergrosse Figurendatei beschaedigt eine bereits geladene Figuren-Bibliothek nicht', async () => {
    const loaded = await importFigureFiles([jsonFile(figureData(), 'ok.json')])
    const result = await importFigureFiles([paddedFigureFile(FIGURE_LIMITS.fileBytes + 100, 'zu-gross.json')], loaded)
    expect(result.entry).toBe(loaded.entry)
    expect(result.report.errors[0].reason).toContain('zu groß')
  })

  it('bisherige Importe bleiben unveraendert: Quiz, Coach und Figuren in einem Batch', async () => {
    const wrapper = mount(PrivateContentImporter)
    await pick(wrapper, [jsonFile(quizData(), 'quiz.json'), jsonFile(coachLibraryData(), 'coach.json'), jsonFile(figureData(), 'f.json')], ['libraries-loaded', 'figures-loaded', 'coach-loaded'])
    expect(wrapper.emitted('libraries-loaded')[0][0].report.errors).toEqual([])
    expect(wrapper.emitted('coach-loaded')[0][0].report.errors).toEqual([])
    expect(wrapper.emitted('figures-loaded')[0][0].report.errors).toEqual([])
  })

  it('fehlerhaftes JSON wird weiterhin lesbar gemeldet (kein Groessenproblem)', async () => {
    const result = await importLibraryFiles([new File(['{kaputt'], 'kaputt.json', { type: 'application/json' })])
    expect(result.report.errors).toEqual([{ fileName: 'kaputt.json', reason: 'Datei ist kein gültiges JSON.' }])
  })
})
