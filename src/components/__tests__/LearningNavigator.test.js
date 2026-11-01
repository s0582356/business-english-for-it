import { describe, expect, it, vi } from 'vitest'
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
    expect(wrapper.text()).toContain('2 Szenarien · 3 Aufgaben · 1/3 richtig')
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

// Neutrale, erfundene Testdaten - keine echten Lerninhalte.
describe('LearningNavigator - W3-Gruppe', () => {
  const W2_TITLES = ['Business Telephoning', 'Business Email Writing', 'Business & Professional Vocabulary', 'Professional Socialising & Opinions']
  const W3_TITLES = ['Unterricht & Lernmaterialien', 'Klausurtraining', 'Präsentationstraining']
  // Auftrag 035: die Lerncoach-Kachel steht als eigene Karte NACH den drei Bereichen (sie ist kein Bereich, siehe Coach-Tests).
  const COACH_TITLE = 'Mein Lerncoach – Englisch Schritt für Schritt'

  function neutralLibrary(areaTitle = 'Neutral Area') {
    return {
      library: {
        areaTitle,
        lessons: [{
          lessonId: 'n-lesson', lessonTitle: 'Neutral Lesson',
          scenarios: [{ scenarioId: 'n-scenario', scenarioTitle: 'Neutral Scenario', items: [{ id: 'n1' }, { id: 'n2' }] }],
        }],
      },
    }
  }
  const cardTitles = (wrapper) => wrapper.findAll('.navigator-card h3').map((heading) => heading.text())

  it('zeigt auf der Startseite die W3-Hauptkachel zusätzlich zu den vier bestehenden Bereichen', () => {
    const wrapper = mountNavigator({ libraryByAreaId: {} })
    expect(cardTitles(wrapper)).toEqual([...W2_TITLES, 'Business English W3'])
    const group = wrapper.get('.navigator-card-group')
    expect(group.text()).toContain('0 von 3 Bereichen geladen')
    expect(group.get('button').text()).toBe('Öffnen')
  })

  it('zeigt die drei W3-Bereiche nicht als eigene Karten auf der Startseite - auch nicht, wenn ihre Bibliotheken geladen sind', () => {
    const wrapper = mountNavigator({ libraryByAreaId: { 'w3-unterricht': neutralLibrary(), 'w3-klausurtraining': neutralLibrary() } })
    expect(cardTitles(wrapper)).toEqual([...W2_TITLES, 'Business English W3'])
    expect(wrapper.text()).toContain('2 von 3 Bereichen geladen')
    for (const title of W3_TITLES) expect(cardTitles(wrapper)).not.toContain(title)
    expect(wrapper.text()).not.toContain('Lernbereich: w3-')
  })

  it('meldet das Öffnen der Gruppe', async () => {
    const wrapper = mountNavigator({ libraryByAreaId: {} })
    await wrapper.get('.navigator-card-group button').trigger('click')
    expect(wrapper.emitted('open-group')).toEqual([['w3']])
    expect(wrapper.emitted('open-area')).toBeUndefined()
  })

  it('zeigt in der Gruppe genau die drei W3-Bereiche (plus die eigenständige Lerncoach-Kachel), noch nicht geladen und mit Import-Hinweis', async () => {
    const wrapper = mountNavigator({ libraryByAreaId: {}, selectedGroupId: 'w3' })
    expect(cardTitles(wrapper)).toEqual([...W3_TITLES, COACH_TITLE])
    expect(wrapper.findAll('.navigator-card-missing')).toHaveLength(3)
    expect(wrapper.text()).toContain('Noch nicht geladen')
    expect(wrapper.find('.navigator-card-group').exists()).toBe(false)
    for (const title of W2_TITLES) expect(wrapper.text()).not.toContain(title)

    await wrapper.get('.navigator-card-missing button').trigger('click')
    expect(wrapper.emitted('request-import')).toHaveLength(1)
  })

  it('führt über den Zurück-Button aus der Gruppe zur Startseite', async () => {
    const wrapper = mountNavigator({ libraryByAreaId: {}, selectedGroupId: 'w3' })
    await wrapper.get('.back-button').trigger('click')
    expect(wrapper.emitted('back-to-groups')).toHaveLength(1)
  })

  it('ordnet eine importierte W3-Bibliothek genau dem passenden Unterbereich zu', async () => {
    const wrapper = mountNavigator({ libraryByAreaId: { 'w3-klausurtraining': neutralLibrary() }, selectedGroupId: 'w3' })
    const loaded = wrapper.findAll('.navigator-card-loaded')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].text()).toContain('Klausurtraining')
    expect(loaded[0].text()).toContain('1 Lektionen · 1 Szenarien')
    expect(wrapper.findAll('.navigator-card-missing')).toHaveLength(2)

    await loaded[0].get('button').trigger('click')
    expect(wrapper.emitted('open-area')).toEqual([['w3-klausurtraining']])
  })

  it('bietet Weiterlernen pro W3-Bereich an', async () => {
    const wrapper = mountNavigator({
      libraryByAreaId: { 'w3-unterricht': neutralLibrary() },
      selectedGroupId: 'w3',
      resumeByAreaId: { 'w3-unterricht': { lessonId: 'n-lesson', lessonTitle: 'Neutral Lesson', scenarioId: 'n-scenario', scenarioTitle: 'Neutral Scenario', itemId: 'n2' } },
    })
    const card = wrapper.get('.navigator-card-loaded')
    expect(card.text()).toContain('Weiter bei: Neutral Lesson · Neutral Scenario')
    await card.get('button').trigger('click')
    expect(wrapper.emitted('resume-area')).toEqual([['w3-unterricht']])
  })

  it('markiert einen Konflikt in der Gruppe auf der Startseite und im Bereich', () => {
    const conflicts = { 'w3-praesentation': { areaId: 'w3-praesentation' } }
    const home = mountNavigator({ libraryByAreaId: {}, conflictsByAreaId: conflicts })
    expect(home.get('.navigator-card-group').text()).toContain('Konflikt bei 1 Bereich')
    const group = mountNavigator({ libraryByAreaId: {}, conflictsByAreaId: conflicts, selectedGroupId: 'w3' })
    expect(group.get('.navigator-card-conflict').text()).toContain('Präsentationstraining')
  })

  it('nutzt die vorhandene Lektionsliste für W3 und führt zurück zur Gruppe', async () => {
    const wrapper = mountNavigator({ libraryByAreaId: { 'w3-unterricht': neutralLibrary() }, selectedGroupId: 'w3', selectedAreaId: 'w3-unterricht' })
    expect(wrapper.text()).toContain('Neutral Lesson')
    expect(wrapper.get('.back-button').text()).toBe('← Business English W3')
    await wrapper.get('.back-button').trigger('click')
    expect(wrapper.emitted('back-to-areas')).toHaveLength(1)
  })

  it('lässt den Zurück-Button der vier bestehenden Bereiche unverändert', () => {
    const wrapper = mountNavigator({ selectedAreaId: 'telephoning' })
    expect(wrapper.get('.back-button').text()).toBe('← Alle Bereiche')
  })

  it('zeigt unbekannte Bereiche weiterhin, nach der W3-Kachel', () => {
    const wrapper = mountNavigator({ libraryByAreaId: { 'security-english': neutralLibrary('Security English') } })
    expect(cardTitles(wrapper)).toEqual([...W2_TITLES, 'Business English W3', 'Security English'])
  })

  it('Regression: Gruppenkarte "w3" und importierter Bereich mit areaId "w3" erzeugen keine doppelten Vue-Schlüssel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const wrapper = mountNavigator({ libraryByAreaId: { 'w3': neutralLibrary('Neutral W3 Area') } })
      expect(cardTitles(wrapper)).toEqual([...W2_TITLES, 'Business English W3', 'Neutral W3 Area'])
      expect(wrapper.findAll('.navigator-card-group')).toHaveLength(1)
      expect(wrapper.findAll('.navigator-card-loaded')).toHaveLength(1)

      // Aktualisierungen und erneutes Öffnen: Props ändern, Gruppe öffnen und schließen.
      await wrapper.setProps({ libraryByAreaId: { w3: neutralLibrary('Neutral W3 Area'), 'w3-unterricht': neutralLibrary() } })
      expect(wrapper.text()).toContain('1 von 3 Bereichen geladen')
      await wrapper.setProps({ selectedGroupId: 'w3' })
      expect(cardTitles(wrapper)).toEqual([...W3_TITLES, COACH_TITLE])
      await wrapper.setProps({ selectedGroupId: null })
      await wrapper.setProps({ conflictsByAreaId: { w3: { areaId: 'w3' } }, libraryByAreaId: { 'w3-unterricht': neutralLibrary() } })
      expect(wrapper.findAll('.navigator-card-group')).toHaveLength(1)
      expect(wrapper.get('.navigator-card-conflict').text()).toContain('Lernbereich: w3')

      const duplicateKeyWarnings = warn.mock.calls.filter((call) => String(call[0]).includes('Duplicate keys'))
      expect(duplicateKeyWarnings).toEqual([])
    } finally {
      warn.mockRestore()
    }
  })

  it('der Ladezähler der W3-Gruppe reagiert auf Folgeimport und Importkonflikt', async () => {
    const wrapper = mountNavigator({ libraryByAreaId: {} })
    expect(wrapper.get('.navigator-card-group').text()).toContain('0 von 3 Bereichen geladen')

    await wrapper.setProps({ libraryByAreaId: { 'w3-unterricht': neutralLibrary() } })
    expect(wrapper.get('.navigator-card-group').text()).toContain('1 von 3 Bereichen geladen')

    await wrapper.setProps({ libraryByAreaId: { 'w3-unterricht': neutralLibrary(), 'w3-klausurtraining': neutralLibrary() } })
    expect(wrapper.get('.navigator-card-group').text()).toContain('2 von 3 Bereichen geladen')

    // Konflikt entfernt die Bibliothek (wie importLibraryFiles) und wird in der Gruppenkarte gemeldet.
    await wrapper.setProps({ libraryByAreaId: { 'w3-unterricht': neutralLibrary() }, conflictsByAreaId: { 'w3-klausurtraining': { areaId: 'w3-klausurtraining' } } })
    const text = wrapper.get('.navigator-card-group').text()
    expect(text).toContain('1 von 3 Bereichen geladen')
    expect(text).toContain('Konflikt bei 1 Bereich')
  })
})
