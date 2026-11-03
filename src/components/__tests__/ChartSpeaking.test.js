import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChartFigure from '../ChartFigure.vue'
import ChartSpeaking from '../ChartSpeaking.vue'
import { validateFigureLibrary } from '../../utils/figureLibrary.js'
import { figureData, figureDataV2, speakingData } from '../../utils/__tests__/figureTestHelpers.js'

const figureWith = (data = figureDataV2()) => validateFigureLibrary(data).figures[0]
const mountSpeaking = (speaking = speakingData(), unlocked = true) => mount(ChartSpeaking, { props: { speaking, uid: 'u1', unlocked } })
const button = (wrapper, text) => wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
const SAMPLE_TEXT = 'Demo sentence 1 in English.'

describe('ChartSpeaking: Lernablauf A bis D', () => {
  it('Phase A: Aufforderung zum eigenen Versuch, noch keine Beispielsaetze im DOM', () => {
    const wrapper = mountSpeaking(speakingData(), false)
    expect(wrapper.get('summary').text()).toBe('Diagramm auf Englisch beschreiben')
    expect(wrapper.text()).toContain('Sieh dir das Diagramm an. Versuche zuerst, es in zwei bis drei englischen Sätzen laut zu beschreiben.')
    expect(wrapper.text()).not.toContain(SAMPLE_TEXT)
    expect(wrapper.find('ol').exists()).toBe(false)
    expect(button(wrapper, '5 Beispielsätze anzeigen')).toBeTruthy()
    expect(wrapper.text()).not.toContain('Erneut sprechen')
  })

  it('vor der Antwort: Button gesperrt, Hinweis sichtbar, Saetze nicht im DOM und auch per Klick nicht erreichbar', async () => {
    const wrapper = mountSpeaking(speakingData(), false)
    const show = button(wrapper, '5 Beispielsätze anzeigen')
    expect(show.attributes('disabled')).toBeDefined()
    expect(show.attributes('aria-describedby')).toBeTruthy()
    expect(wrapper.get(`#${show.attributes('aria-describedby')}`).text()).toBe('Beantworte zuerst die Aufgabe. Danach kannst du die fünf Beispielsätze ansehen.')
    await show.trigger('click')
    expect(wrapper.find('ol').exists()).toBe(false)
    for (let n = 1; n <= 5; n++) expect(wrapper.text()).not.toContain(`Demo sentence ${n}`)
    expect(wrapper.html()).not.toContain('Demo sentence')
    expect(wrapper.html()).not.toContain('Demo-Satz')
    expect(wrapper.html()).not.toContain('Demo-Erklärung')
  })

  it('nach der Freigabe wird der Button aktiv, der Hinweis verschwindet, die Saetze erscheinen erst nach dem Klick', async () => {
    const wrapper = mountSpeaking(speakingData(), false)
    await wrapper.setProps({ unlocked: true })
    const show = button(wrapper, '5 Beispielsätze anzeigen')
    expect(show.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.chart-speaking-locked').exists()).toBe(false)
    expect(wrapper.find('ol').exists()).toBe(false)
    await show.trigger('click')
    expect(wrapper.findAll('ol > li')).toHaveLength(5)
  })

  it('faellt die Freigabe wieder weg, verschwinden aufgedeckte Saetze sofort (keine alte Freigabe bleibt stehen)', async () => {
    const wrapper = mountSpeaking()
    await button(wrapper, 'Beispielsätze anzeigen').trigger('click')
    expect(wrapper.find('ol').exists()).toBe(true)
    await wrapper.setProps({ unlocked: false })
    expect(wrapper.find('ol').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('Demo sentence')
    expect(button(wrapper, '5 Beispielsätze anzeigen').attributes('disabled')).toBeDefined()
  })

  it('mit anderer Satzanzahl bleibt der Hinweis korrekt formuliert', () => {
    expect(mountSpeaking(speakingData(3), false).text()).toContain('Danach kannst du die Beispielsätze ansehen.')
  })

  it('Phase B: der Button zeigt die Saetze in der gegebenen Reihenfolge, Uebersetzungen bleiben ausgeblendet (Phase C)', async () => {
    const wrapper = mountSpeaking()
    await button(wrapper, 'Beispielsätze anzeigen').trigger('click')
    const items = wrapper.findAll('ol > li')
    expect(items).toHaveLength(5)
    items.forEach((item, index) => expect(item.get('.chart-speaking-en').text()).toBe(`Demo sentence ${index + 1} in English.`))
    expect(items.map((item) => item.get('.chart-speaking-role').text())).toEqual(['Diagramm vorstellen', 'Ausgangslage', 'Entwicklung', 'Zahlen und Vergleiche', 'Kernaussage'])
    expect(wrapper.text()).not.toContain('Demo-Satz 1')
    expect(wrapper.text()).not.toContain('Demo-Erklärung 1')
    expect(wrapper.find('.chart-speaking-de').exists()).toBe(false)
    expect(wrapper.get('.chart-speaking-en').attributes('lang')).toBe('en')
  })

  it('Phase C: Uebersetzung und Erklaerung lassen sich optional ein- und ausblenden', async () => {
    const wrapper = mountSpeaking()
    await button(wrapper, 'Beispielsätze anzeigen').trigger('click')
    const toggle = wrapper.get('input[type="checkbox"]')
    expect(toggle.element.checked).toBe(false)
    await toggle.setValue(true)
    expect(wrapper.findAll('.chart-speaking-de').map((node) => node.text())).toEqual([1, 2, 3, 4, 5].map((n) => `Demo-Satz ${n} auf Deutsch.`))
    expect(wrapper.findAll('.chart-speaking-note')).toHaveLength(5)
    expect(wrapper.get('.chart-speaking-de').attributes('lang')).toBe('de')
    await toggle.setValue(false)
    expect(wrapper.find('.chart-speaking-de').exists()).toBe(false)
  })

  it('Phase D: Hinweis zum erneuten Sprechen erscheint erst nach den Beispielsaetzen; keine Aufnahme/Bewertung versprochen', async () => {
    const wrapper = mountSpeaking()
    expect(wrapper.text()).not.toContain('Versuche jetzt, das Diagramm erneut ohne Hilfe zu beschreiben.')
    await button(wrapper, 'Beispielsätze anzeigen').trigger('click')
    expect(wrapper.text()).toContain('Versuche jetzt, das Diagramm erneut ohne Hilfe zu beschreiben.')
    expect(wrapper.text()).toContain('keine Aufnahme und keine automatische Bewertung')
    expect(wrapper.find('audio, input[type="file"], textarea, [contenteditable]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/Aussprache (wurde|ist) (geprüft|bewertet)/)
  })

  it('"Beispielsaetze ausblenden" blendet alles wieder aus (auch die Uebersetzungen)', async () => {
    const wrapper = mountSpeaking()
    await button(wrapper, 'Beispielsätze anzeigen').trigger('click')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await button(wrapper, 'Beispielsätze ausblenden').trigger('click')
    expect(wrapper.find('ol').exists()).toBe(false)
    await button(wrapper, 'Beispielsätze anzeigen').trigger('click')
    expect(wrapper.get('input[type="checkbox"]').element.checked).toBe(false)
  })

  it('die Button-Beschriftung nennt die tatsaechliche Anzahl und die Bedienelemente sind beschriftet und verknuepft', async () => {
    const wrapper = mountSpeaking(speakingData(3))
    const show = button(wrapper, '3 Beispielsätze anzeigen')
    expect(show.attributes('aria-expanded')).toBe('false')
    await show.trigger('click')
    const list = wrapper.get('ol')
    expect(button(wrapper, 'ausblenden').attributes('aria-controls')).toBe(list.attributes('id'))
    expect(wrapper.get('label').text()).toContain('Deutsche Übersetzungen und Erklärungen anzeigen')
  })

  it('gibt Text aus den Daten nur als Text aus (kein HTML)', async () => {
    const speaking = speakingData()
    speaking.sentences[0].en = '<img src=x onerror="window.__pwnedSpeaking=1">'
    speaking.sentences[0].de = '<script>window.__pwnedSpeaking=1</script>'
    const wrapper = mountSpeaking(speaking)
    await button(wrapper, 'Beispielsätze anzeigen').trigger('click')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.get('.chart-speaking-en').text()).toBe('<img src=x onerror="window.__pwnedSpeaking=1">')
    expect(window.__pwnedSpeaking).toBeUndefined()
  })

  it('speichert nichts (kein Browser-Speicher)', async () => {
    window.localStorage.clear(); window.sessionStorage.clear()
    const wrapper = mountSpeaking()
    await button(wrapper, 'Beispielsätze anzeigen').trigger('click')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })
})

describe('ChartFigure mit und ohne Sprechtraining', () => {
  it('ohne speaking-Metadaten: kein Lernbereich, alles andere unveraendert (Diagramm, Vergroesserung, Wertetabelle)', async () => {
    const wrapper = mount(ChartFigure, { props: { figure: validateFigureLibrary(figureData()).figures[0] } })
    expect(wrapper.find('.chart-speaking').exists()).toBe(false)
    expect(wrapper.find('svg.chart-svg').exists()).toBe(true)
    expect(wrapper.find('table.chart-table').exists()).toBe(true)
    await wrapper.get('.chart-enlarge').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('mit speaking: Lernbereich unter dem Diagramm, Diagramm/Tabelle/Vergroesserung bleiben, Dialog zeigt keine Beispielsaetze', async () => {
    const wrapper = mount(ChartFigure, { props: { figure: figureWith(), speakingUnlocked: true }, attachTo: document.body })
    const children = [...wrapper.get('figure').element.children].map((node) => node.className || node.tagName.toLowerCase())
    expect(children.indexOf('chart-plot')).toBeLessThan(children.indexOf('chart-speaking'))
    expect(children.indexOf('chart-speaking')).toBeLessThan(children.indexOf('chart-text'))
    await wrapper.get('.chart-enlarge').trigger('click')
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.find('.chart-speaking').exists()).toBe(false)
    expect(dialog.findAll('svg.chart-svg')).toHaveLength(1)
    wrapper.unmount()
  })

  it('der geoeffnete Lernbereich macht die Abbildung kompakt (Klasse), das Schliessen nimmt sie zurueck', async () => {
    const wrapper = mount(ChartFigure, { props: { figure: figureWith(), speakingUnlocked: true }, attachTo: document.body })
    expect(wrapper.classes()).not.toContain('chart-figure--speaking')
    const details = wrapper.get('details.chart-speaking')
    details.element.open = true
    await details.trigger('toggle')
    expect(wrapper.classes()).toContain('chart-figure--speaking')
    details.element.open = false
    await details.trigger('toggle')
    expect(wrapper.classes()).not.toContain('chart-figure--speaking')
    wrapper.unmount()
  })
})
