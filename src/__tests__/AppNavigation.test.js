import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import App from '../App.vue'

const library = {
  areaId: 'telephoning',
  areaTitle: 'Business Telephoning',
  lessons: [{
    lessonId: 'l1', lessonTitle: 'Lesson 1',
    scenarios: [
      { scenarioId: 's1', scenarioTitle: 'Scenario 1', items: [{ id: 'only-s1', type: 'choice', correctAnswer: 'A' }] },
      { scenarioId: 's2', scenarioTitle: 'Scenario 2', items: [{ id: 'only-s2', type: 'choice', correctAnswer: 'B' }] },
    ],
  }],
}
const registry = { libraryByAreaId: { telephoning: { library } }, conflictsByAreaId: {}, report: { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] } }

function navigator(wrapper) { return wrapper.findAllComponents({ name: 'LearningNavigator' })[0] }

describe('App navigation flow', () => {
  it('bleibt nach Import in der Bereichsauswahl und startet erst das gewählte Szenario', async () => {
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', registry)
    expect(wrapper.findComponent({ name: 'ScoreBox' }).exists()).toBe(false)

    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    await navigator(wrapper).vm.$emit('open-lesson', 'l1')
    await navigator(wrapper).vm.$emit('start-scenario', 's2')
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item')).toMatchObject({ id: 'only-s2' })

    await wrapper.get('.back-button').trigger('click')
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).exists()).toBe(false)
    expect(navigator(wrapper).props('selectedLessonId')).toBe('l1')
  })

  it('ignoriert einen Open-Event für einen Konfliktbereich', async () => {
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', {
      ...registry, libraryByAreaId: {}, conflictsByAreaId: { telephoning: { areaId: 'telephoning' } },
    })
    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    expect(wrapper.findComponent({ name: 'ScoreBox' }).exists()).toBe(false)
    expect(navigator(wrapper).props('selectedAreaId')).toBeNull()
  })
})
