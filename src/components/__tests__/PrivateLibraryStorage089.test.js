// Auftrag 089: private JSON-Bibliotheken lokal speichern, nach Neustart wiederherstellen, aktualisieren, entfernen.
// "Neustart" = App unmounten und eine neue App-Instanz mounten; der Browser-Speicher (fake-indexeddb, localStorage)
// bleibt dabei bestehen. Alle Inhalte sind kuenstliche Demo-Daten.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import FDBObjectStore from 'fake-indexeddb/lib/FDBObjectStore'
import App from '../../App.vue'
import { PROGRESS_STORAGE_KEY, getItemStatus, recordItemResult } from '../../utils/progressStorage.js'
import { createPrivateLibraryStore } from '../../utils/privateLibraryStore.js'
import { STORED_MARKER_KEY } from '../../utils/privateLibraryPersistence.js'
import { coachLibraryData } from '../../utils/__tests__/coachTestHelpers.js'
import { fileOf, freshEnvironment, quizData, quotaError, resetIndexedDb } from '../../utils/__tests__/privateStorageTestHelpers.js'

const mounted = []

function mountApp() {
  const wrapper = shallowMount(App, { global: { stubs: { PrivateContentImporter: false } } })
  mounted.push(wrapper)
  return wrapper
}

const navigator = (wrapper) => wrapper.findComponent({ name: 'LearningNavigator' })
const activeAreas = (wrapper) => Object.keys(navigator(wrapper).props('libraryByAreaId'))
const activeVersion = (wrapper, areaId = 'test-area') => navigator(wrapper).props('libraryByAreaId')[areaId]?.library.libraryVersion ?? null
const panel = (wrapper) => wrapper.get('[data-stored-libraries]')

async function settled(wrapper, condition = () => wrapper.find('[data-stored-state="loading"]').exists() === false) {
  await vi.waitFor(async () => {
    await flushPromises()
    expect(condition()).toBe(true)
  }, { timeout: 3000 })
}

// Wartet, bis die Warteschlange des Controllers (Auswahl, Aktivierung, Speichern) vollstaendig abgearbeitet ist.
async function chooseFiles(wrapper, files) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await wrapper.vm.privateLibraries.enqueue(() => {})
  await flushPromises()
}

async function storedKeys() {
  const store = createPrivateLibraryStore()
  const { records } = await store.list()
  store.close()
  return records.map((record) => `${record.key}@${record.libraryVersion}`).sort()
}

// Klick auf "Entfernen": die Rueckfrage oeffnet sich erst, nachdem der Controller den Datensatz (samt Bytes) erfasst hat.
async function ask(wrapper, selector = '[data-stored-remove]') {
  await wrapper.get(selector).trigger('click')
  await vi.waitFor(async () => {
    await flushPromises()
    expect(wrapper.find('[data-stored-remove-confirm]').exists()).toBe(true)
  }, { timeout: 3000 })
}

async function restart(wrapper) {
  wrapper.unmount()
  const next = mountApp()
  await settled(next)
  return next
}

beforeEach(freshEnvironment)
afterEach(() => {
  vi.restoreAllMocks()
  while (mounted.length) mounted.pop().unmount?.()
})

describe('Speichern und Wiederherstellen nach Neustart', () => {
  it('importierte Bibliothek ist nach dem erneuten Oeffnen der App automatisch wieder aktiv und einsatzbereit', async () => {
    const first = mountApp()
    await settled(first)
    expect(panel(first).text()).toContain('Noch keine Bibliothek gespeichert')

    await chooseFiles(first, [fileOf(quizData(), 'demo.json')])
    expect(activeAreas(first)).toEqual(['test-area'])
    expect(await storedKeys()).toEqual(['quiz:test-area@1'])
    expect(panel(first).text()).toContain('In dieser Sitzung einsatzbereit')

    const second = await restart(first)
    expect(activeAreas(second)).toEqual(['test-area'])
    expect(activeVersion(second)).toBe(1)
    expect(panel(second).text()).toContain('Quiz-Bibliothek: Test Area')
    expect(panel(second).text()).toContain('Version 1')
    expect(panel(second).text()).toContain('In dieser Sitzung einsatzbereit')
    expect(second.find('[aria-label="Importbericht"]').exists()).toBe(false) // stiller Start, kein Import-Rauschen
  })

  it('Lernfortschritt und Resume-Daten bleiben unveraendert (eigener Speicher, nicht angefasst)', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'demo.json')])
    recordItemResult('test-area', 'item-a', true)
    const progressBefore = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    expect(progressBefore).not.toBeNull()

    const second = await restart(first)
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(progressBefore)
    expect(getItemStatus('test-area', 'item-a').status).toBe('correct')
    expect(navigator(second).props('itemStatuses')).toBeDefined()
    expect(activeAreas(second)).toEqual(['test-area'])
  })

  it('Lerncoach, Uebungen und Quiz-Bibliothek werden gemeinsam gespeichert und wiederhergestellt', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'quiz.json'), fileOf(coachLibraryData(), 'coach.json')])
    expect(await storedKeys()).toEqual(['coach@1', 'quiz:test-area@1'])

    const second = await restart(first)
    expect(activeAreas(second)).toEqual(['test-area'])
    expect(navigator(second).props('coachEntry')).not.toBeNull()
    expect(second.findAll('[data-stored-status]').map((node) => node.text())).toEqual(['✓ In dieser Sitzung einsatzbereit – Version 1', '✓ In dieser Sitzung einsatzbereit – Version 1'])
  })

  it('Zurueckkehren in die Startansicht laedt den Speicher nicht erneut (einmal je Start)', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'demo.json')])
    const openSpy = vi.spyOn(globalThis.indexedDB, 'open')
    wrapper.vm.view = 'lessons' // Importer wird ausgehaengt ...
    await flushPromises()
    expect(wrapper.find('[data-stored-libraries]').exists()).toBe(false)
    wrapper.vm.view = 'home' // ... und beim Zurueckkehren neu eingehaengt
    await flushPromises()
    expect(wrapper.find('[data-stored-state="loading"]').exists()).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
    expect(activeAreas(wrapper)).toEqual(['test-area'])
    expect(panel(wrapper).text()).toContain('In dieser Sitzung einsatzbereit')
  })
})

describe('Aktualisierung vorhandener Bibliotheken', () => {
  it('hoehere Version ersetzt die gespeicherte kontrolliert; nach Neustart gilt die neue Version', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'v1.json')])
    await chooseFiles(first, [fileOf(quizData({ libraryVersion: 2 }), 'v2.json')])
    expect(await storedKeys()).toEqual(['quiz:test-area@2'])
    expect(activeVersion(first)).toBe(2)

    const second = await restart(first)
    expect(activeVersion(second)).toBe(2)
    expect(panel(second).findAll('.stored-item')).toHaveLength(1)
  })

  it('aeltere Version veraendert den gespeicherten Stand nicht', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData({ libraryVersion: 3 }), 'v3.json')])
    await chooseFiles(first, [fileOf(quizData({ libraryVersion: 1 }), 'v1.json')])
    expect(await storedKeys()).toEqual(['quiz:test-area@3'])
    expect(activeVersion(await restart(first))).toBe(3)
  })

  it('identischer Re-Import schreibt nichts neu (Zeitstempel bleibt)', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'a.json')])
    const store = createPrivateLibraryStore()
    const before = (await store.list()).records[0].savedAt
    await new Promise((done) => setTimeout(done, 15))
    await chooseFiles(first, [fileOf(quizData(), 'a-kopie.json')])
    expect((await store.list()).records[0].savedAt).toBe(before)
    store.close()
  })

  it('Konflikt (gleiche Version, anderer Inhalt) laesst den gespeicherten Stand unveraendert', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'a.json')])
    await chooseFiles(first, [fileOf(quizData({ prompt: 'Andere Frage?' }), 'b.json')])
    expect(first.text()).toContain('Konflikt')
    expect(await storedKeys()).toEqual(['quiz:test-area@1'])
  })
})

describe('Ungueltige Dateien zerstoeren nichts', () => {
  it.each([
    ['kein JSON', '{ kaputt'],
    ['Schemafehler', JSON.stringify({ ...quizData({ libraryVersion: 5 }), lessons: [] })],
    ['leere Datei', ''],
  ])('%s: gespeicherte Bibliothek bleibt aktiv und nach Neustart verfuegbar', async (_label, content) => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'gut.json')])
    await chooseFiles(first, [fileOf(content, 'schlecht.json')])
    expect(first.text()).toContain('Fehler in schlecht.json')
    expect(activeVersion(first)).toBe(1)
    expect(await storedKeys()).toEqual(['quiz:test-area@1'])
    expect(activeVersion(await restart(first))).toBe(1)
  })

  it('zu grosse Datei (ueber 5 MB) wird abgelehnt und nicht gespeichert', async () => {
    const first = mountApp()
    await settled(first)
    const huge = new File(['{}'], 'riesig.json', { type: 'application/json' })
    Object.defineProperty(huge, 'size', { value: 5 * 1024 * 1024 + 1 })
    await chooseFiles(first, [huge])
    expect(first.text()).toContain('zu groß')
    expect(await storedKeys()).toEqual([])
  })
})

describe('Korrupte gespeicherte Daten', () => {
  async function plant(wrapper, mutate) {
    await chooseFiles(wrapper, [fileOf(quizData(), 'gut.json')])
    const store = createPrivateLibraryStore()
    const [record] = (await store.list()).records
    await store.forcePut(mutate(record))
    store.close()
  }

  it('veraenderte Bytes: Hinweis "beschaedigt", die App bleibt nutzbar, erneuter Import repariert den Eintrag', async () => {
    const first = mountApp()
    await settled(first)
    await plant(first, (record) => {
      const bytes = new TextEncoder().encode('{"manipuliert":true}').buffer
      return { ...record, bytes, size: bytes.byteLength }
    })
    const second = await restart(first)
    expect(activeAreas(second)).toEqual([])
    expect(panel(second).text()).toContain('beschädigt')
    expect(panel(second).text()).toContain('importiere die JSON-Datei erneut')
    expect(second.find('[data-stored-remove]').exists()).toBe(true)

    await chooseFiles(second, [fileOf(quizData(), 'gut.json')])
    expect(activeAreas(second)).toEqual(['test-area'])
    expect(panel(second).text()).not.toContain('beschädigt')
    expect(activeVersion(await restart(second))).toBe(1)
  })

  it('gueltiger Fingerabdruck, aber Inhalt besteht die Validierung nicht mehr: nicht aktiv, verstaendlicher Hinweis, nicht geloescht', async () => {
    const first = mountApp()
    await settled(first)
    const { fingerprintFile } = await import('../../utils/fingerprint.js')
    await plant(first, (record) => record)
    const store = createPrivateLibraryStore()
    const [record] = (await store.list()).records
    const bad = new TextEncoder().encode(JSON.stringify({ ...quizData(), lessons: [] })).buffer
    await store.forcePut({ ...record, bytes: bad, size: bad.byteLength, fingerprint: await fingerprintFile(new File([bad], 'x.json')) })
    store.close()

    const second = await restart(first)
    expect(activeAreas(second)).toEqual([])
    expect(panel(second).text()).toContain('Nicht nutzbar')
    expect(panel(second).text()).toContain('Bitte importiere die Datei erneut')
    expect(await storedKeys()).toEqual(['quiz:test-area@1'])
  })

  it('ein beschaedigter Eintrag blockiert andere gespeicherte Bibliotheken nicht', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData({ areaId: 'a', libraryId: 'la' }), 'a.json'), fileOf(quizData({ areaId: 'b', libraryId: 'lb' }), 'b.json')])
    const store = createPrivateLibraryStore()
    const records = (await store.list()).records
    const victim = records.find((record) => record.areaId === 'a')
    const bytes = new TextEncoder().encode('kaputt').buffer
    await store.forcePut({ ...victim, bytes, size: bytes.byteLength })
    store.close()
    const second = await restart(first)
    expect(activeAreas(second)).toEqual(['b'])
  })
})

describe('Speicherfehler', () => {
  it('Speicher voll: Bibliothek bleibt in dieser Sitzung nutzbar, verstaendliche Meldung, frueherer Stand bleibt', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'v1.json')])
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quotaError()
    })
    await chooseFiles(first, [fileOf(quizData({ libraryVersion: 2 }), 'v2.json')])
    vi.restoreAllMocks()

    expect(activeVersion(first)).toBe(2)
    const warning = first.get('[data-stored-save-problem]').text()
    expect(warning).toContain('v2.json')
    expect(warning).toContain('nicht genug Speicherplatz')
    expect(warning).toContain('nur, bis du die App schließt')
    expect(await storedKeys()).toEqual(['quiz:test-area@1'])
    expect(activeVersion(await restart(first))).toBe(1)
  })

  it('nach einem spaeteren erfolgreichen Speichern verschwindet die Meldung', async () => {
    const first = mountApp()
    await settled(first)
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quotaError()
    })
    await chooseFiles(first, [fileOf(quizData(), 'v1.json')])
    vi.restoreAllMocks()
    expect(first.find('[data-stored-save-problem]').exists()).toBe(true)
    await chooseFiles(first, [fileOf(quizData(), 'v1-nochmal.json')]) // Duplikat der aktiven Bibliothek -> wird nachgespeichert
    expect(first.find('[data-stored-save-problem]').exists()).toBe(false)
    expect(await storedKeys()).toEqual(['quiz:test-area@1'])
  })

  it('kein IndexedDB (z. B. privater Modus): klarer Hinweis, Import funktioniert weiter, nichts in localStorage', async () => {
    globalThis.indexedDB = undefined
    const wrapper = mountApp()
    await settled(wrapper)
    expect(panel(wrapper).get('[data-stored-state="unavailable"]').text()).toContain('kein lokales Speichern')
    await chooseFiles(wrapper, [fileOf(quizData(), 'demo.json')])
    expect(activeAreas(wrapper)).toEqual(['test-area'])
    expect(wrapper.get('[data-stored-save-problem]').text()).toContain('nicht gespeichert')
    expect(window.localStorage.getItem(STORED_MARKER_KEY)).toBeNull()
  })

  it('hat das System den Speicher geleert: Aufforderung zum erneuten Import, danach wieder einsatzbereit', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'meine-datei.json')])
    first.unmount()
    resetIndexedDb() // iOS entfernt IndexedDB; die kleine Merkliste bleibt

    const second = mountApp()
    await settled(second)
    expect(activeAreas(second)).toEqual([])
    const missing = second.get('[data-stored-missing]').text()
    expect(missing).toContain('Nicht mehr auf diesem Gerät vorhanden')
    expect(missing).toContain('meine-datei.json')
    expect(missing).toContain('erneut aus')

    await chooseFiles(second, [fileOf(quizData(), 'meine-datei.json')])
    expect(second.find('[data-stored-missing]').exists()).toBe(false)
    expect(activeVersion(await restart(second))).toBe(1)
  })

  it('der Hinweis "vom System entfernt" laesst sich ausblenden und kommt nicht wieder', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'a.json')])
    first.unmount()
    resetIndexedDb()
    const second = mountApp()
    await settled(second)
    await second.get('[data-stored-dismiss]').trigger('click')
    expect(second.find('[data-stored-missing]').exists()).toBe(false)
    expect(second.find('[data-stored-state="empty"]').exists()).toBe(true)
    expect((await restart(second)).find('[data-stored-missing]').exists()).toBe(false)
  })
})

describe('Manuelles Entfernen', () => {
  it('"Gespeicherte Bibliothek entfernen" fragt nach, loescht dann Speicher und Aktivierung, Fortschritt bleibt', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'a.json')])
    recordItemResult('test-area', 'item-a', true)
    const progress = window.localStorage.getItem(PROGRESS_STORAGE_KEY)

    await ask(first, '[data-stored-remove]')
    expect(panel(first).text()).toContain('wirklich entfernen')
    expect(await storedKeys()).toEqual(['quiz:test-area@1']) // noch nichts geloescht
    await first.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(await storedKeys()).toEqual([])
    })
    await flushPromises()

    expect(activeAreas(first)).toEqual([])
    expect(panel(first).get('[data-stored-notice]').text()).toContain('Lernfortschritt bleibt erhalten')
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(progress)
    expect(window.localStorage.getItem(STORED_MARKER_KEY)).toBeNull()
    const second = await restart(first)
    expect(activeAreas(second)).toEqual([])
    expect(second.find('[data-stored-missing]').exists()).toBe(false) // bewusst entfernt != vom System geloescht
    expect(getItemStatus('test-area', 'item-a').status).toBe('correct')
  })

  it('Abbrechen behaelt die Bibliothek', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    await ask(wrapper, '[data-stored-remove]')
    await wrapper.get('[data-stored-remove-cancel]').trigger('click')
    expect(wrapper.find('[data-stored-remove-confirm]').exists()).toBe(false)
    expect(activeAreas(wrapper)).toEqual(['test-area'])
    expect(await storedKeys()).toEqual(['quiz:test-area@1'])
  })

  it('entfernt nur die gewaehlte Bibliothek, andere bleiben gespeichert und aktiv', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData({ areaId: 'a', libraryId: 'la' }), 'a.json'), fileOf(quizData({ areaId: 'b', libraryId: 'lb' }), 'b.json')])
    await ask(wrapper, '[data-stored-key="quiz:a"] [data-stored-remove]')
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(await storedKeys()).toEqual(['quiz:b@1'])
    })
    await flushPromises()
    expect(activeAreas(wrapper)).toEqual(['b'])
  })

  it('Fehler beim Entfernen: Meldung, Bibliothek bleibt erhalten', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    vi.spyOn(FDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw new DOMException('boom', 'UnknownError')
    })
    await ask(wrapper, '[data-stored-remove]')
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(wrapper.find('[data-stored-notice]').exists()).toBe(true)
    })
    expect(wrapper.get('[data-stored-notice]').text()).toContain('konnte nicht entfernt werden')
    vi.restoreAllMocks()
    expect(activeAreas(wrapper)).toEqual(['test-area'])
    expect(await storedKeys()).toEqual(['quiz:test-area@1'])
  })
})

describe('Keine automatische Loeschung, kein 30-Tage-Ablauf', () => {
  it('gespeicherte Bibliothek ist auch nach sehr langer Zeit unveraendert verfuegbar', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'a.json')])
    first.unmount()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 400 * 24 * 60 * 60 * 1000) // gut 13 Monate spaeter
    try {
      const later = mountApp()
      await settled(later)
      expect(activeAreas(later)).toEqual(['test-area'])
      expect(later.find('[data-stored-missing]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
