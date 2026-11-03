import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import App from '../../App.vue'
import PrivateContentImporter from '../PrivateContentImporter.vue'
import { getItemStatus } from '../../utils/progressStorage.js'
import { importFigureFiles } from '../../utils/figureImport.js'
import { importLibraryFiles } from '../../utils/libraryImport.js'
import { jsonFile } from '../../utils/__tests__/coachTestHelpers.js'
import { figureData, withFigure } from '../../utils/__tests__/figureTestHelpers.js'

const emptyReport = { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] }
const quizData = {
  type: 'businessEnglishLibrary', schemaVersion: 1, libraryId: 'quiz-test', libraryVersion: 1, areaId: 'test-area', areaTitle: 'Test Area',
  lessons: [{ lessonId: 'l1', lessonTitle: 'Lesson 1', scenarios: [{ scenarioId: 's1', scenarioTitle: 'Scenario 1', items: [
    { itemId: 'item-a', type: 'choice', prompt: 'Question A?', options: ['Yes', 'No'], correctAnswer: 'Yes', explanation: 'E' },
    { itemId: 'item-plain', type: 'choice', prompt: 'Question plain?', options: ['Yes', 'No'], correctAnswer: 'Yes', explanation: 'E' },
    { itemId: 'item-b', type: 'ordered', prompt: 'Order these', steps: [{ id: 'x', label: 'First' }, { id: 'y', label: 'Second' }], correctOrder: ['x', 'y'], explanation: 'E' },
  ] }] }],
}
// Echte Registry aus dem normalen Import (Items tragen areaId/lessonId/scenarioId, wie in der App).
let quizRegistry
beforeAll(async () => { quizRegistry = await importLibraryFiles([jsonFile(quizData, 'quiz.json')]) })

const mountApp = () => shallowMount(App, { global: { stubs: { ChartFigure: false, ChartPlot: false } } })
const importerOf = (wrapper) => wrapper.findComponent({ name: 'PrivateContentImporter' })
const navigator = (wrapper) => wrapper.findComponent({ name: 'LearningNavigator' })

async function startRun(wrapper) {
  await navigator(wrapper).vm.$emit('open-area', 'test-area')
  await navigator(wrapper).vm.$emit('open-lesson', 'l1')
  await navigator(wrapper).vm.$emit('start-scenario', 's1')
}
async function loadFigures(wrapper, data = figureData(), name = 'figuren.json') {
  await importerOf(wrapper).vm.$emit('figures-loaded', await importFigureFiles([jsonFile(data, name)], importerOf(wrapper).props('currentFigures')))
  await flushPromises()
}
const nextItem = async (wrapper) => { await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('next-item'); await flushPromises() }

beforeEach(() => window.localStorage.clear())

describe('Figuren in der Lernrunde', () => {
  it('zeigt die Figur ueber der unveraenderten Frage und nur bei gebundenen Aufgaben', async () => {
    const wrapper = mountApp()
    await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
    await loadFigures(wrapper)
    await startRun(wrapper)

    // item-a: gebunden
    expect(wrapper.find('.quiz-main .chart-figure').exists()).toBe(true)
    const main = wrapper.get('.quiz-main')
    expect(main.element.firstElementChild.classList.contains('chart-figure')).toBe(true)
        expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item')).toMatchObject({ id: 'item-a' })

    // item-plain: keine Bindung -> exakt wie vorher
    await nextItem(wrapper)
    expect(wrapper.find('.chart-figure').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Textalternative')
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(0)
  })

  it('zeigt die Figur auch bei einer Aufgabe vom Typ "ordered"', async () => {
    const wrapper = mountApp()
    await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
    await loadFigures(wrapper)
    await startRun(wrapper)
    await nextItem(wrapper)
    await nextItem(wrapper)
    expect(wrapper.findComponent({ name: 'OrderedStepsTrainer' }).exists()).toBe(true)
    expect(wrapper.get('.chart-figure').attributes('data-figure-id')).toBe('fig-bar')
  })

  it('ohne Figuren-Datei bleibt die Runde unveraendert (kein Fehler, kein Platzhalter, kein Figuren-Bericht)', async () => {
    const wrapper = mountApp()
    await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
    expect(wrapper.find('[aria-label="Figuren-Bericht"]').exists()).toBe(false)
    await startRun(wrapper)
    expect(wrapper.find('.chart-figure').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item')).toMatchObject({ id: 'item-a' })
    expect(wrapper.text()).not.toMatch(/Figur/)
  })

  it('Reihenfolge-unabhaengig: Figuren vor der Quiz-Bibliothek geladen liefert dasselbe Ergebnis', async () => {
    const wrapper = mountApp()
    await loadFigures(wrapper)
    expect(wrapper.text()).not.toContain('passen zu keiner')
    await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
    await startRun(wrapper)
    expect(wrapper.find('.quiz-main .chart-figure').exists()).toBe(true)
  })

  it('beruehrt den Lernfortschritt nicht: Ergebnis wird wie ohne Figur unter areaId + itemId gespeichert', async () => {
    const wrapper = mountApp()
    await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
    await loadFigures(wrapper)
    const before = JSON.stringify(window.localStorage)
    expect(Object.keys(window.localStorage)).not.toContain('figures')
    await startRun(wrapper)
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'Yes')
    expect(getItemStatus('test-area', 'item-a')).toMatchObject({ status: 'correct', attempts: 1 })
    expect(JSON.stringify(window.localStorage)).not.toContain('fig-line')
    expect(before).not.toContain('fig-line')
  })

  it('meldet gebundene, aber unbekannte Aufgaben als Hinweis, ohne etwas zu blockieren', async () => {
    const wrapper = mountApp()
    await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
    await loadFigures(wrapper, { ...figureData(), bindings: [...figureData().bindings, { areaId: 'test-area', itemId: 'item-fehlt', figureId: 'fig-bar' }] })
    expect(wrapper.get('[aria-label="Figuren-Bericht"]').text()).toContain('item-fehlt')
    await startRun(wrapper)
    expect(wrapper.find('.chart-figure').exists()).toBe(true)
  })

  it('zeigt bei einer fehlerhaften Figuren-Datei einen deutschen Fehler, aber weiterhin die normalen Aufgaben', async () => {
    const wrapper = mountApp()
    await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
    await loadFigures(wrapper, withFigure(figureData(), { series: [{ name: 'A', values: [1] }] }), 'kaputt.json')
    const report = wrapper.get('[aria-label="Figuren-Bericht"]').text()
    expect(report).toContain('Fehler in kaputt.json')
    expect(report).toContain('Die Aufgaben bleiben unverändert nutzbar.')
    await startRun(wrapper)
    expect(wrapper.find('.chart-figure').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item')).toMatchObject({ id: 'item-a' })
  })

  it('ein Figuren-Konflikt blendet alle Figuren aus und meldet ihn; die Aufgaben bleiben nutzbar', async () => {
    const wrapper = mountApp()
    await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
    await importerOf(wrapper).vm.$emit('figures-loaded', await importFigureFiles([
      jsonFile(figureData(), 'A.json'), jsonFile(withFigure(figureData(), { title: 'Variante B' }), 'B.json'),
    ]))
    await flushPromises()
    expect(wrapper.get('[aria-label="Figuren-Bericht"]').text()).toContain('Konflikt bei den Figuren')
    await startRun(wrapper)
    expect(wrapper.find('.chart-figure').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item')).toMatchObject({ id: 'item-a' })
  })

  it('ein erneuter fehlerhafter Import behaelt die bereits geladenen Figuren bei', async () => {
    const wrapper = mountApp()
    await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
    await loadFigures(wrapper)
    await loadFigures(wrapper, { ...figureData(), libraryVersion: 0 }, 'schlecht.json')
    await startRun(wrapper)
    expect(wrapper.find('.chart-figure').exists()).toBe(true)
  })
})

describe('Dateiwaehler: Figuren-Datei', () => {
  // Der Import laeuft asynchron (Hash, Dateien lesen): auf die erwarteten Ereignisse warten statt zu raten.
  async function pick(wrapper, files, expectedEvents) {
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')
    await vi.waitFor(() => { for (const name of expectedEvents) expect(wrapper.emitted(name)).toBeTruthy() })
  }
  const quizFile = () => jsonFile({
    type: 'businessEnglishLibrary', schemaVersion: 1, libraryId: 'quiz-test', libraryVersion: 1, areaId: 'test-area', areaTitle: 'Test',
    lessons: [{ lessonId: 'l1', lessonTitle: 'L', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S', items: [
      { itemId: 'item-a', type: 'choice', prompt: 'Q?', options: ['A', 'B'], correctAnswer: 'A', explanation: 'E' },
    ] }] }],
  }, 'quiz.json')

  it('liest Quiz- und Figuren-Datei gemeinsam und meldet sie getrennt', async () => {
    const wrapper = mount(PrivateContentImporter)
    await pick(wrapper, [jsonFile(figureData(), 'f.json'), quizFile()], ['libraries-loaded', 'figures-loaded'])
    expect(wrapper.emitted('libraries-loaded')).toHaveLength(1)
    expect(wrapper.emitted('figures-loaded')).toHaveLength(1)
    expect(wrapper.emitted('libraries-loaded')[0][0].libraryByAreaId['test-area']).toBeTruthy()
    expect(wrapper.emitted('figures-loaded')[0][0].entry.library.libraryId).toBe('test-figures-v1')
    expect(wrapper.emitted('coach-loaded')).toBeUndefined()
  })

  it('eine fehlerhafte Figuren-Datei im selben Batch beschaedigt die Quiz-Bibliothek nicht', async () => {
    const wrapper = mount(PrivateContentImporter)
    await pick(wrapper, [jsonFile({ ...figureData(), figures: 'kaputt' }, 'f.json'), quizFile()], ['libraries-loaded', 'figures-loaded'])
    const quiz = wrapper.emitted('libraries-loaded')[0][0]
    expect(quiz.libraryByAreaId['test-area']).toBeTruthy()
    expect(quiz.report.errors).toHaveLength(0)
    const figures = wrapper.emitted('figures-loaded')[0][0]
    expect(figures.entry).toBeNull()
    expect(figures.report.errors[0].fileName).toBe('f.json')
  })

  it('nur eine Quiz-Datei loest kein figures-loaded aus', async () => {
    const wrapper = mount(PrivateContentImporter)
    await pick(wrapper, [quizFile()], ['libraries-loaded'])
    expect(wrapper.emitted('figures-loaded')).toBeUndefined()
  })
})
