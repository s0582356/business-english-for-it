import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeAudio, createFakePack, createTestController } from './audioTestHelpers.js'

// Object-URL-Lebenszyklus: jede erzeugte URL wird exakt einmal freigegeben, sobald sie nicht
// mehr gebraucht wird - und die aktuell spielende URL geht nie verloren.
let created
let revoked

function trackUrls() {
  created = []
  revoked = []
  let counter = 0
  URL.createObjectURL = vi.fn(() => { const url = `blob:track/${++counter}`; created.push(url); return url })
  URL.revokeObjectURL = vi.fn((url) => { revoked.push(url) })
}

const bytes = (n) => new Uint8Array([n, n + 1, n + 2])
const packWith = (names, fileName) => createFakePack(Object.fromEntries(names.map((name, index) => [name, bytes(index)])), { fileName })
const duplicates = (list) => list.filter((url, index) => list.indexOf(url) !== index)
const leaked = () => created.filter((url) => !revoked.includes(url))

beforeEach(() => {
  window.localStorage.clear()
  trackUrls()
})

describe('Object-URL-Cleanup im Audio-Controller', () => {
  it('Leak-Reproduktion: die gerade verwendete URL wird bei dispose() freigegeben (1 erzeugt -> 1 freigegeben)', async () => {
    const { controller, audioElement } = createTestController({ autoPlay: false })
    controller.setPack(packWith(['a__x__q__00000001.mp3'], 'p1.zip'))
    await controller.playFile('a__x__q__00000001.mp3')
    expect(audioElement.realPlays).toHaveLength(1)
    expect(created).toHaveLength(1)

    controller.dispose()
    expect(revoked).toEqual(created)
    expect(leaked()).toEqual([])
  })

  it('Packwechsel gibt alle URLs des alten Packs frei (auch die spielende), neue Wiedergabe funktioniert', async () => {
    const { controller, audioElement } = createTestController({ autoPlay: false })
    controller.setPack(packWith(['a__x__q__00000001.mp3', 'a__x__s__00000002.mp3'], 'old.zip'))
    await controller.prepare({ q: 'a__x__q__00000001.mp3', s: 'a__x__s__00000002.mp3' })
    await controller.playFile('a__x__q__00000001.mp3')
    expect(created).toHaveLength(2)
    const oldUrls = [...created]

    controller.setPack(packWith(['b__y__q__00000003.mp3'], 'new.zip'))
    expect([...revoked].sort()).toEqual(oldUrls.sort())
    expect(duplicates(revoked)).toEqual([])

    await controller.playFile('b__y__q__00000003.mp3')
    expect(audioElement.realPlays.at(-1)).toBe(created.at(-1))
    expect(revoked).not.toContain(created.at(-1)) // aktuelle URL des neuen Packs bleibt gueltig
    controller.dispose()
    expect(leaked()).toEqual([])
    expect(duplicates(revoked)).toEqual([])
  })

  it('Replay und erneutes Vorbereiten erzeugen keine neue URL und geben die aktuelle nicht frei', async () => {
    const { controller, audioElement } = createTestController({ autoPlay: false })
    controller.setPack(packWith(['a__x__q__00000001.mp3'], 'p.zip'))
    await controller.playFile('a__x__q__00000001.mp3')
    await controller.playFile('a__x__q__00000001.mp3')
    await controller.prepare({ q: 'a__x__q__00000001.mp3' })
    expect(audioElement.realPlays).toHaveLength(2)
    expect(created).toHaveLength(1)
    expect(revoked).toEqual([])
  })

  it('Cache-Verdraengung gibt aeltere URLs genau einmal frei, die spielende URL bleibt gueltig und wird danach freigegeben', async () => {
    const { controller, audioElement } = createTestController({ autoPlay: false })
    const names = Array.from({ length: 10 }, (_v, index) => `a__item${index}__q__0000000${index}.mp3`)
    controller.setPack(packWith(names, 'big.zip'))
    await controller.playFile(names[0]) // spielt, ist dann das aelteste Cache-Element
    for (const name of names.slice(1)) await controller.prepare({ q: name }) // Cache laeuft ueber das Limit
    expect(created).toHaveLength(10)
    expect(revoked).not.toContain(audioElement.src) // die spielende URL wurde nicht unter dem Player weggezogen
    expect(duplicates(revoked)).toEqual([])

    await controller.playFile(names[9]) // Wechsel: die zurueckgestellte URL wird jetzt freigegeben
    expect(revoked).toContain(created[0])
    controller.dispose()
    expect(leaked()).toEqual([])
    expect(duplicates(revoked)).toEqual([])
  })

  it('Stop, Itemwechsel und Unmount (stop(owner)) geben gecachte URLs nicht vorzeitig frei', async () => {
    const { controller } = createTestController({ autoPlay: false })
    const owner = Symbol('card')
    controller.setPack(packWith(['a__x__q__00000001.mp3'], 'p.zip'))
    await controller.playFile('a__x__q__00000001.mp3', { owner })
    controller.stop(owner)
    controller.stop()
    expect(revoked).toEqual([]) // Replay muss moeglich bleiben
    await controller.playFile('a__x__q__00000001.mp3')
    expect(created).toHaveLength(1)
    controller.dispose()
    controller.dispose() // zweites dispose darf nichts doppelt freigeben
    expect(revoked).toEqual(created)
  })

  it('stale async: ein nach dispose()/Packwechsel eintreffendes Blob erzeugt keine unfreigegebene URL', async () => {
    const { controller } = createTestController({ autoPlay: false })
    let release
    const slow = createFakePack({ 'a__x__q__00000001.mp3': bytes(1) })
    const originalGetBlob = slow.getBlob
    slow.getBlob = (name) => new Promise((resolve) => { release = () => resolve(originalGetBlob(name)) })
    controller.setPack(slow)
    const pending = controller.prepare({ q: 'a__x__q__00000001.mp3' })
    await Promise.resolve()

    controller.dispose()
    release()
    await pending
    expect(leaked()).toEqual([])
    expect(duplicates(revoked)).toEqual([])

    // gleiches Szenario mit Packwechsel statt dispose
    trackUrls()
    const { controller: second } = createTestController({ autoPlay: false })
    let release2
    const slow2 = createFakePack({ 'a__x__q__00000001.mp3': bytes(1) })
    const getBlob2 = slow2.getBlob
    slow2.getBlob = (name) => new Promise((resolve) => { release2 = () => resolve(getBlob2(name)) })
    second.setPack(slow2)
    const pending2 = second.prepare({ q: 'a__x__q__00000001.mp3' })
    await Promise.resolve()
    second.setPack(packWith(['b__y__q__00000002.mp3'], 'next.zip'))
    release2()
    await pending2
    second.dispose()
    expect(leaked()).toEqual([])
    expect(duplicates(revoked)).toEqual([])
  })

  it('defekte, gerade spielende Datei wird freigegeben (einmal), ohne das neue Audio zu stoeren', async () => {
    const { controller, audioElement } = createTestController({ autoPlay: false })
    controller.setPack(packWith(['a__x__q__00000001.mp3', 'a__x__s__00000002.mp3'], 'p.zip'))
    await controller.prepare({ q: 'a__x__q__00000001.mp3', s: 'a__x__s__00000002.mp3' })
    audioElement.failSources.add(created[0])
    await controller.playFile('a__x__q__00000001.mp3') // nicht dekodierbar -> als defekt markiert
    await controller.playFile('a__x__s__00000002.mp3')
    expect(audioElement.realPlays.at(-1)).toBe(created[1])
    controller.dispose()
    expect(leaked()).toEqual([])
    expect(duplicates(revoked)).toEqual([])
  })

  it('FakeAudio-Sanity: ohne Wiedergabe wird nichts erzeugt oder freigegeben', () => {
    const { controller } = createTestController()
    controller.dispose()
    expect(created).toEqual([])
    expect(revoked).toEqual([])
    expect(new FakeAudio().realPlays).toEqual([])
  })
})
