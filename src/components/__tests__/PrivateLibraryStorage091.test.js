// Auftrag 091 (Oberflaeche): Loeschbestaetigung auch bei beschaedigten Eintraegen, veraltete Bestaetigungen,
// Mehr-Tab-Anzeige, Safari-/Home-Bildschirm-Hinweis und alle vier Bibliotheksarten nach Neustart.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import App from '../../App.vue'
import { createPrivateLibraryStore } from '../../utils/privateLibraryStore.js'
import { coachLibraryData } from '../../utils/__tests__/coachTestHelpers.js'
import { figureData } from '../../utils/__tests__/figureTestHelpers.js'
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
const activeAreas = (wrapper) => Object.keys(navigator(wrapper).props('libraryByAreaId'))
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

// Ein zweiter "Tab" ohne Oberflaeche, der in denselben Speicher schreibt.
function otherTab(options) {
  const created = makeTab(options)
  otherTabs.push(created)
  return created
}

beforeEach(() => {
  freshEnvironment()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  while (mounted.length) mounted.pop().unmount?.()
  while (otherTabs.length) otherTabs.pop().close()
})

async function corruptStoredBytes() {
  const store = createPrivateLibraryStore()
  const [record] = (await store.list()).records
  const bytes = new TextEncoder().encode('{"manipuliert":true}').buffer
  await store.forcePut({ ...record, bytes, size: bytes.byteLength })
  store.close()
}

describe('C. Beschaedigte Bibliothek entfernen: Bestaetigung erforderlich', () => {
  async function appWithCorruptEntry() {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'gut.json')])
    await corruptStoredBytes()
    const second = await restart(first)
    expect(panel(second).find('[data-stored-invalid]').exists()).toBe(true)
    return second
  }

  it('ein Klick loescht nichts: es erscheint die Rueckfrage mit dem festen Wortlaut', async () => {
    const wrapper = await appWithCorruptEntry()
    await ask(wrapper, '[data-stored-invalid] [data-stored-remove]')
    expect(wrapper.get('[data-stored-invalid] [role="alert"]').text()).toBe('Möchtest du diese lokal gespeicherte Bibliothek wirklich entfernen? Dein Lernfortschritt bleibt erhalten.')
    expect((await storedSnapshot()).records).toHaveLength(1)
  })

  it('Abbrechen veraendert nichts', async () => {
    const wrapper = await appWithCorruptEntry()
    await ask(wrapper, '[data-stored-invalid] [data-stored-remove]')
    await wrapper.get('[data-stored-remove-cancel]').trigger('click')
    expect(wrapper.find('[data-stored-remove-confirm]').exists()).toBe(false)
    expect(wrapper.find('[data-stored-notice]').exists()).toBe(false)
    expect((await storedSnapshot()).records).toHaveLength(1)
    expect(wrapper.find('[data-stored-invalid]').exists()).toBe(true)
  })

  it('erst die ausdrueckliche Bestaetigung entfernt den Datensatz; die Meldung kommt erst danach', async () => {
    const wrapper = await appWithCorruptEntry()
    await ask(wrapper, '[data-stored-invalid] [data-stored-remove]')
    expect(wrapper.find('[data-stored-notice]').exists()).toBe(false)
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect((await storedSnapshot()).records).toEqual([])
    })
    await flushPromises()
    expect(wrapper.find('[data-stored-invalid]').exists()).toBe(false)
    expect(wrapper.get('[data-stored-notice]').text()).toContain('Gespeicherte Bibliothek entfernt')
  })

  it('strukturell beschaedigter Eintrag (ohne verwertbaren Fingerabdruck): ebenfalls Rueckfrage, dann Entfernen', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(coachLibraryData(), 'coach.json')])
    const raw = await new Promise((done, fail) => {
      const request = indexedDB.open('businessEnglishPrivateLibraries', 1)
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    await new Promise((done, fail) => {
      const tx = raw.transaction('libraries', 'readwrite')
      tx.objectStore('libraries').put({ key: 'coach', savedAt: 5, bytes: 'kein-binaer' })
      tx.oncomplete = done
      tx.onerror = () => fail(tx.error)
    })
    raw.close()
    const second = await restart(first)
    await ask(second, '[data-stored-invalid] [data-stored-remove]')
    expect((await storedSnapshot()).corrupt).toHaveLength(1) // Klick allein loescht nicht
    await second.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect((await storedSnapshot()).corrupt).toEqual([])
    })
  })

  it('wurde der Eintrag zwischenzeitlich in einem anderen Tab repariert/ersetzt, entfernt die alte Bestaetigung ihn nicht', async () => {
    const wrapper = await appWithCorruptEntry()
    await ask(wrapper, '[data-stored-invalid] [data-stored-remove]') // Bestaetigung betrifft den defekten Stand
    const tab = otherTab()
    await tab.importFiles([fileOf(quizData({ libraryVersion: 2 }), 'neu.json')]) // anderer Tab speichert eine gueltige neuere Version
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(wrapper.find('[data-stored-notice]').exists()).toBe(true)
    })
    expect(wrapper.get('[data-stored-notice]').text()).toContain('NICHT entfernt')
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@2'])
    await flushPromises()
    expect(wrapper.find('[data-stored-invalid]').exists()).toBe(false) // Anzeige zeigt den echten Stand
    expect(panel(wrapper).text()).toContain('Version 2')
  })
})

describe('C. Gueltige Bibliothek: veraltete Loeschbestaetigung', () => {
  it('Version 1 angezeigt und Rueckfrage offen; anderer Tab speichert Version 2; Bestaetigung entfernt Version 2 nicht', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'v1.json')])
    await ask(wrapper, '[data-stored-remove]')
    expect(panel(wrapper).text()).toContain('wirklich entfernen')

    await otherTab().importFiles([fileOf(quizData({ libraryVersion: 2 }), 'v2.json')])
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(wrapper.find('[data-stored-notice]').exists()).toBe(true)
    })
    expect(wrapper.get('[data-stored-notice]').text()).toContain('NICHT entfernt')
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@2'])
    expect(activeAreas(wrapper)).toEqual(['test-area']) // laufende Sitzung unveraendert
    await flushPromises()
    expect(panel(wrapper).text()).toContain('In dieser Sitzung ist Version 1 aktiv, auf diesem Gerät gespeichert ist Version 2')
  })

  it('Speicherfehler beim Entfernen: es wird nicht behauptet, die Bibliothek sei entfernt', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    const FDBObjectStore = (await import('fake-indexeddb/lib/FDBObjectStore')).default
    vi.spyOn(FDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw quotaError()
    })
    await ask(wrapper, '[data-stored-remove]')
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(wrapper.find('[data-stored-notice]').exists()).toBe(true)
    })
    const text = wrapper.get('[data-stored-notice]').text()
    expect(text).toContain('konnte nicht entfernt werden')
    expect(text).not.toContain('Gespeicherte Bibliothek entfernt.')
    vi.restoreAllMocks()
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@1'])
    expect(activeAreas(wrapper)).toEqual(['test-area'])
  })
})

describe('C. Veraltete Tabs: Hinweise im Importbereich', () => {
  it('ein Import einer niedrigeren Version meldet, dass die neuere gespeicherte Version erhalten blieb', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await otherTab().importFiles([fileOf(quizData({ libraryVersion: 3 }), 'v3.json')]) // anderer Tab, kein Signal
    await chooseFiles(wrapper, [fileOf(quizData({ libraryVersion: 2 }), 'v2.json')])
    const text = wrapper.get('[data-stored-rejection]').text()
    expect(text).toContain('v2.json')
    expect(text).toContain('neuere Version (3)')
    expect(text).toContain('bleibt unverändert')
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@3'])
    expect(activeAreas(wrapper)).toEqual(['test-area'])
  })

  it('gleiche Version mit anderem Inhalt: verstaendliche Konfliktmeldung, nichts ueberschrieben', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await otherTab().importFiles([fileOf(quizData({ libraryVersion: 3 }), 'v3.json')])
    await chooseFiles(wrapper, [fileOf(quizData({ libraryVersion: 3, prompt: 'Andere Frage?' }), 'v3-andere.json')])
    expect(wrapper.get('[data-stored-rejection]').text()).toContain('derselben Version, aber anderem Inhalt')
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@3'])
  })

  it('Speicherstatus nach Tab-Synchronisierung: App B zeigt die in App A gespeicherte Bibliothek ohne Neuladen', async () => {
    const { FakeBroadcastChannel, log } = createFakeBroadcast()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const appA = mountApp()
    const appB = mountApp()
    await settled(appA)
    await settled(appB)
    expect(panel(appB).text()).toContain('Noch keine Bibliothek gespeichert')

    await chooseFiles(appA, [fileOf(quizData({ prompt: 'GEHEIMER-INHALT' }), 'sync.json')])
    await vi.waitFor(async () => {
      await flushPromises()
      expect(panel(appB).text()).toContain('Quiz-Bibliothek: Test Area')
    }, { timeout: 3000 })
    expect(panel(appB).get('[data-stored-notice]').text()).toContain('in einem anderen Tab oder Fenster geändert')
    expect(activeAreas(appB)).toEqual([]) // aktiviert wird nur beim Start/Import, nie durch die Synchronisierung
    expect(panel(appB).text()).toContain('In dieser Sitzung nicht aktiv')
    expect(JSON.stringify(log)).not.toMatch(/GEHEIMER|sync\.json|test-area/)
  })
})

describe('Hinweise fuer Smartphone und Safari', () => {
  it('erklaert die moegliche Speichertrennung zwischen Safari und Home-Bildschirm-App mit dem vorgegebenen Wortlaut', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    expect(wrapper.get('[data-stored-ios-hint]').text()).toBe(
      'Auf dem iPhone können Safari und eine zum Home-Bildschirm hinzugefügte Web-App getrennte lokale Speicher verwenden. Falls deine Lernbibliotheken dort fehlen, importiere sie in dieser Ansicht einmal erneut.',
    )
  })

  it('stellt klar: keine automatische Ablauffrist, Entfernen durch Browser/System moeglich, keine 30-Tage-Garantie, nicht auf Render', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    const text = wrapper.get('[data-stored-persistence]').text()
    expect(text).toContain('keine automatische Ablauffrist')
    expect(text).toContain('Browser oder das Betriebssystem kann Website-Daten trotzdem entfernen')
    expect(text).toContain('Eine garantierte Aufbewahrung von mindestens 30 Tagen ist technisch nicht möglich')
    expect(text).toContain('nicht auf Render')
  })

  it('die Hinweise bleiben auch ohne verfuegbaren Browser-Speicher sichtbar', async () => {
    globalThis.indexedDB = undefined
    const wrapper = mountApp()
    await settled(wrapper)
    expect(wrapper.find('[data-stored-state="unavailable"]').exists()).toBe(true)
    expect(wrapper.find('[data-stored-ios-hint]').exists()).toBe(true)
  })
})

describe('B. Alle vier JSON-Arten nach App-Neustart (Oberflaeche)', () => {
  it('Quiz, Lerncoach, Diagramm-Figuren und Uebungen: Neustart aktiviert alle vier ueber den normalen Importpfad', async () => {
    const first = mountApp()
    await settled(first)
    await chooseFiles(first, [fileOf(quizData(), 'quiz.json'), fileOf(coachLibraryData(), 'coach.json'), fileOf(figureData(), 'figuren.json')])
    expect((await storedSnapshot()).keys).toEqual(['coach@1', 'figures@1', 'quiz:test-area@1'])

    const second = await restart(first)
    expect(activeAreas(second)).toEqual(['test-area'])
    expect(navigator(second).props('coachEntry')).not.toBeNull()
    expect(second.vm.figureRegistry.entry.library.figures).toHaveLength(2)
    expect(second.findAll('[data-stored-status]').map((node) => node.text())).toEqual(Array(3).fill('✓ In dieser Sitzung einsatzbereit – Version 1'))
    expect(second.find('[aria-label="Importbericht"]').exists()).toBe(false)
  })
})
