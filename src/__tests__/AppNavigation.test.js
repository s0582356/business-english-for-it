import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import App from '../App.vue'
import { getItemStatus, recordItemResult, saveLastPosition } from '../utils/progressStorage.js'
import { importLibraryFiles } from '../utils/libraryImport.js'

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

describe('App Weiterlernen - nächste offene Aufgabe', () => {
  // Items tragen lessonId/scenarioId wie nach dem echten Import (libraryImport.js).
  function item(id, lessonId, scenarioId, correctAnswer = 'A') {
    return { id, type: 'choice', correctAnswer, lessonId, scenarioId }
  }
  const flowLibrary = {
    areaId: 'telephoning',
    areaTitle: 'Business Telephoning',
    lessons: [
      {
        lessonId: 'l1', lessonTitle: 'Lesson 1',
        scenarios: [
          { scenarioId: 's1', scenarioTitle: 'Scenario 1', items: [item('i1', 'l1', 's1'), item('i2', 'l1', 's1'), item('i3', 'l1', 's1')] },
          { scenarioId: 's2', scenarioTitle: 'Scenario 2', items: [item('i4', 'l1', 's2')] },
        ],
      },
      { lessonId: 'l2', lessonTitle: 'Lesson 2', scenarios: [{ scenarioId: 's3', scenarioTitle: 'Scenario 3', items: [item('i5', 'l2', 's3')] }] },
    ],
  }
  const otherLibrary = {
    areaId: 'email-writing',
    areaTitle: 'Business Email Writing',
    lessons: [{ lessonId: 'el1', lessonTitle: 'Email Lesson', scenarios: [{ scenarioId: 'es1', scenarioTitle: 'Email Scenario', items: [item('e1', 'el1', 'es1')] }] }],
  }
  const flowRegistry = {
    libraryByAreaId: { telephoning: { library: flowLibrary }, 'email-writing': { library: otherLibrary } },
    conflictsByAreaId: {},
    report: { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] },
  }

  async function mountLoaded() {
    window.localStorage.clear()
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', flowRegistry)
    return wrapper
  }
  async function startFirstScenario(wrapper) {
    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    await navigator(wrapper).vm.$emit('open-lesson', 'l1')
    await navigator(wrapper).vm.$emit('start-scenario', 's1')
  }
  async function leaveToAreaOverview(wrapper) {
    await wrapper.get('.back-button').trigger('click')
    await navigator(wrapper).vm.$emit('back-to-areas')
  }
  async function mountedReload(wrapper) {
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', flowRegistry)
  }
  function currentItemId(wrapper) { return wrapper.findComponent({ name: 'ChoiceCard' }).props('item').id }

  it('Live-Fall: Aufgabe 1 beantworten, NICHT "Weiter" klicken, Bereichsübersicht -> Weiterlernen öffnet Aufgabe 2', async () => {
    const wrapper = await mountLoaded()
    await startFirstScenario(wrapper)
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')

    await leaveToAreaOverview(wrapper)
    expect(navigator(wrapper).props('resumeByAreaId').telephoning).toMatchObject({ scenarioId: 's1', itemId: 'i2' })

    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(currentItemId(wrapper)).toBe('i2')
  })

  it('Weiterlernen nach falscher Antwort geht ebenfalls zur nächsten Aufgabe', async () => {
    const wrapper = await mountLoaded()
    await startFirstScenario(wrapper)
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'WRONG')
    await leaveToAreaOverview(wrapper)

    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(currentItemId(wrapper)).toBe('i2')
  })

  it('springt nach abgeschlossenem Szenario ins nächste Szenario und nach Lektion in die nächste Lektion', async () => {
    const wrapper = await mountLoaded()
    await startFirstScenario(wrapper)
    for (const id of ['i1', 'i2', 'i3']) {
      expect(currentItemId(wrapper)).toBe(id)
      await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
      if (id !== 'i3') await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('next-item')
    }
    await leaveToAreaOverview(wrapper)
    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(currentItemId(wrapper)).toBe('i4')

    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await leaveToAreaOverview(wrapper)
    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(currentItemId(wrapper)).toBe('i5')
  })

  it('bietet nach vollständig erledigtem Bereich kein Weiterlernen mehr an und öffnet den normalen Bereichseinstieg', async () => {
    const wrapper = await mountLoaded()
    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    await navigator(wrapper).vm.$emit('open-lesson', 'l2')
    await navigator(wrapper).vm.$emit('start-scenario', 's3')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await wrapper.get('.back-button').trigger('click')
    await navigator(wrapper).vm.$emit('back-to-lessons')
    await navigator(wrapper).vm.$emit('open-lesson', 'l1')
    for (const scenarioId of ['s1', 's2']) {
      await navigator(wrapper).vm.$emit('start-scenario', scenarioId)
      const count = flowLibrary.lessons[0].scenarios.find((s) => s.scenarioId === scenarioId).items.length
      for (let index = 0; index < count; index++) {
        await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
        if (index < count - 1) await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('next-item')
      }
      await wrapper.get('.back-button').trigger('click')
    }
    await navigator(wrapper).vm.$emit('back-to-areas')

    expect(navigator(wrapper).props('resumeByAreaId').telephoning).toBeUndefined()

    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).exists()).toBe(false)
    expect(navigator(wrapper).props('selectedAreaId')).toBe('telephoning')
  })

  it('findet nach Resume eine übersprungene frühere Lücke wieder', async () => {
    const wrapper = await mountLoaded()
    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    await navigator(wrapper).vm.$emit('open-lesson', 'l1')
    await navigator(wrapper).vm.$emit('start-scenario', 's1')
    // i1 beantworten, i2 überspringen (nächste Aufgabe ohne Antwort), i3 beantworten
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('next-item')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('next-item')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await leaveToAreaOverview(wrapper)

    // lastPosition = i3, vorwärts ist i4 offen
    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(currentItemId(wrapper)).toBe('i4')
    for (const id of ['i4']) await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await wrapper.get('.back-button').trigger('click')
    await navigator(wrapper).vm.$emit('back-to-areas')
    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(currentItemId(wrapper)).toBe('i5')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await wrapper.get('.back-button').trigger('click')
    await navigator(wrapper).vm.$emit('back-to-areas')

    expect(navigator(wrapper).props('resumeByAreaId').telephoning).toMatchObject({ itemId: 'i2' })
    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(currentItemId(wrapper)).toBe('i2')
  })

  it('Resume-Run überspringt erledigte Folge-Items: i1 erledigt, i2 offen, i3 erledigt -> i2, danach Szenarioabschluss', async () => {
    const wrapper = await mountLoaded()
    recordItemResult('telephoning', 'i1', true)
    recordItemResult('telephoning', 'i3', false)
    saveLastPosition('telephoning', { lessonId: 'l1', scenarioId: 's1', itemId: 'i1' })
    await mountedReload(wrapper)

    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(currentItemId(wrapper)).toBe('i2')
    // i2 ist die letzte offene Aufgabe des Resume-Runs: "Weiter" wird zu "Abschließen"
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('isLastItem')).toBe(true)

    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('finish')

    expect(wrapper.findComponent({ name: 'ChoiceCard' }).exists()).toBe(false)
    expect(getItemStatus('telephoning', 'i3')).toMatchObject({ attempts: 1 })
  })

  it('Resume-Run enthält nur noch offene Items: ScoreBox-Gesamtzahl = 1', async () => {
    const wrapper = await mountLoaded()
    recordItemResult('telephoning', 'i1', true)
    recordItemResult('telephoning', 'i3', true)
    saveLastPosition('telephoning', { lessonId: 'l1', scenarioId: 's1', itemId: 'i1' })
    await mountedReload(wrapper)
    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    expect(currentItemId(wrapper)).toBe('i2')
    expect(wrapper.findComponent({ name: 'ScoreBox' }).props('totalItems')).toBe(1)
  })

  it('Normaler Szenario-Start bleibt linear, auch mit älteren Progress-Einträgen', async () => {
    const wrapper = await mountLoaded()
    recordItemResult('telephoning', 'i1', true)
    recordItemResult('telephoning', 'i3', true)
    await startFirstScenario(wrapper)

    expect(currentItemId(wrapper)).toBe('i1')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('next-item')
    expect(currentItemId(wrapper)).toBe('i2')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('next-item')
    expect(currentItemId(wrapper)).toBe('i3')
  })

  it('isoliert die Bereiche: Antwort in Telephoning erzeugt kein Resume für Email, 1 Submit = 1 Versuch', async () => {
    const wrapper = await mountLoaded()
    await startFirstScenario(wrapper)
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await leaveToAreaOverview(wrapper)

    expect(navigator(wrapper).props('resumeByAreaId')['email-writing']).toBeUndefined()
    expect(getItemStatus('telephoning', 'i1')).toMatchObject({ attempts: 1 })
    expect(getItemStatus('email-writing', 'e1')).toBeNull()

    await navigator(wrapper).vm.$emit('resume-area', 'telephoning')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    expect(getItemStatus('telephoning', 'i2')).toMatchObject({ attempts: 1 })
    expect(getItemStatus('telephoning', 'i1')).toMatchObject({ attempts: 1 })
  })
})

// Neutrale, erfundene Testdaten - keine echten Lerninhalte.
describe('App W3-Gruppe', () => {
  function item(id, lessonId, scenarioId) {
    return { id, type: 'choice', correctAnswer: 'A', lessonId, scenarioId }
  }
  function neutralLibrary(areaId, itemId) {
    return {
      areaId,
      areaTitle: `Neutral ${areaId}`,
      lessons: [{
        lessonId: 'n-lesson', lessonTitle: 'Neutral Lesson',
        scenarios: [{ scenarioId: 'n-scenario', scenarioTitle: 'Neutral Scenario', items: [item(itemId, 'n-lesson', 'n-scenario'), item(`${itemId}-b`, 'n-lesson', 'n-scenario')] }],
      }],
    }
  }
  // Gleiche itemId in W2- und W3-Bereich: Fortschritt darf sich nicht vermischen.
  const registry = {
    libraryByAreaId: {
      telephoning: { library: neutralLibrary('telephoning', 'shared-1') },
      'w3-unterricht': { library: neutralLibrary('w3-unterricht', 'shared-1') },
    },
    conflictsByAreaId: {},
    report: { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] },
  }

  async function mountLoaded() {
    window.localStorage.clear()
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', registry)
    return wrapper
  }

  it('öffnet die Gruppe auf der Startseite, ohne den Importer zu verlieren', async () => {
    const wrapper = await mountLoaded()
    expect(navigator(wrapper).props('selectedGroupId')).toBeNull()
    await navigator(wrapper).vm.$emit('open-group', 'w3')
    expect(navigator(wrapper).props('selectedGroupId')).toBe('w3')
    expect(wrapper.findComponent({ name: 'PrivateContentImporter' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ScoreBox' }).exists()).toBe(false)
  })

  it('Weg Startseite -> W3 -> Bereich -> Lektion und zurück über alle Ebenen', async () => {
    const wrapper = await mountLoaded()
    await navigator(wrapper).vm.$emit('open-group', 'w3')
    await navigator(wrapper).vm.$emit('open-area', 'w3-unterricht')
    expect(navigator(wrapper).props('selectedAreaId')).toBe('w3-unterricht')
    await navigator(wrapper).vm.$emit('open-lesson', 'n-lesson')
    expect(navigator(wrapper).props('selectedLessonId')).toBe('n-lesson')

    await navigator(wrapper).vm.$emit('back-to-lessons')
    expect(navigator(wrapper).props('selectedLessonId')).toBeNull()
    expect(navigator(wrapper).props('selectedAreaId')).toBe('w3-unterricht')

    await navigator(wrapper).vm.$emit('back-to-areas')
    expect(navigator(wrapper).props('selectedAreaId')).toBeNull()
    expect(navigator(wrapper).props('selectedGroupId')).toBe('w3') // zurück in der Gruppe, nicht auf der Startseite

    await navigator(wrapper).vm.$emit('back-to-groups')
    expect(navigator(wrapper).props('selectedGroupId')).toBeNull()
  })

  it('W2-Bereiche bleiben erreichbar, vor und nach dem Besuch der Gruppe', async () => {
    const wrapper = await mountLoaded()
    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    expect(navigator(wrapper).props('selectedAreaId')).toBe('telephoning')
    await navigator(wrapper).vm.$emit('back-to-areas')

    await navigator(wrapper).vm.$emit('open-group', 'w3')
    await navigator(wrapper).vm.$emit('back-to-groups')
    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    expect(navigator(wrapper).props('selectedAreaId')).toBe('telephoning')
  })

  it('ein nicht geladener W3-Bereich lässt sich nicht öffnen', async () => {
    const wrapper = await mountLoaded()
    await navigator(wrapper).vm.$emit('open-group', 'w3')
    await navigator(wrapper).vm.$emit('open-area', 'w3-klausurtraining')
    expect(navigator(wrapper).props('selectedAreaId')).toBeNull()
    expect(wrapper.findComponent({ name: 'ScoreBox' }).exists()).toBe(false)
  })

  it('speichert W3-Fortschritt unter der W3-areaId und lässt gleiche itemIds in W2 unberührt', async () => {
    const wrapper = await mountLoaded()
    await navigator(wrapper).vm.$emit('open-group', 'w3')
    await navigator(wrapper).vm.$emit('open-area', 'w3-unterricht')
    await navigator(wrapper).vm.$emit('open-lesson', 'n-lesson')
    await navigator(wrapper).vm.$emit('start-scenario', 'n-scenario')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')

    expect(getItemStatus('w3-unterricht', 'shared-1')).toMatchObject({ status: 'correct', attempts: 1 })
    expect(getItemStatus('telephoning', 'shared-1')).toBeNull()
  })

  it('Resume bleibt pro Bereich getrennt: W3-Fortschritt erzeugt kein W2-Resume und umgekehrt', async () => {
    const wrapper = await mountLoaded()
    await navigator(wrapper).vm.$emit('open-group', 'w3')
    await navigator(wrapper).vm.$emit('open-area', 'w3-unterricht')
    await navigator(wrapper).vm.$emit('open-lesson', 'n-lesson')
    await navigator(wrapper).vm.$emit('start-scenario', 'n-scenario')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')
    await wrapper.get('.back-button').trigger('click')
    await navigator(wrapper).vm.$emit('back-to-lessons')
    await navigator(wrapper).vm.$emit('back-to-areas')

    const resume = navigator(wrapper).props('resumeByAreaId')
    expect(resume['w3-unterricht']).toMatchObject({ itemId: 'shared-1-b' })
    expect(resume.telephoning).toBeUndefined()

    await navigator(wrapper).vm.$emit('resume-area', 'w3-unterricht')
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item').id).toBe('shared-1-b')
  })

  it('bestehender W2-Fortschritt bleibt beim Laden von W3-Bibliotheken unverändert', async () => {
    window.localStorage.clear()
    recordItemResult('telephoning', 'shared-1', true)
    saveLastPosition('telephoning', { lessonId: 'n-lesson', scenarioId: 'n-scenario', itemId: 'shared-1' })
    const before = getItemStatus('telephoning', 'shared-1')

    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', registry)
    await navigator(wrapper).vm.$emit('open-group', 'w3')

    expect(getItemStatus('telephoning', 'shared-1')).toEqual(before)
    expect(navigator(wrapper).props('resumeByAreaId').telephoning).toMatchObject({ itemId: 'shared-1-b' })
    expect(navigator(wrapper).props('resumeByAreaId')['w3-unterricht']).toBeUndefined()
  })

  it('übernimmt eine echt importierte neutrale W3-Testbibliothek in den richtigen Unterbereich', async () => {
    window.localStorage.clear()
    const json = {
      type: 'businessEnglishLibrary', schemaVersion: 1, libraryId: 'neutral-test-library', libraryVersion: 1,
      areaId: 'w3-praesentation', areaTitle: 'Neutral Test Area',
      lessons: [{
        lessonId: 'n-lesson', lessonTitle: 'Neutral Lesson',
        scenarios: [{
          scenarioId: 'n-scenario', scenarioTitle: 'Neutral Scenario',
          items: [{ itemId: 'n-1', type: 'choice', prompt: 'Neutral prompt?', options: ['A', 'B'], correctAnswer: 'A', explanation: 'Neutral explanation.' }],
        }],
      }],
    }
    const imported = await importLibraryFiles([new File([JSON.stringify(json)], 'neutral-w3-test.json', { type: 'application/json' })])
    expect(imported.report.errors).toEqual([])
    expect(Object.keys(imported.libraryByAreaId)).toEqual(['w3-praesentation'])

    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', imported)
    await navigator(wrapper).vm.$emit('open-group', 'w3')
    await navigator(wrapper).vm.$emit('open-area', 'w3-praesentation')
    await navigator(wrapper).vm.$emit('open-lesson', 'n-lesson')
    await navigator(wrapper).vm.$emit('start-scenario', 'n-scenario')
    expect(wrapper.findComponent({ name: 'ChoiceCard' }).props('item')).toMatchObject({ id: 'n-1', areaId: 'w3-praesentation' })
  })

  it('vollständiger Weg W3 -> zurück -> W2: Szenario in W2 startet und speichert unter der W2-areaId', async () => {
    const wrapper = await mountLoaded()
    await navigator(wrapper).vm.$emit('open-group', 'w3')
    await navigator(wrapper).vm.$emit('open-area', 'w3-unterricht')
    await navigator(wrapper).vm.$emit('open-lesson', 'n-lesson')
    await navigator(wrapper).vm.$emit('back-to-lessons')
    await navigator(wrapper).vm.$emit('back-to-areas')
    await navigator(wrapper).vm.$emit('back-to-groups')
    expect(navigator(wrapper).props('selectedGroupId')).toBeNull()
    expect(navigator(wrapper).props('selectedAreaId')).toBeNull()

    await navigator(wrapper).vm.$emit('open-area', 'telephoning')
    await navigator(wrapper).vm.$emit('open-lesson', 'n-lesson')
    await navigator(wrapper).vm.$emit('start-scenario', 'n-scenario')
    await wrapper.findComponent({ name: 'ChoiceCard' }).vm.$emit('select-answer', 'A')

    expect(getItemStatus('telephoning', 'shared-1')).toMatchObject({ status: 'correct', attempts: 1 })
    expect(getItemStatus('w3-unterricht', 'shared-1')).toBeNull()
  })

  it('ein importierter Bereich mit areaId "w3" bleibt ein eigener Bereich neben der Gruppe "w3"', async () => {
    window.localStorage.clear()
    const wrapper = shallowMount(App)
    await wrapper.findComponent({ name: 'PrivateContentImporter' }).vm.$emit('libraries-loaded', {
      ...registry, libraryByAreaId: { w3: { library: neutralLibrary('w3', 'x-1') } },
    })
    await navigator(wrapper).vm.$emit('open-area', 'w3')
    expect(navigator(wrapper).props('selectedAreaId')).toBe('w3')
    expect(navigator(wrapper).props('selectedGroupId')).toBeNull()
    await navigator(wrapper).vm.$emit('back-to-areas')
    await navigator(wrapper).vm.$emit('open-group', 'w3')
    expect(navigator(wrapper).props('selectedGroupId')).toBe('w3')
    expect(navigator(wrapper).props('selectedAreaId')).toBeNull()
  })
})
