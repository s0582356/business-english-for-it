// Auftrag 093 (Oberflaeche): aktive Sitzung und gespeicherter Stand getrennt beschriftet, auch bei verlorenen
// Synchronisierungssignalen; Loeschschutz anhand der Bytes; Statussemantik (role="status" / role="alert").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import FDBObjectStore from 'fake-indexeddb/lib/FDBObjectStore'
import App from '../../App.vue'
import { PROGRESS_STORAGE_KEY, recordItemResult } from '../../utils/progressStorage.js'
import { fileOf, freshEnvironment, quizData, quotaError } from '../../utils/__tests__/privateStorageTestHelpers.js'
import { createFakeBroadcast, makeTab, storedSnapshot } from '../../utils/__tests__/privateTabHelpers.js'

const mounted = []
const otherTabs = []

function mountApp() {
  const wrapper = shallowMount(App, { global: { stubs: { PrivateContentImporter: false } } })
  mounted.push(wrapper)
  return wrapper
}

const navigator = (wrapper) => wrapper.findComponent({ name: 'LearningNavigator' })
const sessionVersion = (wrapper, areaId = 'test-area') => navigator(wrapper).props('libraryByAreaId')[areaId]?.library.libraryVersion ?? null
const panel = (wrapper) => wrapper.get('[data-stored-libraries]')

async function settled(wrapper) {
  await vi.waitFor(async () => {
    await flushPromises()
    expect(wrapper.find('[data-stored-state="loading"]').exists()).toBe(false)
  }, { timeout: 3000 })
}

async function chooseFiles(wrapper, files) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await wrapper.vm.privateLibraries.enqueue(() => {})
  await flushPromises()
}

async function ask(wrapper, selector = '[data-stored-remove]') {
  await wrapper.get(selector).trigger('click')
  await vi.waitFor(async () => {
    await flushPromises()
    expect(wrapper.find('[data-stored-remove-confirm]').exists()).toBe(true)
  }, { timeout: 3000 })
}

// Die Speicheransicht erneut oeffnen: der Importer wird beim Zurueckkehren zur Startansicht neu eingehaengt.
async function reopenPanel(wrapper) {
  wrapper.vm.view = 'lessons'
  await flushPromises()
  wrapper.vm.view = 'home'
  await flushPromises()
}

const otherTab = (options) => {
  const created = makeTab(options)
  otherTabs.push(created)
  return created
}

beforeEach(freshEnvironment)
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  while (mounted.length) mounted.pop().unmount?.()
  while (otherTabs.length) otherTabs.pop().close()
})

describe('B. Verlorene Synchronisierung in der Oberflaeche', () => {
  it('B lernt mit Version 2, A speichert Version 3, B verpasst jedes Signal: B behauptet keinen sicher aktuellen Speicherstand', async () => {
    const { FakeBroadcastChannel } = createFakeBroadcast({ drop: true })
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const appA = mountApp()
    const appB = mountApp()
    await settled(appA)
    await settled(appB)
    await chooseFiles(appB, [fileOf(quizData({ libraryVersion: 2 }), 'v2.json')])
    recordItemResult('test-area', 'item-a', true)
    const progress = window.localStorage.getItem(PROGRESS_STORAGE_KEY)

    await chooseFiles(appA, [fileOf(quizData({ libraryVersion: 3 }), 'v3.json')])
    await new Promise((done) => setTimeout(done, 30))

    // B zeigt weiter seine aktive Sitzung, aber der Speicherstand ist erkennbar nur "zuletzt geprueft", nicht "aktuell".
    expect(sessionVersion(appB)).toBe(2)
    const stale = panel(appB)
    expect(stale.get('[data-stored-checked]').text()).toMatch(/Gespeicherter Stand zuletzt geprüft um \d{2}:\d{2} Uhr\./)
    expect(stale.get('[data-stored-status]').text()).toBe('✓ In dieser Sitzung einsatzbereit – Version 2')
    expect(stale.text()).not.toMatch(/aktuell/i)

    // Speicherbereich erneut anzeigen: der tatsaechliche IndexedDB-Stand wird neu gelesen.
    await reopenPanel(appB)
    await vi.waitFor(async () => {
      await flushPromises()
      expect(panel(appB).get('.stored-meta').text()).toContain('Auf diesem Gerät gespeichert – Version 3')
    }, { timeout: 3000 })
    expect(panel(appB).get('[data-stored-status]').text()).toContain('In dieser Sitzung ist Version 2 aktiv, auf diesem Gerät gespeichert ist Version 3')
    expect(panel(appB).text()).not.toContain('✓ In dieser Sitzung einsatzbereit – Version 2')
    expect(sessionVersion(appB)).toBe(2) // laufende Sitzung unveraendert
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(progress) // Fortschritt unveraendert

    // Neustart: Version 3 wird aktiviert.
    appB.unmount()
    const restarted = mountApp()
    await settled(restarted)
    expect(sessionVersion(restarted)).toBe(3)
    expect(panel(restarted).get('[data-stored-status]').text()).toBe('✓ In dieser Sitzung einsatzbereit – Version 3')
  })

  it('"Neu prüfen" liest den Speicher sofort neu', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData({ libraryVersion: 1 }), 'v1.json')])
    await otherTab().importFiles([fileOf(quizData({ libraryVersion: 2 }), 'v2.json')])
    expect(panel(wrapper).get('.stored-meta').text()).toContain('Version 1')
    await wrapper.get('[data-stored-check]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(panel(wrapper).get('.stored-meta').text()).toContain('Version 2')
    }, { timeout: 3000 })
    expect(panel(wrapper).get('[data-stored-notice]').text()).toContain('in einem anderen Tab oder Fenster geändert')
  })

  it('gelingt die Pruefung nicht, steht das dort: alter Stand wird als solcher gekennzeichnet', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'v1.json')])
    vi.spyOn(FDBObjectStore.prototype, 'openCursor').mockImplementation(() => {
      throw new DOMException('boom', 'UnknownError')
    })
    await wrapper.get('[data-stored-check]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(panel(wrapper).get('[data-stored-checked]').text()).toContain('konnte zuletzt nicht geprüft werden. Angezeigt ist der Stand von')
    }, { timeout: 3000 })
    vi.restoreAllMocks()
    await wrapper.get('[data-stored-check]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(panel(wrapper).get('[data-stored-checked]').text()).toContain('Gespeicherter Stand zuletzt geprüft um')
    }, { timeout: 3000 })
  })

  it('der Speicherbereich liest beim erneuten Anzeigen neu, nicht beim ersten Start doppelt', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    const opens = vi.spyOn(globalThis.indexedDB, 'open')
    await reopenPanel(wrapper)
    await vi.waitFor(() => expect(wrapper.find('[data-stored-checked]').exists()).toBe(true))
    await flushPromises()
    expect(opens.mock.calls.length).toBeLessThanOrEqual(1) // genau ein erneutes Lesen, kein Import
    expect(Object.keys(navigator(wrapper).props('libraryByAreaId'))).toEqual([])
  })
})

describe('A. Loeschbestaetigung in der Oberflaeche: tatsaechliche Bytes', () => {
  it('gleiche Metadaten, aber andere Bytes nach der Rueckfrage: Bestaetigung loescht nicht', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'v1.json')])
    recordItemResult('test-area', 'item-a', true)
    const progress = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    await ask(wrapper)

    // Ein anderer Tab (oder ein Defekt) aendert die Bytes bei identischen Metadaten.
    const [stored] = (await storedSnapshot()).records
    const flipped = new Uint8Array(stored.bytes.slice(0))
    flipped[1] ^= 0xff
    const db = await new Promise((done, fail) => {
      const request = indexedDB.open('businessEnglishPrivateLibraries', 1)
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    await new Promise((done, fail) => {
      const tx = db.transaction('libraries', 'readwrite')
      tx.objectStore('libraries').put({ ...stored, bytes: flipped.buffer })
      tx.oncomplete = done
      tx.onerror = () => fail(tx.error)
    })
    db.close()

    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(wrapper.find('[data-stored-notice]').exists()).toBe(true)
    }, { timeout: 3000 })
    expect(wrapper.get('[data-stored-notice]').text()).toContain('NICHT entfernt')
    expect(wrapper.get('[data-stored-notice]').attributes('role')).toBe('alert')
    expect((await storedSnapshot()).records.length + (await storedSnapshot()).corrupt.length).toBe(1)
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(progress)
  })

  it('unveraenderter Datensatz: Bestaetigung entfernt ihn, Lernfortschritt bleibt', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'v1.json')])
    recordItemResult('test-area', 'item-a', true)
    const progress = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    await ask(wrapper)
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect((await storedSnapshot()).records).toEqual([])
    }, { timeout: 3000 })
    expect(window.localStorage.getItem(PROGRESS_STORAGE_KEY)).toBe(progress)
  })
})

describe('Barrierefreie Statusmeldungen', () => {
  const alerts = (wrapper) => panel(wrapper).findAll('[role="alert"]')

  it('es gibt einen dauerhaften, hoeflichen Statusbereich; im Ruhezustand ist kein Alarm sichtbar', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    const live = panel(wrapper).get('.stored-live')
    expect(live.attributes('role')).toBe('status')
    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.find('[data-stored-state="empty"]').exists()).toBe(true)
    expect(alerts(wrapper)).toHaveLength(0)
  })

  it('Erfolgsmeldungen stehen im Statusbereich (role="status"), nicht als Alarm', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    await ask(wrapper)
    expect(alerts(wrapper)).toHaveLength(1) // nur die bestehende Bestaetigungsfrage
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(wrapper.find('[data-stored-notice]').exists()).toBe(true)
    }, { timeout: 3000 })
    const notice = wrapper.get('[data-stored-notice]')
    expect(notice.element.closest('[role="status"]')).not.toBeNull()
    expect(notice.attributes('role')).toBeUndefined()
    expect(alerts(wrapper)).toHaveLength(0)
  })

  it('Speicherfehler (Speicher voll) ist genau EIN role="alert", ausserhalb des Statusbereichs', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quotaError()
    })
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    vi.restoreAllMocks()
    const found = alerts(wrapper)
    expect(found).toHaveLength(1)
    expect(found[0].attributes('data-stored-save-problem')).toBeDefined()
    expect(found[0].element.closest('[role="status"]')).toBeNull()
  })

  it('abgelehnte Version (veraltet) ist ein role="alert"', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await otherTab().importFiles([fileOf(quizData({ libraryVersion: 3 }), 'v3.json')])
    await chooseFiles(wrapper, [fileOf(quizData({ libraryVersion: 2 }), 'v2.json')])
    expect(alerts(wrapper).map((node) => node.attributes('data-stored-rejection') !== undefined)).toEqual([true])
  })

  it('Fehlschlag beim Entfernen: genau ein role="alert" mit der Fehlermeldung; die Rueckfrage bleibt erhalten', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    await ask(wrapper)
    expect(wrapper.get('.stored-confirm-text').attributes('role')).toBe('alert')
    vi.spyOn(FDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw quotaError()
    })
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(wrapper.find('[data-stored-notice]').exists()).toBe(true)
    }, { timeout: 3000 })
    expect(alerts(wrapper)).toHaveLength(1)
    expect(alerts(wrapper)[0].text()).toContain('konnte nicht entfernt werden')
  })

  it('kein Element traegt zugleich status und alert; die Pruefzeile ist keine Live-Region', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    for (const node of panel(wrapper).findAll('[role]')) expect(['status', 'alert']).toContain(node.attributes('role'))
    expect(panel(wrapper).get('[data-stored-checked]').element.closest('[role="status"]')).toBeNull()
    expect(panel(wrapper).get('[data-stored-checked]').attributes('aria-live')).toBeUndefined()
  })

  it('der Hinweis "kein lokales Speichern" steht im Statusbereich (kein Alarm beim Start)', async () => {
    globalThis.indexedDB = undefined
    const wrapper = mountApp()
    await settled(wrapper)
    expect(wrapper.get('[data-stored-state="unavailable"]').element.closest('[role="status"]')).not.toBeNull()
    expect(alerts(wrapper)).toHaveLength(0)
  })
})
