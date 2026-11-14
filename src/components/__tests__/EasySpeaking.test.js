import { beforeEach, describe, expect, it } from 'vitest'
import { mount, shallowMount } from '@vue/test-utils'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import App from '../../App.vue'
import EasySpeaking from '../EasySpeaking.vue'
import LearningNavigator from '../LearningNavigator.vue'
import { validateSpeakingLibrary } from '../../utils/speakingLibrary.js'
import { importSpeakingFiles } from '../../utils/speakingImport.js'
import { speakingData } from '../../utils/__tests__/speakingTestHelpers.js'

const entryOf = (data = speakingData()) => ({ library: validateSpeakingLibrary(data), fingerprint: 'demo', fileName: 'demo.json' })
const mountSpeaking = (props = {}) => mount(EasySpeaking, { props: { entry: entryOf(), ...props } })
const button = (wrapper, text) => wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
const tab = (wrapper, label) => wrapper.findAll('.speaking-tab').find((candidate) => candidate.text().includes(label))

beforeEach(() => window.localStorage.clear())

describe('EasySpeaking: Bereiche und Navigation', () => {
  it('zeigt fuenf Bereiche mit Anzahl und startet im ersten', () => {
    const wrapper = mountSpeaking()
    const tabs = wrapper.findAll('.speaking-tab')
    expect(tabs.map((entry) => entry.find('strong').text())).toEqual(['Easy Speaking', 'Role Play', 'Business Discussion', 'Graph Description', 'Sentence Builder'])
    expect(tabs[0].text()).toContain('3 Übungen')
    expect(wrapper.text()).toContain('8 Übungen')
    expect(wrapper.get('.speaking-prompt').text()).toBe('Demo question one?')
  })

  it('blaettert vor und zurueck und springt per Auswahl', async () => {
    const wrapper = mountSpeaking()
    expect(button(wrapper, 'Vorherige').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Nächste').trigger('click')
    expect(wrapper.get('.speaking-prompt').text()).toBe('Demo question two?')
    await wrapper.get('.speaking-jump select').setValue('2')
    expect(wrapper.get('.speaking-prompt').text()).toBe('Demo question three?')
    expect(button(wrapper, 'Nächste').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Vorherige').trigger('click')
    expect(wrapper.get('.speaking-prompt').text()).toBe('Demo question two?')
  })

  it('wechselt den Bereich und beginnt dort bei der ersten Uebung', async () => {
    const wrapper = mountSpeaking()
    await button(wrapper, 'Nächste').trigger('click')
    await tab(wrapper, 'Role Play').trigger('click')
    expect(wrapper.get('.speaking-prompt').text()).toBe('Situation: demo role play.')
    expect(wrapper.text()).toContain('Übung 1 von 1')
  })
})

describe('EasySpeaking: Musterantwort', () => {
  it('ist sofort ein- und ausblendbar, ohne Eingabe oder Bewertung', async () => {
    const wrapper = mountSpeaking()
    expect(wrapper.text()).not.toContain('Demo answer one.')
    const toggle = wrapper.get('.practice-solution-toggle')
    expect(toggle.text()).toBe('Musterantwort anzeigen')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(wrapper.get('.speaking-solution').text()).toContain('Demo answer one.')
    expect(wrapper.get('.speaking-solution').text()).toContain('Demo-Übersetzung eins.')
    expect(toggle.text()).toBe('Musterantwort ausblenden')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(wrapper.find('.speaking-solution').exists()).toBe(false)
  })

  it('wird beim Wechsel der Uebung wieder ausgeblendet', async () => {
    const wrapper = mountSpeaking()
    await wrapper.get('.practice-solution-toggle').trigger('click')
    await button(wrapper, 'Nächste').trigger('click')
    expect(wrapper.find('.speaking-solution').exists()).toBe(false)
  })

  it('zeigt Keywords mit deutscher Bedeutung, soweit vorhanden', () => {
    const wrapper = mountSpeaking()
    const rows = wrapper.findAll('.speaking-keywords dt').map((entry) => entry.text())
    expect(rows).toEqual(['demo term', 'second term'])
    expect(wrapper.get('.speaking-keywords').text()).toContain('Demo-Begriff')
  })

  it('Role Play: Rollen vorab, Dialog mit Sprecherwechseln in der Musterantwort', async () => {
    const wrapper = mountSpeaking()
    await tab(wrapper, 'Role Play').trigger('click')
    expect(wrapper.get('.speaking-roles').text()).toContain('A Clerk')
    expect(wrapper.get('.speaking-roles').text()).toContain('B Customer')
    expect(wrapper.find('.speaking-dialog').exists()).toBe(false)
    await wrapper.get('.practice-solution-toggle').trigger('click')
    const turns = wrapper.findAll('.speaking-turn')
    expect(turns.map((turn) => turn.find('.speaking-speaker').text())).toEqual(['A · Clerk', 'B · Customer'])
    expect(turns[1].text()).toContain('Demo line from B.')
    expect(turns[1].text()).toContain('Demo-Zeile von B.')
  })

  it('Business Discussion: Argumente als Liste', async () => {
    const wrapper = mountSpeaking()
    await tab(wrapper, 'Business Discussion').trigger('click')
    await wrapper.get('.practice-solution-toggle').trigger('click')
    expect(wrapper.findAll('.speaking-arguments li').map((entry) => entry.text())).toEqual(['First argument.', 'Second argument.', 'Third argument.'])
  })
})

describe('EasySpeaking: Graph Description', () => {
  it('zeichnet das Linien- und das Kreisdiagramm tatsaechlich', async () => {
    const wrapper = mountSpeaking()
    await tab(wrapper, 'Graph Description').trigger('click')
    expect(wrapper.find('.chart-plot svg polyline').exists()).toBe(true)
    expect(wrapper.findAll('.chart-svg .chart-marker')).toHaveLength(3)
    expect(wrapper.get('.speaking-chart-data').text()).toContain('Jan: 10,000')
    await button(wrapper, 'Nächste').trigger('click')
    expect(wrapper.findAll('.speaking-pie-svg path')).toHaveLength(2)
    expect(wrapper.get('.speaking-pie-legend').text()).toContain('Alpha: 60%')
  })
})

describe('EasySpeaking: Sentence Builder', () => {
  async function openBuilder() {
    const wrapper = mountSpeaking()
    await tab(wrapper, 'Sentence Builder').trigger('click')
    return wrapper
  }
  const pool = (wrapper) => wrapper.findAll('.speaking-pool .speaking-chunk')

  it('baut den Satz aus Bausteinen; Entfernen und Zuruecksetzen funktionieren', async () => {
    const wrapper = await openBuilder()
    expect(pool(wrapper).map((chunk) => chunk.text()).sort()).toEqual(['If it rains,', 'at home.', 'we stay'])
    expect(wrapper.text()).toContain('Wenn es regnet, bleiben wir zu Hause.')
    for (const text of ['at home.', 'we stay', 'If it rains,']) await pool(wrapper).find((chunk) => chunk.text() === text).trigger('click')
    expect(wrapper.get('.speaking-built').text()).toContain('at home.')
    expect(wrapper.text()).toContain('Das ist noch nicht der Zielsatz')
    await wrapper.findAll('.speaking-built .speaking-chunk')[0].trigger('click') // "at home." wieder entfernen
    expect(pool(wrapper)).toHaveLength(1)
    await pool(wrapper)[0].trigger('click')
    expect(wrapper.text()).toContain('Das ist noch nicht der Zielsatz')
    await button(wrapper, 'Zurücksetzen').trigger('click')
    expect(pool(wrapper)).toHaveLength(3)
  })

  it('richtige Reihenfolge ergibt den Zielsatz; der Zielsatz ist auch ohne Bauen sofort aufrufbar', async () => {
    const wrapper = await openBuilder()
    for (const text of ['If it rains,', 'we stay', 'at home.']) await pool(wrapper).find((chunk) => chunk.text() === text).trigger('click')
    expect(wrapper.text()).toContain('✓ Das ist der Zielsatz.')
    await button(wrapper, 'Zurücksetzen').trigger('click')
    await wrapper.get('.practice-solution-toggle').trigger('click')
    expect(wrapper.get('.speaking-solution').text()).toContain('If it rains, we stay at home.')
    expect(wrapper.get('.speaking-solution').text()).toContain('If + present, will + infinitive')
  })
})

describe('EasySpeaking: Lernen und Wiederholen', () => {
  it('markiert beherrscht / noch ueben, speichert lokal und stellt nach Neumontage wieder her', async () => {
    const wrapper = mountSpeaking()
    await wrapper.get('.speaking-status-mastered').trigger('click')
    await button(wrapper, 'Nächste').trigger('click')
    await wrapper.get('.speaking-status-practice').trigger('click')
    expect(wrapper.text()).toContain('1 beherrscht · 1 noch üben')
    expect(JSON.parse(window.localStorage.getItem('businessEnglishSpeakingProgress:v1')).libraries['demo-speaking-v1']).toEqual({ 'es-1': 'mastered', 'es-2': 'practice' })
    wrapper.unmount()

    const again = mountSpeaking()
    expect(again.text()).toContain('1 beherrscht · 1 noch üben')
    await again.get('.speaking-jump select').setValue('1')
    expect(again.get('.speaking-status-practice').attributes('aria-pressed')).toBe('true')
  })

  it('zweiter Klick auf denselben Status nimmt die Markierung zurueck', async () => {
    const wrapper = mountSpeaking()
    const mastered = wrapper.get('.speaking-status-mastered')
    await mastered.trigger('click')
    expect(mastered.attributes('aria-pressed')).toBe('true')
    await mastered.trigger('click')
    expect(mastered.attributes('aria-pressed')).toBe('false')
    expect(wrapper.text()).toContain('0 beherrscht')
  })

  it('Wiederholen zeigt nur "Noch üben"-Uebungen; leere Auswahl wird erklaert; Positionswechsel bleibt gueltig', async () => {
    const wrapper = mountSpeaking()
    await wrapper.findAll('.speaking-filter-button')[1].trigger('click')
    expect(wrapper.find('.speaking-card').exists()).toBe(false)
    expect(wrapper.get('.speaking-empty').text()).toContain('Noch üben')
    await wrapper.findAll('.speaking-filter-button')[0].trigger('click')
    await wrapper.get('.speaking-jump select').setValue('2')
    await wrapper.get('.speaking-status-practice').trigger('click')
    await wrapper.findAll('.speaking-filter-button')[1].trigger('click')
    expect(wrapper.get('.speaking-prompt').text()).toBe('Demo question three?')
    expect(wrapper.text()).toContain('Übung 1 von 1')
    await wrapper.get('.speaking-status-mastered').trigger('click') // verlaesst die Wiederholungs-Liste
    expect(wrapper.find('.speaking-card').exists()).toBe(false)
  })

  it('Zufallsmodus waehlt immer eine andere Uebung der Auswahl', async () => {
    const wrapper = mountSpeaking()
    const random = wrapper.get('.speaking-random')
    for (let round = 0; round < 12; round++) {
      const before = wrapper.get('.speaking-prompt').text()
      await random.trigger('click')
      expect(wrapper.get('.speaking-prompt').text()).not.toBe(before)
    }
    await tab(wrapper, 'Role Play').trigger('click')
    expect(wrapper.get('.speaking-random').attributes('disabled')).toBeDefined() // nur eine Uebung
  })

  it('arbeitet auch ohne nutzbaren localStorage weiter', async () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
    try {
      const wrapper = mountSpeaking()
      await wrapper.get('.speaking-status-mastered').trigger('click')
      expect(wrapper.text()).toContain('1 beherrscht')
      expect(wrapper.get('[role="alert"]').text()).toContain('nicht gespeichert')
    } finally {
      Storage.prototype.setItem = original
    }
  })
})

describe('EasySpeaking: Audio-Anbindung', () => {
  it('zeigt ohne passende Datei kein Audio', () => {
    const wrapper = mountSpeaking({ tracks: { 'anderes.mp3': { url: 'blob:x' } } })
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/Aufnahme/)
  })

  it('zeigt einen Player nur, wenn "<ID>.mp3" geladen ist', () => {
    const wrapper = mountSpeaking({ tracks: { 'es-1.mp3': { url: 'blob:es-1' } } })
    expect(wrapper.get('audio').attributes('src')).toBe('blob:es-1')
  })
})

describe('Integration in die App (W3-Kachel)', () => {
  const importer = (wrapper) => wrapper.findComponent({ name: 'PrivateContentImporter' })
  const navigator = (wrapper) => wrapper.findAllComponents({ name: 'LearningNavigator' })[0]

  it('Kachel zeigt Laden/Konflikt/geladen; Oeffnen und Zurueck funktionieren', async () => {
    const wrapper = shallowMount(App)
    expect(navigator(wrapper).props('speakingEntry')).toBeNull()
    const result = await importSpeakingFiles([new File([JSON.stringify(speakingData())], 'speak.json')])
    await importer(wrapper).vm.$emit('speaking-loaded', result)
    expect(navigator(wrapper).props('speakingEntry').library.exercises).toHaveLength(8)
    expect(wrapper.text()).toContain('Easy Speaking geladen: speak.json')

    await navigator(wrapper).vm.$emit('open-speaking')
    const speaking = wrapper.findComponent(EasySpeaking)
    expect(speaking.exists()).toBe(true)
    await speaking.vm.$emit('back')
    expect(wrapper.findComponent(EasySpeaking).exists()).toBe(false)
    expect(navigator(wrapper).exists()).toBe(true)
  })

  it('Konflikt oder fehlende Bibliothek oeffnen nichts', async () => {
    const wrapper = shallowMount(App)
    await navigator(wrapper).vm.$emit('open-speaking')
    expect(wrapper.findComponent(EasySpeaking).exists()).toBe(false)
    await importer(wrapper).vm.$emit('speaking-loaded', { entry: null, conflict: { areaId: 'x' }, report: null })
    await navigator(wrapper).vm.$emit('open-speaking')
    expect(wrapper.findComponent(EasySpeaking).exists()).toBe(false)
  })

  it('Navigator-Kachel erscheint nur in der W3-Gruppe', async () => {
    const outside = mount(LearningNavigator, { props: {} })
    expect(outside.find('.navigator-card-speaking').exists()).toBe(false)
    const inside = mount(LearningNavigator, { props: { selectedGroupId: 'w3', speakingEntry: entryOf() } })
    expect(inside.get('.navigator-card-speaking').text()).toContain('8 Übungen')
    await inside.get('.navigator-card-speaking button').trigger('click')
    expect(inside.emitted('open-speaking')).toHaveLength(1)
    const missing = mount(LearningNavigator, { props: { selectedGroupId: 'w3' } })
    expect(missing.get('.navigator-card-speaking').text()).toContain('Noch nicht geladen')
  })
})

// Die echte private Bibliothek liegt nur lokal (nicht im Repository); ohne sie wird der Test uebersprungen.
const PRIVATE_FILE = resolve(process.cwd(), 'private/w3/w3-easy-speaking-discussion.json')
describe.skipIf(!existsSync(PRIVATE_FILE))('Echte private Bibliothek (lokal)', () => {
  it('alle 250 Uebungen sind in fuenf Bereichen zugaenglich, Musterantworten sofort aufrufbar, Diagramme gezeichnet', async () => {
    const entry = { library: validateSpeakingLibrary(JSON.parse(readFileSync(PRIVATE_FILE, 'utf8'))), fingerprint: 'real', fileName: 'real.json' }
    expect(entry.library.exercises).toHaveLength(250)
    const wrapper = mount(EasySpeaking, { props: { entry } })
    const expected = { 'Easy Speaking': 70, 'Role Play': 45, 'Business Discussion': 45, 'Graph Description': 30, 'Sentence Builder': 60 }
    let visited = 0
    for (const [label, count] of Object.entries(expected)) {
      await tab(wrapper, label).trigger('click')
      expect(wrapper.text()).toContain(`Übung 1 von ${count}`)
      for (let position = 0; position < count; position++) {
        expect(wrapper.text()).toContain(`Übung ${position + 1} von ${count}`)
        expect(wrapper.get('.speaking-prompt').text().length).toBeGreaterThan(5)
        if (label === 'Graph Description') expect(wrapper.find('.chart-plot svg, .speaking-pie-svg').exists()).toBe(true)
        const toggle = wrapper.get('.practice-solution-toggle')
        await toggle.trigger('click')
        expect(wrapper.get('.speaking-solution').text().length).toBeGreaterThan(5)
        await toggle.trigger('click')
        expect(wrapper.find('.speaking-solution').exists()).toBe(false)
        visited++
        if (position < count - 1) await button(wrapper, 'Nächste').trigger('click')
      }
    }
    expect(visited).toBe(250)
  }, 60000)
})
