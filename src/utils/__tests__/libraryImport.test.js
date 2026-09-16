import { beforeEach, describe, expect, it } from 'vitest'
import {
  classifyIncomingLibrary,
  flattenLibraryItems,
  importLibraryFiles,
  validateLibrary,
} from '../libraryImport.js'

function makeChoiceItem(itemId) {
  return {
    itemId,
    type: 'choice',
    intent: 'telephone-opening',
    prompt: `Prompt for ${itemId}`,
    options: ['A', 'B'],
    correctAnswer: 'A',
    explanation: 'Because A.',
  }
}

function makeOrderedItem(itemId) {
  return {
    itemId,
    type: 'ordered',
    intent: 'dialog-reconstruction',
    prompt: `Order for ${itemId}`,
    steps: [
      { id: 'x', label: 'First' },
      { id: 'y', label: 'Second' },
    ],
    correctOrder: ['x', 'y'],
  }
}

function makeValidLibrary(overrides = {}) {
  return {
    type: 'businessEnglishLibrary',
    schemaVersion: 1,
    libraryId: 'business-english-telephoning-v1',
    libraryVersion: 1,
    areaId: 'telephoning',
    areaTitle: 'Business Telephoning',
    lessons: [
      {
        lessonId: 'telephoning-l1',
        lessonTitle: 'Lesson 1',
        scenarios: [
          {
            scenarioId: 'telephoning-l1-s1',
            scenarioTitle: 'Scenario 1',
            items: [makeChoiceItem('tel-001'), makeOrderedItem('tel-002')],
          },
        ],
      },
    ],
    ...overrides,
  }
}

function fakeFile(name, textContent) {
  return {
    name,
    text: async () => textContent,
    arrayBuffer: async () => new TextEncoder().encode(textContent).buffer,
  }
}

describe('validateLibrary - Schema', () => {
  it('akzeptiert eine gültige Lernbibliothek und leitet Hierarchie-Felder an Items ab', () => {
    const library = validateLibrary(makeValidLibrary())
    expect(library.areaId).toBe('telephoning')
    const items = flattenLibraryItems(library)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'tel-001',
      itemId: 'tel-001',
      areaId: 'telephoning',
      lessonId: 'telephoning-l1',
      scenarioId: 'telephoning-l1-s1',
    })
  })

  it('lehnt eine Datei ohne den Selbstbeschreibungs-Marker ab', () => {
    const data = makeValidLibrary()
    delete data.type
    expect(() => validateLibrary(data)).toThrow(/nicht als Business-English-Lernbibliothek erkannt/)
  })

  it('lehnt eine nicht unterstützte schemaVersion ab', () => {
    expect(() => validateLibrary(makeValidLibrary({ schemaVersion: 2 }))).toThrow(/schemaVersion/)
  })

  it('lehnt libraryVersion 0 ab', () => {
    expect(() => validateLibrary(makeValidLibrary({ libraryVersion: 0 }))).toThrow(/libraryVersion/)
  })

  it('lehnt libraryVersion als String ab', () => {
    expect(() => validateLibrary(makeValidLibrary({ libraryVersion: '1' }))).toThrow(/libraryVersion/)
  })

  it('lehnt leere lessons ab', () => {
    expect(() => validateLibrary(makeValidLibrary({ lessons: [] }))).toThrow(/lessons/)
  })

  it('lehnt leere scenarios ab', () => {
    const data = makeValidLibrary()
    data.lessons[0].scenarios = []
    expect(() => validateLibrary(data)).toThrow(/scenarios/)
  })

  it('lehnt leere items ab', () => {
    const data = makeValidLibrary()
    data.lessons[0].scenarios[0].items = []
    expect(() => validateLibrary(data)).toThrow(/items/)
  })

  it('lehnt doppelte itemId innerhalb der Bibliothek ab', () => {
    const data = makeValidLibrary()
    data.lessons[0].scenarios[0].items = [makeChoiceItem('dup'), makeChoiceItem('dup')]
    expect(() => validateLibrary(data)).toThrow(/Doppelte itemId/)
  })

  it('lehnt doppelte lessonId ab', () => {
    const data = makeValidLibrary()
    data.lessons.push({ ...data.lessons[0], scenarios: [{ ...data.lessons[0].scenarios[0], scenarioId: 'other-scenario' }] })
    expect(() => validateLibrary(data)).toThrow(/Doppelte lessonId/)
  })

  it('lehnt doppelte scenarioId über verschiedene Lektionen hinweg ab', () => {
    const data = makeValidLibrary()
    data.lessons.push({
      lessonId: 'telephoning-l2',
      lessonTitle: 'Lesson 2',
      scenarios: [{ ...data.lessons[0].scenarios[0], items: [makeChoiceItem('tel-003')] }],
    })
    expect(() => validateLibrary(data)).toThrow(/Doppelte scenarioId/)
  })

  it('lehnt ein ungültiges Choice-Item über den bestehenden Item-Validator ab', () => {
    const data = makeValidLibrary()
    delete data.lessons[0].scenarios[0].items[0].correctAnswer
    expect(() => validateLibrary(data)).toThrow(/correctAnswer/)
  })

  it('lehnt ein ungültiges Ordered-Item über den bestehenden Item-Validator ab', () => {
    const data = makeValidLibrary()
    data.lessons[0].scenarios[0].items[1].correctOrder = ['x']
    expect(() => validateLibrary(data)).toThrow(/correctOrder/)
  })
})

describe('classifyIncomingLibrary - Konfliktregeln', () => {
  const baseLibrary = { libraryId: 'lib-a', libraryVersion: 1 }

  it('A: identischer Fingerprint -> duplicate', () => {
    const existing = { library: baseLibrary, fingerprint: 'fp1' }
    const incoming = { library: baseLibrary, fingerprint: 'fp1' }
    expect(classifyIncomingLibrary(existing, incoming)).toEqual({ action: 'duplicate' })
  })

  it('B: gleiche libraryId, höhere libraryVersion -> upgrade', () => {
    const existing = { library: { libraryId: 'lib-a', libraryVersion: 1 }, fingerprint: 'fp1' }
    const incoming = { library: { libraryId: 'lib-a', libraryVersion: 2 }, fingerprint: 'fp2' }
    expect(classifyIncomingLibrary(existing, incoming)).toEqual({ action: 'upgrade' })
  })

  it('gleiche libraryId, niedrigere libraryVersion -> ignore-older (kein Downgrade)', () => {
    const existing = { library: { libraryId: 'lib-a', libraryVersion: 2 }, fingerprint: 'fp2' }
    const incoming = { library: { libraryId: 'lib-a', libraryVersion: 1 }, fingerprint: 'fp1' }
    expect(classifyIncomingLibrary(existing, incoming)).toEqual({ action: 'ignore-older' })
  })

  it('C: unterschiedliche libraryId, gleiche areaId -> conflict', () => {
    const existing = { library: { libraryId: 'lib-a', libraryVersion: 1 }, fingerprint: 'fp1' }
    const incoming = { library: { libraryId: 'lib-b', libraryVersion: 1 }, fingerprint: 'fp2' }
    expect(classifyIncomingLibrary(existing, incoming)).toEqual({ action: 'conflict', reason: 'different-library-id' })
  })

  it('D: gleiche libraryId + gleiche libraryVersion, unterschiedlicher Fingerprint -> conflict', () => {
    const existing = { library: { libraryId: 'lib-a', libraryVersion: 1 }, fingerprint: 'fp1' }
    const incoming = { library: { libraryId: 'lib-a', libraryVersion: 1 }, fingerprint: 'fp2' }
    expect(classifyIncomingLibrary(existing, incoming)).toEqual({ action: 'conflict', reason: 'same-version-different-fingerprint' })
  })

  it('kein existierender Eintrag -> load', () => {
    expect(classifyIncomingLibrary(null, { library: baseLibrary, fingerprint: 'fp1' })).toEqual({ action: 'load' })
  })
})

describe('importLibraryFiles - Multi-Datei-Import', () => {
  it('lädt mehrere gültige Bibliotheken für unterschiedliche Bereiche', async () => {
    const libA = makeValidLibrary()
    const libB = makeValidLibrary({ areaId: 'email-writing', areaTitle: 'Business Email Writing', libraryId: 'business-english-email-v1' })
    const files = [fakeFile('a.json', JSON.stringify(libA)), fakeFile('b.json', JSON.stringify(libB))]

    const result = await importLibraryFiles(files)

    expect(Object.keys(result.libraryByAreaId).sort()).toEqual(['email-writing', 'telephoning'])
    expect(result.report.loaded).toHaveLength(2)
    expect(result.report.errors).toHaveLength(0)
  })

  it('eine kaputte Datei blockiert andere gültige Dateien nicht', async () => {
    const good = makeValidLibrary()
    const files = [fakeFile('broken.json', '{not valid json'), fakeFile('good.json', JSON.stringify(good))]

    const result = await importLibraryFiles(files)

    expect(result.report.errors).toHaveLength(1)
    expect(result.report.errors[0].fileName).toBe('broken.json')
    expect(result.libraryByAreaId.telephoning).toBeTruthy()
    expect(result.report.loaded).toHaveLength(1)
  })

  it('identischer Fingerprint über zwei Dateien im selben Batch = Duplikat', async () => {
    const lib = makeValidLibrary()
    const text = JSON.stringify(lib)
    const files = [fakeFile('a.json', text), fakeFile('a-copy.json', text)]

    const result = await importLibraryFiles(files)

    expect(result.report.loaded).toHaveLength(1)
    expect(result.report.duplicates).toHaveLength(1)
    expect(result.report.duplicates[0].fileName).toBe('a-copy.json')
  })

  it('gleiche libraryId + höhere Version im selben Batch = Upgrade, Konflikt-Status wird nicht gesetzt', async () => {
    const v1 = makeValidLibrary({ libraryVersion: 1 })
    const v2 = makeValidLibrary({
      libraryVersion: 2,
      lessons: [
        {
          lessonId: 'telephoning-l1',
          lessonTitle: 'Lesson 1',
          scenarios: [
            {
              scenarioId: 'telephoning-l1-s1',
              scenarioTitle: 'Scenario 1',
              items: [makeChoiceItem('tel-001'), makeOrderedItem('tel-002'), makeChoiceItem('tel-003')],
            },
          ],
        },
      ],
    })
    const files = [fakeFile('v1.json', JSON.stringify(v1)), fakeFile('v2.json', JSON.stringify(v2))]

    const result = await importLibraryFiles(files)

    expect(result.report.upgrades).toHaveLength(1)
    expect(result.libraryByAreaId.telephoning.library.libraryVersion).toBe(2)
    expect(result.conflictsByAreaId.telephoning).toBeUndefined()
  })

  it('teilweise gültige Auswahl: gültige Bibliotheken laden trotz einzelner Fehler', async () => {
    const good = makeValidLibrary()
    const invalid = makeValidLibrary({ libraryVersion: -1 })
    const files = [fakeFile('good.json', JSON.stringify(good)), fakeFile('invalid.json', JSON.stringify(invalid))]

    const result = await importLibraryFiles(files)

    expect(result.libraryByAreaId.telephoning).toBeTruthy()
    expect(result.report.errors).toHaveLength(1)
  })
})

describe('importLibraryFiles - echte Konflikte (Reihenfolge-unabhängig, keine aktive Bibliothek)', () => {
  it('1) unterschiedliche libraryId, gleiche areaId, Reihenfolge A -> B: conflict, keine aktive Bibliothek', async () => {
    const libA = makeValidLibrary({ libraryId: 'lib-a' })
    const libB = makeValidLibrary({ libraryId: 'lib-b' })
    const files = [fakeFile('a.json', JSON.stringify(libA)), fakeFile('b.json', JSON.stringify(libB))]

    const result = await importLibraryFiles(files)

    expect(result.libraryByAreaId.telephoning).toBeUndefined()
    expect(result.conflictsByAreaId.telephoning).toMatchObject({ areaId: 'telephoning', reason: 'different-library-id' })
    expect(result.report.conflicts).toHaveLength(1)
  })

  it('2) derselbe Fall in umgekehrter Reihenfolge B -> A: identischer Endzustand', async () => {
    const libA = makeValidLibrary({ libraryId: 'lib-a' })
    const libB = makeValidLibrary({ libraryId: 'lib-b' })
    const files = [fakeFile('b.json', JSON.stringify(libB)), fakeFile('a.json', JSON.stringify(libA))]

    const result = await importLibraryFiles(files)

    expect(result.libraryByAreaId.telephoning).toBeUndefined()
    expect(result.conflictsByAreaId.telephoning).toMatchObject({ areaId: 'telephoning', reason: 'different-library-id' })
    expect(result.report.conflicts).toHaveLength(1)
  })

  it('3) gleiche libraryId + gleiche libraryVersion + unterschiedlicher Fingerprint, Reihenfolge A -> B: conflict', async () => {
    const libA = makeValidLibrary({ libraryId: 'lib-a', libraryVersion: 1 })
    const libBSameVersionDifferentContent = makeValidLibrary({
      libraryId: 'lib-a',
      libraryVersion: 1,
      lessons: [
        {
          lessonId: 'telephoning-l1',
          lessonTitle: 'Lesson 1 (anderer Inhalt, gleiche Version)',
          scenarios: [
            {
              scenarioId: 'telephoning-l1-s1',
              scenarioTitle: 'Scenario 1',
              items: [makeChoiceItem('tel-999')],
            },
          ],
        },
      ],
    })
    const files = [
      fakeFile('a.json', JSON.stringify(libA)),
      fakeFile('b.json', JSON.stringify(libBSameVersionDifferentContent)),
    ]

    const result = await importLibraryFiles(files)

    expect(result.libraryByAreaId.telephoning).toBeUndefined()
    expect(result.conflictsByAreaId.telephoning).toMatchObject({ areaId: 'telephoning', reason: 'same-version-different-fingerprint' })
  })

  it('4) derselbe Fall in umgekehrter Reihenfolge B -> A: identischer Endzustand', async () => {
    const libA = makeValidLibrary({ libraryId: 'lib-a', libraryVersion: 1 })
    const libBSameVersionDifferentContent = makeValidLibrary({
      libraryId: 'lib-a',
      libraryVersion: 1,
      lessons: [
        {
          lessonId: 'telephoning-l1',
          lessonTitle: 'Lesson 1 (anderer Inhalt, gleiche Version)',
          scenarios: [
            {
              scenarioId: 'telephoning-l1-s1',
              scenarioTitle: 'Scenario 1',
              items: [makeChoiceItem('tel-999')],
            },
          ],
        },
      ],
    })
    const files = [
      fakeFile('b.json', JSON.stringify(libBSameVersionDifferentContent)),
      fakeFile('a.json', JSON.stringify(libA)),
    ]

    const result = await importLibraryFiles(files)

    expect(result.libraryByAreaId.telephoning).toBeUndefined()
    expect(result.conflictsByAreaId.telephoning).toMatchObject({ areaId: 'telephoning', reason: 'same-version-different-fingerprint' })
  })

  it('5) bereits aktive Bibliothek vorhanden, danach in einem separaten Import-Aufruf eine echte Konfliktbibliothek: vorherige Bibliothek bleibt NICHT aktiv', async () => {
    const libA = makeValidLibrary({ libraryId: 'lib-a' })
    const libB = makeValidLibrary({ libraryId: 'lib-b' })

    const firstResult = await importLibraryFiles([fakeFile('a.json', JSON.stringify(libA))])
    expect(firstResult.libraryByAreaId.telephoning.library.libraryId).toBe('lib-a')

    const secondResult = await importLibraryFiles([fakeFile('b.json', JSON.stringify(libB))], {
      libraryByAreaId: firstResult.libraryByAreaId,
      conflictsByAreaId: firstResult.conflictsByAreaId,
    })

    expect(secondResult.libraryByAreaId.telephoning).toBeUndefined()
    expect(secondResult.conflictsByAreaId.telephoning).toMatchObject({ areaId: 'telephoning', reason: 'different-library-id' })
  })

  it('6) nach einem Konflikt kann kein Lernlauf aus einer der konfliktierenden Bibliotheken gestartet werden (Registry-Endzustand verhindert dies)', async () => {
    const libA = makeValidLibrary({ libraryId: 'lib-a' })
    const libB = makeValidLibrary({ libraryId: 'lib-b' })
    const files = [fakeFile('a.json', JSON.stringify(libA)), fakeFile('b.json', JSON.stringify(libB))]

    const result = await importLibraryFiles(files)

    // App.vue startet einen Lauf ausschliesslich ueber
    // result.libraryByAreaId[areaId] - ist dieser Eintrag nicht vorhanden,
    // kann kein automatischer Start stattfinden.
    expect(result.libraryByAreaId.telephoning).toBeUndefined()
  })
})
