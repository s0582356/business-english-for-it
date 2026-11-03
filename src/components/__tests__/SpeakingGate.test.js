import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import App from '../../App.vue'
import { getItemStatus } from '../../utils/progressStorage.js'
import { importFigureFiles } from '../../utils/figureImport.js'
import { importLibraryFiles } from '../../utils/libraryImport.js'
import { jsonFile } from '../../utils/__tests__/coachTestHelpers.js'
import { figureData, speakingData } from '../../utils/__tests__/figureTestHelpers.js'

const quizData = () => ({
  type: 'businessEnglishLibrary', schemaVersion: 1, libraryId: 'quiz-test', libraryVersion: 1, areaId: 'test-area', areaTitle: 'Test Area',
  lessons: [{ lessonId: 'l1', lessonTitle: 'Lesson 1', scenarios: [{ scenarioId: 's1', scenarioTitle: 'Scenario 1', items: [
    { itemId: 'item-a', type: 'choice', prompt: 'Question A?', options: ['Yes', 'No'], correctAnswer: 'Yes', explanation: 'E' },
    { itemId: 'item-plain', type: 'choice', prompt: 'Question plain?', options: ['Yes', 'No'], correctAnswer: 'Yes', explanation: 'E' },
    { itemId: 'item-b', type: 'ordered', prompt: 'Order these', steps: [{ id: 'x', label: 'First' }, { id: 'y', label: 'Second' }], correctOrder: ['x', 'y'], explanation: 'E' },
    { itemId: 'item-c', type: 'choice', prompt: 'Question C?', options: ['Yes', 'No'], correctAnswer: 'Yes', explanation: 'E' },
  ] }] }],
})
// Beide Figuren (an item-a und item-b gebunden) tragen neutrale Demo-Beispielsaetze.
const figuresWithSpeaking = (overrides = {}) => {
  const data = figureData({ schemaVersion: 2, libraryVersion: 2, ...overrides })
  data.figures = data.figures.map((figure, index) => ({ ...figure, speaking: { sentences: speakingData().sentences.map((sentence) => ({ ...sentence, sentenceId: `${figure.figureId}-${sentence.sentenceId}`, en: `Demo ${index} ${sentence.en}` })) } }))
  return data
}
const DEMO = /Demo \d Demo sentence/

let quizRegistry
beforeAll(async () => { quizRegistry = await importLibraryFiles([jsonFile(quizData(), 'quiz.json')]) })
beforeEach(() => window.localStorage.clear())

const REAL = { ChartFigure: false, ChartPlot: false, ChartSpeaking: false, ChoiceCard: false, AnswerOption: false, OrderedStepsTrainer: false }
const mountApp = () => shallowMount(App, { global: { stubs: REAL } })
const importerOf = (wrapper) => wrapper.findComponent({ name: 'PrivateContentImporter' })
const navigator = (wrapper) => wrapper.findComponent({ name: 'LearningNavigator' })

async function loadFigures(wrapper, data = figuresWithSpeaking(), name = 'figuren.json') {
  await importerOf(wrapper).vm.$emit('figures-loaded', await importFigureFiles([jsonFile(data, name)], importerOf(wrapper).props('currentFigures')))
  await flushPromises()
}
async function startApp(figures = figuresWithSpeaking()) {
  const wrapper = mountApp()
  await importerOf(wrapper).vm.$emit('libraries-loaded', quizRegistry)
  if (figures) await loadFigures(wrapper, figures)
  await navigator(wrapper).vm.$emit('open-area', 'test-area')
  await navigator(wrapper).vm.$emit('open-lesson', 'l1')
  await navigator(wrapper).vm.$emit('start-scenario', 's1')
  await flushPromises()
  return wrapper
}
const showButton = (wrapper) => wrapper.findAll('.chart-speaking button').find((candidate) => candidate.text().includes('Beispielsätze anzeigen'))
const openSpeaking = async (wrapper) => {
  const details = wrapper.get('details.chart-speaking')
  details.element.open = true
  await details.trigger('toggle')
}
const answer = async (wrapper, label) => {
  await wrapper.findAll('.answer-button').find((candidate) => candidate.text().includes(label)).trigger('click')
  await flushPromises()
}
const nextButton = (wrapper) => wrapper.findAll('button').find((candidate) => /Nächste|Weiter|Ergebnis/.test(candidate.text()))
async function goNext(wrapper) { await nextButton(wrapper).trigger('click'); await flushPromises() }

describe('Sprechhilfe erst nach tatsaechlich abgegebener Antwort', () => {
  it('vor der Antwort: Diagramm sichtbar, Bereich aufklappbar, Hinweis da, Button gesperrt, keine Saetze im DOM', async () => {
    const wrapper = await startApp()
    expect(wrapper.find('.chart-figure svg.chart-svg').exists()).toBe(true)
    await openSpeaking(wrapper)
    expect(wrapper.get('details.chart-speaking').element.open).toBe(true)
    expect(wrapper.get('.chart-speaking-hint').text()).toContain('Versuche zuerst')
    expect(wrapper.get('.chart-speaking-locked').text()).toBe('Beantworte zuerst die Aufgabe. Danach kannst du die fünf Beispielsätze ansehen.')
    expect(showButton(wrapper).attributes('disabled')).toBeDefined()
    await showButton(wrapper).trigger('click')
    expect(wrapper.html()).not.toMatch(DEMO)
    expect(wrapper.find('.chart-speaking-list').exists()).toBe(false)
  })

  it('richtige Antwort (Choice) schaltet frei; die Saetze erscheinen erst nach dem Klick, Deutsch bleibt aus', async () => {
    const wrapper = await startApp()
    await openSpeaking(wrapper)
    await answer(wrapper, 'Yes')
    expect(wrapper.find('.feedback-box').exists()).toBe(true) // bestehendes Quizfeedback
    expect(showButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.chart-speaking-locked').exists()).toBe(false)
    expect(wrapper.html()).not.toMatch(DEMO)
    await showButton(wrapper).trigger('click')
    expect(wrapper.findAll('.chart-speaking-list li')).toHaveLength(5)
    expect(wrapper.find('.chart-speaking-de').exists()).toBe(false)
    expect(wrapper.get('.chart-speaking-hint:last-of-type, .chart-speaking-body').text()).toContain('Versuche jetzt, das Diagramm erneut ohne Hilfe zu beschreiben.')
  })

  it('falsche Antwort (Choice) schaltet ebenfalls frei und bleibt nicht gesperrt', async () => {
    const wrapper = await startApp()
    await openSpeaking(wrapper)
    await answer(wrapper, 'No')
    expect(getItemStatus('test-area', 'item-a')).toMatchObject({ status: 'incorrect' })
    expect(showButton(wrapper).attributes('disabled')).toBeUndefined()
    await showButton(wrapper).trigger('click')
    expect(wrapper.findAll('.chart-speaking-list li')).toHaveLength(5)
  })

  it('Ordered: Umsortieren schaltet nicht frei, erst "Reihenfolge pruefen" (richtig oder falsch)', async () => {
    for (const reorder of [false, true]) {
      const wrapper = await startApp()
      await answer(wrapper, 'Yes'); await goNext(wrapper) // item-a -> item-plain (ohne Figur)
      expect(wrapper.find('.chart-figure').exists()).toBe(false)
      await answer(wrapper, 'Yes'); await goNext(wrapper) // -> item-b (Ordered)
      expect(wrapper.findComponent({ name: 'OrderedStepsTrainer' }).exists()).toBe(true)
      await openSpeaking(wrapper)
      const moves = wrapper.findAll('.ordered-steps button, .step-controls button, button').filter((candidate) => ['▲', '▼'].includes(candidate.text().trim()) && !candidate.element.disabled)
      expect(moves.length).toBeGreaterThan(0)
      await moves[0].trigger('click')
      await flushPromises()
      expect(showButton(wrapper).attributes('disabled')).toBeDefined() // Umsortieren ist noch keine Antwort
      expect(wrapper.html()).not.toMatch(DEMO)
      if (reorder) await moves[0].trigger('click') // nochmals bewegen
      await wrapper.findAll('button').find((candidate) => candidate.text().includes('Reihenfolge prüfen')).trigger('click')
      await flushPromises()
      expect(showButton(wrapper).attributes('disabled')).toBeUndefined()
      await showButton(wrapper).trigger('click')
      expect(wrapper.findAll('.chart-speaking-list li')).toHaveLength(5)
      wrapper.unmount()
    }
  })

  it('uebernimmt keine Freigabe einer anderen Aufgabe: nach "Weiter" ist die naechste Figur wieder gesperrt', async () => {
    const wrapper = await startApp()
    await answer(wrapper, 'Yes')
    expect(showButton(wrapper).attributes('disabled')).toBeUndefined()
    await goNext(wrapper)
    expect(wrapper.find('.chart-figure').exists()).toBe(false) // item-plain: keine Figur
    await answer(wrapper, 'Yes'); await goNext(wrapper)
    expect(wrapper.findComponent({ name: 'OrderedStepsTrainer' }).exists()).toBe(true) // item-b hat Figur und Sprechhilfe
    expect(wrapper.get('.chart-figure').attributes('data-figure-id')).toBe('fig-bar')
    expect(showButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.html()).not.toMatch(DEMO)
  })

  it('Navigation: Zurueck zur Uebersicht und erneuter Start beginnt wieder gesperrt', async () => {
    const wrapper = await startApp()
    await answer(wrapper, 'Yes')
    expect(showButton(wrapper).attributes('disabled')).toBeUndefined()
    await wrapper.get('.back-button').trigger('click')
    await navigator(wrapper).vm.$emit('start-scenario', 's1')
    await flushPromises()
    expect(wrapper.findAll('.answer-button').length).toBeGreaterThan(0)
    expect(wrapper.find('.feedback-box').exists()).toBe(false)
    expect(showButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.html()).not.toMatch(DEMO)
  })

  it('erneuter Import der Figuren (Upgrade) uebernimmt keine alte Freigabe: die Aufgabe beginnt wieder gesperrt', async () => {
    const wrapper = await startApp()
    await answer(wrapper, 'Yes')
    expect(showButton(wrapper).attributes('disabled')).toBeUndefined()
    await wrapper.get('.back-button').trigger('click')
    await navigator(wrapper).vm.$emit('back-to-areas') // der Dateiwaehler liegt in der Bereichsuebersicht
    await loadFigures(wrapper, figuresWithSpeaking({ libraryVersion: 3 }), 'v3.json')
    expect(wrapper.get('[aria-label="Figuren-Bericht"]').text()).toContain('aktualisiert auf Version 3')
    await navigator(wrapper).vm.$emit('open-area', 'test-area')
    await navigator(wrapper).vm.$emit('open-lesson', 'l1')
    await navigator(wrapper).vm.$emit('start-scenario', 's1')
    await flushPromises()
    expect(showButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.html()).not.toMatch(DEMO)
    await answer(wrapper, 'No')
    expect(showButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('aendert die Quizbewertung nicht: gleicher Status, gleicher Score und dieselben Speicherschluessel mit und ohne Figuren', async () => {
    const results = []
    for (const figures of [null, figuresWithSpeaking()]) {
      window.localStorage.clear()
      const wrapper = await startApp(figures)
      await answer(wrapper, 'No'); await goNext(wrapper)
      await answer(wrapper, 'Yes')
      const withoutTime = ({ lastAnsweredAt, ...rest }) => rest // Zeitstempel unterscheiden sich naturgemaess
      results.push({
        a: withoutTime(getItemStatus('test-area', 'item-a')), plain: withoutTime(getItemStatus('test-area', 'item-plain')),
        score: wrapper.findComponent({ name: 'ScoreBox' }).props('score'), keys: Object.keys(window.localStorage).sort(),
      })
      wrapper.unmount()
    }
    expect(results[1]).toEqual(results[0])
    expect(results[0].a).toMatchObject({ status: 'incorrect', attempts: 1 })
    expect(results[0].score).toBe(1)
    expect(JSON.stringify(window.localStorage)).not.toMatch(/speak|sentence|Demo/i)
  })

  it('ohne Figuren oder ohne Speaking-Metadaten: kein Sprechbereich, Quiz unveraendert', async () => {
    for (const figures of [null, figureData()]) {
      const wrapper = await startApp(figures)
      expect(wrapper.find('.chart-speaking').exists()).toBe(false)
      await answer(wrapper, 'Yes')
      expect(wrapper.find('.feedback-box').exists()).toBe(true)
      wrapper.unmount()
    }
  })

  it('Diagrammvergroesserung und Wertetabelle funktionieren vor und nach der Antwort', async () => {
    const wrapper = await startApp()
    for (let round = 0; round < 2; round++) {
      expect(wrapper.find('table.chart-table').exists()).toBe(true)
      await wrapper.get('.chart-enlarge').trigger('click')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
      await wrapper.get('[role="dialog"] button').trigger('click')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      if (round === 0) await answer(wrapper, 'Yes')
    }
  })
})
