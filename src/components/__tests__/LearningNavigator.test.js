import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import LearningNavigator from '../LearningNavigator.vue'

const items = [{ id: 'a' }, { id: 'b' }]
const telephoning = {
  library: {
    areaTitle: 'Business Telephoning',
    lessons: [{
      lessonId: 'lesson-1', lessonTitle: 'Starting a Business Call',
      scenarios: [
        { scenarioId: 'scenario-a', scenarioTitle: 'Making an Appointment', items },
        { scenarioId: 'scenario-b', scenarioTitle: 'Rescheduling', items: [{ id: 'c' }] },
      ],
    }],
  },
}

function mountNavigator(props = {}) {
  return mount(LearningNavigator, { props: { libraryByAreaId: { telephoning }, ...props } })
}

describe('LearningNavigator', () => {
  it('zeigt geladene, fehlende und Konflikt-Bereiche unterscheidbar an', () => {
    const wrapper = mountNavigator({ conflictsByAreaId: { vocabulary: { areaId: 'vocabulary' } } })
    expect(wrapper.text()).toContain('Business Telephoning')
    expect(wrapper.text()).toContain('Lernbibliothek geladen')
    expect(wrapper.text()).toContain('Business Email Writing')
    expect(wrapper.text()).toContain('Noch nicht geladen')
    expect(wrapper.text()).toContain('Konflikt bei dieser Lernbibliothek')
    expect(wrapper.find('.navigator-card-conflict').find('button').text()).toBe('Lernbibliotheken laden')
  })

  it('zeigt unbekannte geladene areaIds zusätzlich an', () => {
    const wrapper = mountNavigator({ libraryByAreaId: { telephoning, 'security-english': { library: { ...telephoning.library, areaTitle: 'Security English' } } } })
    expect(wrapper.text()).toContain('Security English')
  })

  it('öffnet nur einen geladenen Bereich', async () => {
    const wrapper = mountNavigator()
    await wrapper.get('.navigator-card-loaded button').trigger('click')
    expect(wrapper.emitted('open-area')).toEqual([['telephoning']])
    expect(wrapper.find('.navigator-card-conflict button').exists()).toBe(false)
  })

  it('rendert Lektionen und meldet deren Auswahl', async () => {
    const wrapper = mountNavigator({ selectedAreaId: 'telephoning', itemStatuses: { a: { status: 'correct' } } })
    expect(wrapper.text()).toContain('Starting a Business Call')
    expect(wrapper.text()).toContain('2 Szenarien · 3 Aufgaben · 1/3 erledigt')
    await wrapper.get('.navigator-list-card').trigger('click')
    expect(wrapper.emitted('open-lesson')).toEqual([['lesson-1']])
    await wrapper.get('.back-button').trigger('click')
    expect(wrapper.emitted('back-to-areas')).toHaveLength(1)
  })

  it('rendert Szenarien, startet nur das gewählte Szenario und navigiert zurück', async () => {
    const wrapper = mountNavigator({ selectedAreaId: 'telephoning', selectedLessonId: 'lesson-1' })
    expect(wrapper.text()).toContain('Making an Appointment')
    expect(wrapper.text()).toContain('Rescheduling')
    await wrapper.findAll('.scenario-card button')[1].trigger('click')
    expect(wrapper.emitted('start-scenario')).toEqual([['scenario-b']])
    await wrapper.get('.back-button').trigger('click')
    expect(wrapper.emitted('back-to-lessons')).toHaveLength(1)
  })

  it('zeigt "Weiterlernen" mit Kontext an und springt direkt zur gespeicherten Position, statt einen zweiten Button zu ergänzen', async () => {
    const wrapper = mountNavigator({
      resumeByAreaId: { telephoning: { lessonId: 'lesson-1', lessonTitle: 'Starting a Business Call', scenarioId: 'scenario-b', scenarioTitle: 'Rescheduling', itemId: 'c' } },
    })
    const card = wrapper.get('.navigator-card-loaded')
    expect(card.text()).toContain('Weiter bei: Starting a Business Call · Rescheduling')
    expect(card.findAll('button')).toHaveLength(1)
    expect(card.text()).not.toContain('Bereich öffnen')

    await card.get('button').trigger('click')
    expect(wrapper.emitted('resume-area')).toEqual([['telephoning']])
    expect(wrapper.emitted('open-area')).toBeUndefined()
  })

  it('zeigt ohne gespeicherte Position weiterhin nur "Bereich öffnen"', () => {
    const wrapper = mountNavigator()
    const card = wrapper.get('.navigator-card-loaded')
    expect(card.findAll('button')).toHaveLength(1)
    expect(card.text()).toContain('Bereich öffnen')
    expect(card.text()).not.toContain('Weiterlernen')
  })

  it('bietet für einen Konfliktbereich kein Resume an, selbst wenn eine Position übergeben wird', () => {
    const wrapper = mountNavigator({
      conflictsByAreaId: { telephoning: { areaId: 'telephoning' } },
      resumeByAreaId: { telephoning: { lessonId: 'lesson-1', lessonTitle: 'x', scenarioId: 's', scenarioTitle: 'y', itemId: 'c' } },
    })
    expect(wrapper.text()).not.toContain('Weiterlernen')
    expect(wrapper.find('.navigator-card-conflict').find('button').text()).toBe('Lernbibliotheken laden')
  })
})
