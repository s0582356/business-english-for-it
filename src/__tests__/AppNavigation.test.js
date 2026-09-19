import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import App from '../App.vue'
import { getItemStatus, saveLastPosition } from '../utils/progressStorage.js'

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

  it('speichert einen Choice-Submit genau einmal als Versuch', async () => {
    window.localStorage.clear()
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', registry)
    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    await navigator(wrapper).vm.$emit('open-lesson', 'l1')
    await navigator(wrapper).vm.$emit('start-scenario', 's1')

    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')

    expect(getItemStatus('telephoning', 'only-s1')).toMatchObject({ status: 'correct', attempts: 1 })
  })
})

describe('App resume / Weiterlernen', () => {
  const resumeLibrary = {
    areaId: 'telephoning',
    areaTitle: 'Business Telephoning',
    lessons: [{
      lessonId: 'l1', lessonTitle: 'Lesson 1',
      scenarios: [{
        scenarioId: 's1', scenarioTitle: 'Scenario 1',
        items: [
          { id: 'item-a', type: 'choice', correctAnswer: 'A' },
          { id: 'item-b', type: 'choice', correctAnswer: 'B' },
        ],
      }],
    }],
  }
  const emailLibrary = {
    areaId: 'email-writing',
    areaTitle: 'Business Email Writing',
    lessons: [{
      lessonId: 'el1', lessonTitle: 'Email Lesson',
      scenarios: [{ scenarioId: 'es1', scenarioTitle: 'Email Scenario', items: [{ id: 'email-item', type: 'choice', correctAnswer: 'X' }] }],
    }],
  }
  const resumeRegistry = {
    libraryByAreaId: { telephoning: { library: resumeLibrary }, 'email-writing': { library: emailLibrary } },
    conflictsByAreaId: {},
    report: { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] },
  }

  it('bietet ohne gespeicherte Position kein Resume an (Fall A)', async () => {
    window.localStorage.clear()
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', resumeRegistry)
    expect(navigator(wrapper).props('resumeByAreaId')).toEqual({})
  })

  it('springt bei gültiger Position direkt zum gespeicherten Item (Fall B)', async () => {
    window.localStorage.clear()
    saveLastPosition('telephoning', { lessonId: 'l1', scenarioId: 's1', itemId: 'item-b' })
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', resumeRegistry)

    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')

    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item')).toMatchObject({ id: 'item-b' })
  })

  it('fällt bei entfernter itemId auf den Szenario-Anfang zurück, statt zu crashen (Fall C)', async () => {
    window.localStorage.clear()
    saveLastPosition('telephoning', { lessonId: 'l1', scenarioId: 's1', itemId: 'removed-item' })
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', resumeRegistry)

    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')

    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item')).toMatchObject({ id: 'item-a' })
  })

  it('navigiert bei ungültiger Lektion ohne Crash zur Bereichsübersicht (Fall D)', async () => {
    window.localStorage.clear()
    saveLastPosition('telephoning', { lessonId: 'removed-lesson', scenarioId: 's1', itemId: 'item-a' })
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', resumeRegistry)

    expect(async () => await navigator(wrapper).vm.$emit('resume-area', 'telephoning')).not.toThrow()
    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')

    expect(navigator(wrapper).props('selectedAreaId')).toBe('telephoning')
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).exists()).toBe(false)
  })

  it('bietet für einen Bereich ohne geladene Library kein Resume an (Fall E)', async () => {
    window.localStorage.clear()
    saveLastPosition('vocabulary', { lessonId: 'x', scenarioId: 'y', itemId: 'z' })
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', resumeRegistry)
    expect(navigator(wrapper).props('resumeByAreaId').vocabulary).toBeUndefined()
  })

  it('bietet bei einem Konfliktbereich kein Resume an (Fall F)', async () => {
    window.localStorage.clear()
    saveLastPosition('telephoning', { lessonId: 'l1', scenarioId: 's1', itemId: 'item-b' })
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', {
      ...resumeRegistry, conflictsByAreaId: { telephoning: { areaId: 'telephoning' } },
    })
    expect(navigator(wrapper).props('resumeByAreaId').telephoning).toBeUndefined()
  })

  it('lässt Fortschritt eines anderen Bereichs unberührt - keine Cross-Area-Navigation (Fall G)', async () => {
    window.localStorage.clear()
    saveLastPosition('telephoning', { lessonId: 'l1', scenarioId: 's1', itemId: 'item-b' })
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', resumeRegistry)

    expect(navigator(wrapper).props('resumeByAreaId')['email-writing']).toBeUndefined()

    await navigator(wrapper).vm.$emit('resume-area', 'email-writing')
    expect(navigator(wrapper).props('selectedAreaId')).toBe('email-writing')
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).exists()).toBe(false)
  })
})
