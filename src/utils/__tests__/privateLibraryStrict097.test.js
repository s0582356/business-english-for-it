// Auftrag 097: Arrays mit eigenen Zusatzeigenschaften und Views mit groesserem Puffer beim bestaetigten Entfernen.
// Alle Daten sind synthetisch. Die "realen" Tests schreiben tatsaechlich in IndexedDB (fake-indexeddb) und lesen
// den Wert erneut aus (Structured Clone), bevor verglichen wird.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REMOVE_OUTCOME, createPrivateLibraryStore } from '../privateLibraryStore.js'
import { UnsupportedValueError, strictClone, strictEqual } from '../strictValue.js'
import { freshEnvironment } from './privateStorageTestHelpers.js'
import { storedSnapshot } from './privateTabHelpers.js'

const eq = (a, b) => strictEqual(a, b)
const buf = (...numbers) => new Uint8Array(numbers).buffer
const withExtra = (array, extra) => Object.assign(array, { extra })

describe('A. Arrays mit zusaetzlichen eigenen Eigenschaften (strictValue)', () => {
  it('extra geaendert / hinzugefuegt / entfernt', () => {
    expect(eq(withExtra([1, 2], 'old'), withExtra([1, 2], 'old'))).toBe(true)
    expect(eq(withExtra([1, 2], 'old'), withExtra([1, 2], 'new'))).toBe(false)
    expect(eq(withExtra([1, 2], 'old'), [1, 2])).toBe(false) // entfernt
    expect(eq([1, 2], withExtra([1, 2], 'old'))).toBe(false) // hinzugefuegt
    expect(eq(withExtra([1, 2], 'old'), Object.assign([1, 2], { other: 'old' }))).toBe(false) // anderer Name
  })

  it('vorhandenes undefined gegen fehlende Eigenschaft ist ein Unterschied (Objekt und Array)', () => {
    expect(eq(withExtra([1, 2], undefined), [1, 2])).toBe(false)
    expect(eq([1, 2], withExtra([1, 2], undefined))).toBe(false)
    expect(eq(withExtra([1, 2], undefined), withExtra([1, 2], undefined))).toBe(true)
    expect(eq({ a: undefined }, {})).toBe(false)
  })

  it('sparse Array gegen regulaeres Array und gegen anderes sparse Array', () => {
    const sparse = [1, , 3] // eslint-disable-line no-sparse-arrays
    expect(eq(sparse, [1, undefined, 3])).toBe(false)
    expect(eq([1, undefined, 3], sparse)).toBe(false)
    expect(eq(sparse, [1, , 3])).toBe(true) // eslint-disable-line no-sparse-arrays
    expect(eq(sparse, [1, 2, 3])).toBe(false)
    expect(eq([, 2], [2, ,])).toBe(false) // eslint-disable-line no-sparse-arrays
    expect(eq(new Array(5), new Array(6))).toBe(false) // gleiche (leere) Schluessel, andere Laenge
    expect(eq(new Array(5), new Array(5))).toBe(true)
  })

  it('Zusatzeigenschaft mit Struktur: Aenderung tief im Zusatzwert wird erkannt', () => {
    const make = (deep) => withExtra([1], { nested: [{ deep }] })
    expect(eq(make('a'), make('a'))).toBe(true)
    expect(eq(make('a'), make('b'))).toBe(false)
  })

  it('verschachtelt: Array mit Zusatzfeld innerhalb eines Objekts innerhalb eines Arrays', () => {
    const make = (extra) => ({ list: [{ inner: withExtra([1, 2], extra) }] })
    expect(eq(make('old'), make('old'))).toBe(true)
    expect(eq(make('old'), make('new'))).toBe(false)
  })

  it('Kopie: behaelt Zusatzfelder, Laenge und Luecken und ist unabhaengig vom Original', () => {
    const original = withExtra([1, , 3], { tag: 'old' }) // eslint-disable-line no-sparse-arrays
    const copy = strictClone(original)
    expect(eq(original, copy)).toBe(true)
    expect(copy.extra).toEqual({ tag: 'old' })
    expect(copy.extra).not.toBe(original.extra)
    expect(copy.length).toBe(3)
    expect(1 in copy).toBe(false) // Luecke bleibt Luecke
    original.extra.tag = 'new'
    original[0] = 9
    expect(copy.extra.tag).toBe('old')
    expect(copy[0]).toBe(1)
    expect(eq(original, copy)).toBe(false)
  })

  it('Accessor-Eigenschaften (get/set) auf Arrays und Objekten sind nicht sicher vergleichbar', () => {
    const array = [1]
    Object.defineProperty(array, 'extra', { get: () => 'x', enumerable: true, configurable: true })
    expect(() => strictClone(array)).toThrow(UnsupportedValueError)
    expect(() => strictEqual(array, array)).toThrow(UnsupportedValueError)
    const object = {}
    Object.defineProperty(object, 'x', { get: () => 1, enumerable: true, configurable: true })
    expect(() => strictClone(object)).toThrow(UnsupportedValueError)
  })

  it('Array-Unterklassen werden nicht als normales Array behandelt (nicht sicher vergleichbar)', () => {
    class Liste extends Array {}
    expect(() => strictClone(Liste.from([1]))).toThrow(UnsupportedValueError)
  })
})

describe('B. Views und Binaerdaten: gesamter Puffer zaehlt (strictValue)', () => {
  const view = (bytes, offset, length) => new DataView(buf(...bytes), offset, length)

  it('ORIGINAL-REPRODUKTION: DataView(Offset 1, Laenge 2) bleibt [1,2], Puffer aendert sich [10,1,2,20] -> [99,1,2,88]', () => {
    const before = view([10, 1, 2, 20], 1, 2)
    const after = view([99, 1, 2, 88], 1, 2)
    expect([before.getUint8(0), before.getUint8(1)]).toEqual([after.getUint8(0), after.getUint8(1)]) // sichtbar identisch
    expect(eq(before, after)).toBe(false)
    expect(eq(before, view([10, 1, 2, 20], 1, 2))).toBe(true)
  })

  it('unsichtbare Pufferbytes veraendert / sichtbare Pufferbytes veraendert', () => {
    const base = () => new Uint8Array(buf(10, 1, 2, 20), 1, 2)
    expect(eq(base(), new Uint8Array(buf(10, 1, 2, 21), 1, 2))).toBe(false) // hinten (unsichtbar)
    expect(eq(base(), new Uint8Array(buf(11, 1, 2, 20), 1, 2))).toBe(false) // vorn (unsichtbar)
    expect(eq(base(), new Uint8Array(buf(10, 1, 3, 20), 1, 2))).toBe(false) // sichtbar
  })

  it('gleiche sichtbare Bytes, anderer byteOffset', () => {
    expect(eq(new Uint8Array(buf(1, 2, 0, 0), 0, 2), new Uint8Array(buf(0, 1, 2, 0), 1, 2))).toBe(false)
    expect(eq(new Uint8Array(buf(1, 2, 1, 2), 0, 2), new Uint8Array(buf(1, 2, 1, 2), 2, 2))).toBe(false) // identische Gesamtpuffer, anderer Offset
  })

  it('gleiche sichtbare Bytes, andere Pufferlaenge', () => {
    expect(eq(new Uint8Array(buf(10, 1, 2, 20), 1, 2), new Uint8Array(buf(10, 1, 2), 1, 2))).toBe(false)
    expect(eq(new DataView(buf(10, 1, 2, 20), 1, 2), new DataView(buf(10, 1, 2, 20, 30), 1, 2))).toBe(false)
  })

  it('DataView gegen TypedArray (gleicher Ausschnitt, gleicher Puffer) und verschiedene TypedArray-Typen', () => {
    const buffer = buf(10, 1, 2, 20)
    expect(eq(new DataView(buffer, 1, 2), new Uint8Array(buffer, 1, 2))).toBe(false)
    expect(eq(new Uint8Array(buffer, 0, 4), new Int8Array(buf(10, 1, 2, 20), 0, 4))).toBe(false)
    expect(eq(new Uint16Array(buf(1, 0, 2, 0), 0, 2), new Uint8Array(buf(1, 0, 2, 0), 0, 4))).toBe(false)
  })

  it('TypedArray: andere Elementanzahl bei gleichem Puffer und Offset', () => {
    const buffer = () => buf(1, 2, 3, 4, 5, 6)
    expect(eq(new Uint8Array(buffer(), 0, 4), new Uint8Array(buffer(), 0, 5))).toBe(false)
    expect(eq(new Uint8Array(buffer(), 0, 4), new Uint8Array(buffer(), 0, 4))).toBe(true)
  })

  it('identischer View einschliesslich vollstaendigem Puffer ist gleich', () => {
    expect(eq(new DataView(buf(10, 1, 2, 20), 1, 2), new DataView(buf(10, 1, 2, 20), 1, 2))).toBe(true)
    expect(eq(new Float32Array(new Float32Array([1, 2, 3, 4]).buffer, 4, 2), new Float32Array(new Float32Array([1, 2, 3, 4]).buffer, 4, 2))).toBe(true)
  })

  it('derselbe Schutz gilt bei verschachtelten Werten (Objekt, Array, Array-Zusatzfeld)', () => {
    const make = (bytes) => ({ outer: [{ data: new Uint8Array(buf(...bytes), 1, 2) }], extra: undefined })
    expect(eq(make([10, 1, 2, 20]), make([10, 1, 2, 20]))).toBe(true)
    expect(eq(make([10, 1, 2, 20]), make([99, 1, 2, 88]))).toBe(false)
    const onArray = (bytes) => withExtra([0], new Uint8Array(buf(...bytes), 1, 2))
    expect(eq(onArray([10, 1, 2, 20]), onArray([10, 1, 2, 20]))).toBe(true)
    expect(eq(onArray([10, 1, 2, 20]), onArray([10, 1, 2, 21]))).toBe(false)
  })

  it('Kopie erhaelt Typ, Offset, Laenge und den ganzen Puffer; sie ist unabhaengig vom Original', () => {
    const original = new Uint8Array(buf(10, 1, 2, 20), 1, 2)
    const copy = strictClone(original)
    expect(Object.prototype.toString.call(copy)).toBe('[object Uint8Array]')
    expect([copy.byteOffset, copy.length, copy.buffer.byteLength]).toEqual([1, 2, 4])
    expect([...new Uint8Array(copy.buffer)]).toEqual([10, 1, 2, 20])
    expect(copy.buffer).not.toBe(original.buffer)
    new Uint8Array(original.buffer)[3] = 77
    expect([...new Uint8Array(copy.buffer)]).toEqual([10, 1, 2, 20])
    expect(eq(original, copy)).toBe(false)
    const dv = strictClone(new DataView(buf(10, 1, 2, 20), 1, 2))
    expect([dv.byteOffset, dv.byteLength, dv.buffer.byteLength]).toEqual([1, 2, 4])
  })

  it('Verweisstruktur: zwei Views auf einen gemeinsamen Puffer gegen zwei getrennte Puffer gleichen Inhalts -> ungleich', () => {
    const shared = buf(1, 2, 3, 4)
    const aliased = { a: new Uint8Array(shared, 0, 2), b: new Uint8Array(shared, 2, 2) }
    const separate = { a: new Uint8Array(buf(1, 2, 3, 4), 0, 2), b: new Uint8Array(buf(1, 2, 3, 4), 2, 2) }
    expect(eq(aliased, separate)).toBe(false)
    expect(eq(separate, aliased)).toBe(false)
    const sharedAgain = { a: new Uint8Array(buf(1, 2, 3, 4)), b: null }
    sharedAgain.b = new Uint8Array(sharedAgain.a.buffer, 2, 2)
    expect(eq(aliased, { a: new Uint8Array(sharedAgain.a.buffer, 0, 2), b: sharedAgain.b })).toBe(true)
    // die Kopie bewahrt die Verweisstruktur (ein Puffer, nicht zwei)
    const copy = strictClone(aliased)
    expect(copy.a.buffer).toBe(copy.b.buffer)
    expect(eq(aliased, copy)).toBe(true)
  })

  it('Verweisstruktur: gemeinsam referenziertes Objekt gegen zwei gleiche Objekte -> ungleich', () => {
    const shared = { n: 1 }
    expect(eq({ a: shared, b: shared }, { a: { n: 1 }, b: { n: 1 } })).toBe(false)
    expect(eq({ a: shared, b: shared }, { a: shared, b: shared })).toBe(true)
  })

  it('nicht sicher vergleichbare Puffer werden abgewiesen (SharedArrayBuffer, in der Groesse veraenderbar)', () => {
    if (typeof SharedArrayBuffer === 'function') {
      const shared = new Uint8Array(new SharedArrayBuffer(4))
      expect(() => strictClone(shared)).toThrow(UnsupportedValueError)
      expect(() => strictEqual(shared, shared)).toThrow(UnsupportedValueError)
    }
    let resizable = null
    try {
      resizable = new ArrayBuffer(4, { maxByteLength: 8 })
    } catch {
      resizable = null
    }
    if (resizable) {
      expect(() => strictClone(new Uint8Array(resizable))).toThrow(UnsupportedValueError)
      expect(() => strictEqual(resizable, resizable)).toThrow(UnsupportedValueError)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('C. Reale Persistenz: in IndexedDB gespeicherte und erneut gelesene Werte', () => {
  const stores = []
  const newStore = () => {
    const store = createPrivateLibraryStore()
    stores.push(store)
    return store
  }

  async function rawPut(value) {
    const db = await new Promise((done, fail) => {
      const request = indexedDB.open('businessEnglishPrivateLibraries', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('libraries', { keyPath: 'key' })
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    await new Promise((done, fail) => {
      const tx = db.transaction('libraries', 'readwrite')
      tx.objectStore('libraries').put(value)
      tx.oncomplete = done
      tx.onerror = () => fail(tx.error)
    })
    db.close()
  }

  async function rawGet(key) {
    const db = await new Promise((done, fail) => {
      const request = indexedDB.open('businessEnglishPrivateLibraries', 1)
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    const value = await new Promise((done, fail) => {
      const request = db.transaction('libraries').objectStore('libraries').get(key)
      request.onsuccess = () => done(request.result)
      request.onerror = () => fail(request.error)
    })
    db.close()
    return value
  }

  beforeEach(freshEnvironment)
  afterEach(() => stores.splice(0).forEach((store) => store.close()))

  it('CODEX-REPRODUKTION A: Array [1,2] mit extra "old" -> nur extra "new": changed, nicht geloescht', async () => {
    const store = newStore()
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), list: withExtra([1, 2], 'old') })
    const stored = await rawGet('coach')
    expect(stored.list.extra).toBe('old') // IndexedDB hat die Zusatzeigenschaft tatsaechlich mitgespeichert
    const confirmed = await store.readSnapshot('coach')
    expect(confirmed.value.list.extra).toBe('old')

    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), list: withExtra([1, 2], 'new') })
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect((await storedSnapshot()).corrupt.map((entry) => entry.key)).toEqual(['coach'])
    expect((await rawGet('coach')).list.extra).toBe('new')
  })

  it.each([
    ['extra hinzugefuegt', [1, 2], withExtra([1, 2], 'x')],
    ['extra entfernt', withExtra([1, 2], 'x'), [1, 2]],
    ['extra von undefined auf fehlend', withExtra([1, 2], undefined), [1, 2]],
    ['sparse gegen regulaer', [1, , 3], [1, undefined, 3]], // eslint-disable-line no-sparse-arrays
  ])('Array: %s -> changed', async (_label, before, after) => {
    const store = newStore()
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), list: before })
    const confirmed = await store.readSnapshot('coach')
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), list: after })
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect((await storedSnapshot()).corrupt).toHaveLength(1)
  })

  it('unveraendertes Array mit Zusatzfeld: Loeschung nach Bestaetigung moeglich', async () => {
    const store = newStore()
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), list: withExtra([1, 2], 'old') })
    const confirmed = await store.readSnapshot('coach')
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), list: withExtra([1, 2], 'old') }) // neu geschrieben, gleich
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.REMOVED)
    expect((await storedSnapshot()).corrupt).toEqual([])
  })

  it('CODEX-REPRODUKTION B: DataView(Offset 1, Laenge 2), Puffer [10,1,2,20] -> [99,1,2,88]: changed, nicht geloescht', async () => {
    const store = newStore()
    await rawPut({ key: 'coach', savedAt: 5, bytes: new DataView(buf(10, 1, 2, 20), 1, 2) })
    const stored = await rawGet('coach')
    // IndexedDB hat Offset, Laenge UND den ganzen Puffer abgelegt
    expect([stored.bytes.byteOffset, stored.bytes.byteLength, stored.bytes.buffer.byteLength]).toEqual([1, 2, 4])
    const confirmed = await store.readSnapshot('coach')

    await rawPut({ key: 'coach', savedAt: 5, bytes: new DataView(buf(99, 1, 2, 88), 1, 2) })
    const after = await rawGet('coach')
    expect([after.bytes.getUint8(0), after.bytes.getUint8(1)]).toEqual([1, 2]) // sichtbarer Ausschnitt unveraendert
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect([...new Uint8Array((await rawGet('coach')).bytes.buffer)]).toEqual([99, 1, 2, 88]) // Datensatz bleibt
  })

  it.each([
    ['unsichtbare Pufferbytes', new Uint8Array(buf(10, 1, 2, 21), 1, 2)],
    ['sichtbare Pufferbytes', new Uint8Array(buf(10, 1, 3, 20), 1, 2)],
    ['anderer byteOffset, gleiche sichtbare Bytes', new Uint8Array(buf(1, 2, 0, 0), 0, 2)],
    ['andere Pufferlaenge, gleiche sichtbare Bytes', new Uint8Array(buf(10, 1, 2), 1, 2)],
    ['DataView statt Uint8Array', new DataView(buf(10, 1, 2, 20), 1, 2)],
  ])('Uint8Array(Puffer [10,1,2,20], Offset 1, Laenge 2): %s -> changed', async (_label, replacement) => {
    const store = newStore()
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array(buf(10, 1, 2, 20), 1, 2) })
    const confirmed = await store.readSnapshot('coach')
    await rawPut({ key: 'coach', savedAt: 5, bytes: replacement })
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    expect((await storedSnapshot()).corrupt).toHaveLength(1)
  })

  it('identischer View einschliesslich vollstaendigem Puffer: Loeschung erlaubt', async () => {
    const store = newStore()
    await rawPut({ key: 'coach', savedAt: 5, bytes: new DataView(buf(10, 1, 2, 20), 1, 2) })
    const confirmed = await store.readSnapshot('coach')
    await rawPut({ key: 'coach', savedAt: 5, bytes: new DataView(buf(10, 1, 2, 20), 1, 2) })
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.REMOVED)
    expect((await storedSnapshot()).corrupt).toEqual([])
  })

  it('verschachtelt: View in Objekt in Array mit Zusatzfeld - jede Aenderung wird erkannt, Gleichheit erlaubt Loeschen', async () => {
    const make = (bytes, extra) => ({ key: 'coach', savedAt: 5, bytes: null, tree: withExtra([{ data: new Uint8Array(buf(...bytes), 1, 2) }], extra) })
    const store = newStore()
    await rawPut(make([10, 1, 2, 20], 'old'))
    const confirmed = await store.readSnapshot('coach')
    await rawPut(make([10, 1, 2, 21], 'old'))
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    await rawPut(make([10, 1, 2, 20], 'new'))
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.CHANGED)
    await rawPut(make([10, 1, 2, 20], 'old'))
    expect((await store.removeIfUnchanged('coach', confirmed)).outcome).toBe(REMOVE_OUTCOME.REMOVED)
  })

  it('nicht vergleichbarer Wert (Accessor kann in IndexedDB nicht vorkommen; Map kann): niemals geloescht', async () => {
    const store = newStore()
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), list: [1] })
    const confirmed = await store.readSnapshot('coach')
    await rawPut({ key: 'coach', savedAt: 5, bytes: new Uint8Array([1]), list: new Map([[1, 2]]) })
    const result = await store.removeIfUnchanged('coach', confirmed).catch((error) => error)
    expect(result.outcome).not.toBe(REMOVE_OUTCOME.REMOVED)
    expect((await storedSnapshot()).corrupt).toHaveLength(1)
  })

  it('Atomaritaet unveraendert: Loeschung und Ersetzung ueber zwei Verbindungen gleichzeitig -> neuer Stand ueberlebt', async () => {
    for (const order of ['delete-first', 'replace-first']) {
      const one = newStore()
      const two = newStore()
      await rawPut({ key: 'coach', savedAt: 5, bytes: new DataView(buf(10, 1, 2, 20), 1, 2) })
      const confirmed = await one.readSnapshot('coach')
      const replace = () => rawPut({ key: 'coach', savedAt: 5, bytes: new DataView(buf(99, 1, 2, 88), 1, 2) })
      const removal = () => two.removeIfUnchanged('coach', confirmed)
      await Promise.all(order === 'delete-first' ? [removal(), replace()] : [replace(), removal()])
      const left = await rawGet('coach')
      // Entweder zuerst geloescht und danach neu geschrieben, oder die Loeschung wurde abgewiesen: der neue Stand bleibt
      expect([...new Uint8Array(left.bytes.buffer)]).toEqual([99, 1, 2, 88])
      const cleanup = await one.readSnapshot('coach')
      await one.removeIfUnchanged('coach', cleanup)
    }
  })
})
