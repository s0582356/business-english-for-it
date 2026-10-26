import { describe, expect, it } from 'vitest'
import { mount, shallowMount } from '@vue/test-utils'
import fs from 'node:fs'
import path from 'node:path'
import App from '../App.vue'
import ChoiceCard from '../components/ChoiceCard.vue'

describe('Prompt-Darstellung und Ergebnistext', () => {
  it('stellt explizite Zeilenumbrüche im Prompt-Titel per CSS dar (white-space: pre-line)', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../style.css'), 'utf8')
    const rule = css.match(/\.prompt-row h2\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/white-space:\s*pre-line/)
  })

  it('behält Zeilenumbrüche im Prompt-Text bei', () => {
    const item = { id: 'x', type: 'choice', prompt: 'Zeile 1\nTeam A: 1; 2.\nZeile 3', options: ['a', 'b'], correctAnswer: 'a', explanation: 'e' }
    const wrapper = mount(ChoiceCard, { props: { item, selectedAnswer: null, isAnswered: false, isLastItem: false } })
    expect(wrapper.get('.prompt-row h2').element.textContent).toBe(item.prompt)
  })

  it('zeigt am Ende eines Durchlaufs einen themenneutralen Ergebnistext', async () => {
    window.localStorage.clear()
    const library = { areaId: 'graph', areaTitle: 'Graph', lessons: [{ lessonId: 'l1', lessonTitle: 'L', scenarios: [{ scenarioId: 's1', scenarioTitle: 'S', items: [{ id: 'only', type: 'choice', correctAnswer: 'A' }] }] }] }
    const registry = { libraryByAreaId: { graph: { library } }, conflictsByAreaId: {}, report: { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] } }
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', registry)
    const nav = () => wrapper.findAllComponents({ name: 'LearningNavigator' })[0]
    await nav().vm.$emit('open-area', 'graph')
    await nav().vm.$emit('open-lesson', 'l1')
    await nav().vm.$emit('start-scenario', 's1')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('finish')
    const message = wrapper.get('.result-message').text()
    expect(message).not.toMatch(/Telefon/i)
    expect(message).toContain('Sehr gut gemacht')
    expect(wrapper.text()).toContain('100%')
  })
})
