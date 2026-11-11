// Auftrag 095 (MINOR): Tastaturfokus im Loeschdialog. Die App wird in document.body eingehaengt, damit
// document.activeElement aussagekraeftig ist. Alle Inhalte sind kuenstliche Demo-Daten.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import FDBObjectStore from 'fake-indexeddb/lib/FDBObjectStore'
import App from '../../App.vue'
import { createPrivateLibraryStore } from '../../utils/privateLibraryStore.js'
import { fileOf, freshEnvironment, quizData } from '../../utils/__tests__/privateStorageTestHelpers.js'
import { makeTab, storedSnapshot } from '../../utils/__tests__/privateTabHelpers.js'

const mounted = []
const otherTabs = []

function mountApp() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const wrapper = shallowMount(App, { attachTo: host, global: { stubs: { PrivateContentImporter: false } } })
  mounted.push({ wrapper, host })
  return wrapper
}

const panel = (wrapper) => wrapper.get('[data-stored-libraries]')
const active = () => document.activeElement

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

// Fokussiert den Entfernen-Button (wie ein Tastaturnutzer) und loest ihn aus.
async function pressRemove(wrapper, selector = '[data-stored-remove]') {
  const button = wrapper.get(selector)
  button.element.focus()
  expect(active()).toBe(button.element)
  await button.trigger('click')
  return button.element
}

async function waitForDialog(wrapper) {
  await vi.waitFor(async () => {
    await flushPromises()
    expect(wrapper.find('[data-stored-remove-confirm]').exists()).toBe(true)
  }, { timeout: 3000 })
}

beforeEach(freshEnvironment)
afterEach(() => {
  vi.restoreAllMocks()
  while (mounted.length) {
    const { wrapper, host } = mounted.pop()
    wrapper.unmount()
    host.remove()
  }
  while (otherTabs.length) otherTabs.pop().close()
})

describe('Fokus im Loeschdialog', () => {
  it('nach dem Oeffnen der Rueckfrage liegt der Fokus auf "Abbrechen" (nicht verloren, nicht auf <body>)', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    await pressRemove(wrapper)
    await waitForDialog(wrapper)
    await vi.waitFor(() => expect(active()).toBe(wrapper.get('[data-stored-remove-cancel]').element))
    expect(active()).not.toBe(document.body)
    expect(wrapper.get('.stored-confirm-text').attributes('role')).toBe('alert') // Semantik bleibt
  })

  it('Abbrechen gibt den Fokus an den urspruenglichen Entfernen-Button zurueck und aendert nichts', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    await pressRemove(wrapper)
    await waitForDialog(wrapper)
    await wrapper.get('[data-stored-remove-cancel]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-stored-remove-confirm]').exists()).toBe(false)
    expect(active()).toBe(wrapper.get('[data-stored-remove]').element)
    expect((await storedSnapshot()).keys).toEqual(['quiz:test-area@1'])
  })

  it('nach erfolgreichem Loeschen liegt der Fokus auf einem noch vorhandenen Element ("Neu pruefen"), nicht auf <body>', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    await pressRemove(wrapper)
    await waitForDialog(wrapper)
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect((await storedSnapshot()).records).toEqual([])
      expect(active()).toBe(wrapper.get('[data-stored-check]').element)
    }, { timeout: 3000 })
    expect(active()).not.toBe(document.body)
    expect(wrapper.get('[data-stored-notice]').element.closest('[role="status"]')).not.toBeNull()
  })

  it('bei einem Fehler beim Entfernen kehrt der Fokus zum Entfernen-Button zurueck (keine Fokusfalle), Fehler als role="alert"', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    await pressRemove(wrapper)
    await waitForDialog(wrapper)
    vi.spyOn(FDBObjectStore.prototype, 'delete').mockImplementation(() => {
      throw new DOMException('boom', 'UnknownError')
    })
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(wrapper.find('[data-stored-notice]').exists()).toBe(true)
    }, { timeout: 3000 })
    vi.restoreAllMocks()
    expect(wrapper.get('[data-stored-notice]').attributes('role')).toBe('alert')
    expect(active()).toBe(wrapper.get('[data-stored-remove]').element)
    expect(wrapper.find('[data-stored-remove-confirm]').exists()).toBe(false)
  })

  it('beschaedigter Eintrag: derselbe Fokusablauf (Rueckfrage -> Abbrechen -> zurueck -> Bestaetigen)', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'a.json')])
    const store = createPrivateLibraryStore()
    const [record] = (await store.list()).records
    const bytes = new TextEncoder().encode('{"manipuliert":true}').buffer
    await store.forcePut({ ...record, bytes, size: bytes.byteLength })
    store.close()
    await wrapper.get('[data-stored-check]').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('[data-stored-invalid]').exists()).toBe(true), { timeout: 3000 })

    await pressRemove(wrapper, '[data-stored-invalid] [data-stored-remove]')
    await waitForDialog(wrapper)
    await vi.waitFor(() => expect(active()).toBe(wrapper.get('[data-stored-remove-cancel]').element))
    await wrapper.get('[data-stored-remove-cancel]').trigger('click')
    await flushPromises()
    expect(active()).toBe(wrapper.get('[data-stored-invalid] [data-stored-remove]').element)

    await pressRemove(wrapper, '[data-stored-invalid] [data-stored-remove]')
    await waitForDialog(wrapper)
    await wrapper.get('[data-stored-remove-confirm]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect((await storedSnapshot()).records).toEqual([])
    }, { timeout: 3000 })
    await vi.waitFor(() => expect(active()).not.toBe(document.body))
  })

  it('wurde der Datensatz in der Zwischenzeit veraendert (keine Rueckfrage), bleibt der Fokus auf dem Entfernen-Button', async () => {
    const wrapper = mountApp()
    await settled(wrapper)
    await chooseFiles(wrapper, [fileOf(quizData(), 'v1.json')])
    const tab = makeTab()
    otherTabs.push(tab)
    await tab.importFiles([fileOf(quizData({ libraryVersion: 2 }), 'v2.json')]) // Anzeige zeigt noch Version 1
    const pressed = await pressRemove(wrapper)
    await vi.waitFor(async () => {
      await flushPromises()
      expect(wrapper.find('[data-stored-notice]').exists()).toBe(true)
    }, { timeout: 3000 })
    expect(wrapper.find('[data-stored-remove-confirm]').exists()).toBe(false)
    expect(active()).not.toBe(document.body)
    expect(panel(wrapper).find('[data-stored-remove]').exists()).toBe(true)
    expect([pressed, wrapper.get('[data-stored-remove]').element]).toContain(active())
  })
})
