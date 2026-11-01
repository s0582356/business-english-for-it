import { describe, expect, it } from 'vitest'
import { importCoachFiles, partitionCoachFiles } from '../coachImport.js'
import { coachLibraryData, jsonFile, withStep } from './coachTestHelpers.js'

describe('Coach-Import (gleicher Dateiwaehler, getrennte Registry)', () => {
  it('trennt Coach-Dateien von Quiz-Bibliotheken, Audio und defektem JSON', async () => {
    const quiz = jsonFile({ type: 'businessEnglishLibrary', areaId: 'x' }, 'quiz.json')
    const broken = new File(['{kaputt'], 'kaputt.json', { type: 'application/json' })
    const { coachFiles, otherFiles } = await partitionCoachFiles([jsonFile(coachLibraryData(), 'coach.json'), quiz, broken])
    expect(coachFiles.map((file) => file.name)).toEqual(['coach.json'])
    expect(otherFiles.map((file) => file.name)).toEqual(['quiz.json', 'kaputt.json'])
  })

  it('laedt eine gueltige Bibliothek nur in die Registry (kein Speicher, kein Fortschritt)', async () => {
    window.localStorage.clear()
    const result = await importCoachFiles([jsonFile(coachLibraryData())])
    expect(result.entry.library.libraryId).toBe('test-coach-v1')
    expect(result.entry.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(result.report.loaded).toHaveLength(1)
    expect(window.localStorage.length).toBe(0) // nichts persistiert
  })

  it('meldet Fehler lesbar und laedt nichts', async () => {
    const invalid = coachLibraryData({ libraryVersion: 0 })
    const result = await importCoachFiles([jsonFile(invalid, 'schlecht.json')])
    expect(result.entry).toBeNull()
    expect(result.report.errors[0]).toMatchObject({ fileName: 'schlecht.json' })
    expect(result.report.errors[0].reason).toContain('libraryVersion')
  })

  it('Duplikat, Upgrade, aeltere Version und Konflikt folgen den Quiz-Regeln', async () => {
    const v1 = await importCoachFiles([jsonFile(coachLibraryData(), 'v1.json')])

    const duplicate = await importCoachFiles([jsonFile(coachLibraryData(), 'v1-kopie.json')], v1)
    expect(duplicate.report.duplicates).toHaveLength(1)
    expect(duplicate.entry.fileName).toBe('v1.json')

    const v2Data = { ...withStep(coachLibraryData(), 't-gap', { acceptedAnswers: ['passes'] }), libraryVersion: 2 }
    const upgrade = await importCoachFiles([jsonFile(v2Data, 'v2.json')], v1)
    expect(upgrade.report.upgrades).toEqual([{ fileName: 'v2.json', areaId: 'w3-lerncoach', libraryVersion: 2 }])
    expect(upgrade.entry.library.libraryVersion).toBe(2)

    const older = await importCoachFiles([jsonFile(coachLibraryData(), 'alt.json')], upgrade)
    expect(older.report.ignored).toHaveLength(1)
    expect(older.entry.library.libraryVersion).toBe(2)

    const sameVersionOtherContent = withStep(coachLibraryData(), 't-explain', { title: 'Anders' })
    const conflict = await importCoachFiles([jsonFile(sameVersionOtherContent, 'konflikt.json')], v1)
    expect(conflict.report.conflicts).toHaveLength(1)
    expect(conflict.entry).toBeNull() // keine der beiden bleibt aktiv
    expect(conflict.conflict).toMatchObject({ reason: 'same-version-different-fingerprint' })
  })
})

// Auftrag 037 (Red-Team-Fund): Konflikte innerhalb EINES Import-Batches duerfen nicht von der Dateireihenfolge abhaengen.
describe('Coach-Import: Batch-Konflikte sind reihenfolgeunabhaengig', () => {
  const A = () => jsonFile(coachLibraryData(), 'A.json')
  const A2 = () => jsonFile(coachLibraryData(), 'A-kopie.json') // inhaltsgleich zu A
  const B = () => jsonFile(withStep(coachLibraryData(), 't-explain', { title: 'Variante B' }), 'B.json')
  const C = () => jsonFile(withStep(coachLibraryData(), 't-explain', { title: 'Variante C' }), 'C.json')
  const names = (entries) => entries.map((entry) => entry.fileName).sort()

  it('A / B / A: nichts wird aktiviert, A und B sind im Konflikt, die zweite A ist ein Duplikat', async () => {
    const result = await importCoachFiles([A(), B(), A2()])
    expect(result.entry).toBeNull()
    expect(result.conflict).toMatchObject({ reason: 'same-version-different-fingerprint' })
    expect(names(result.report.conflicts)).toEqual(['A.json', 'B.json'])
    expect(names(result.report.duplicates)).toEqual(['A-kopie.json'])
    expect(result.report.loaded).toEqual([])
  })

  it('A / B / C und B / A / A und A / A / B: ebenfalls Konflikt ohne aktive Bibliothek', async () => {
    const abc = await importCoachFiles([A(), B(), C()])
    expect(abc.entry).toBeNull()
    expect(names(abc.report.conflicts)).toEqual(['A.json', 'B.json', 'C.json'])

    const baa = await importCoachFiles([B(), A(), A2()])
    expect(baa.entry).toBeNull()
    expect(names(baa.report.conflicts)).toEqual(['A.json', 'B.json'])

    const aab = await importCoachFiles([A(), A2(), B()])
    expect(aab.entry).toBeNull()
    expect(names(aab.report.conflicts)).toEqual(['A.json', 'B.json'])
  })

  it('jede Reihenfolge von A, B, A fuehrt zum selben Ergebnis', async () => {
    const orders = [[A, B, A2], [A, A2, B], [B, A, A2], [A2, B, A], [B, A2, A]]
    const outcomes = []
    for (const order of orders) {
      const result = await importCoachFiles(order.map((make) => make()))
      // Welche der beiden inhaltsgleichen A-Dateien als Duplikat zaehlt, haengt vom Dateinamen-Reihenfolge ab; das Ergebnis nicht.
      outcomes.push({ active: result.entry?.fileName ?? null, conflictCount: result.report.conflicts.length, hasB: result.report.conflicts.some((entry) => entry.fileName === 'B.json'), duplicateCount: result.report.duplicates.length, conflictReason: result.conflict?.reason })
    }
    for (const outcome of outcomes) expect(outcome).toEqual({ active: null, conflictCount: 2, hasB: true, duplicateCount: 1, conflictReason: 'same-version-different-fingerprint' })
  })

  it('identische mehrfach gewaehlte Dateien: eine wird geladen, die uebrigen sind Duplikate, kein Konflikt', async () => {
    const result = await importCoachFiles([A(), A2(), jsonFile(coachLibraryData(), 'A-noch-eine.json')])
    expect(result.entry.fileName).toBe('A.json')
    expect(result.conflict).toBeNull()
    expect(result.report.loaded).toHaveLength(1)
    expect(names(result.report.duplicates)).toEqual(['A-kopie.json', 'A-noch-eine.json'])
    expect(result.report.conflicts).toEqual([])
  })

  it('geladene Bibliothek + widerspruechlicher neuer Batch: die geladene bleibt aktiv, nichts wird ueberschrieben, Meldung nennt das', async () => {
    const loaded = await importCoachFiles([A()])
    const v2a = { ...withStep(coachLibraryData(), 't-explain', { title: 'V2 a' }), libraryVersion: 2 }
    const v2b = { ...withStep(coachLibraryData(), 't-explain', { title: 'V2 b' }), libraryVersion: 2 }
    const result = await importCoachFiles([jsonFile(v2a, 'v2a.json'), jsonFile(v2b, 'v2b.json')], loaded)
    expect(result.entry).toBe(loaded.entry) // dasselbe Objekt, unveraendert
    expect(result.entry.library.libraryVersion).toBe(1)
    expect(result.conflict).toBeNull() // Kachel bleibt benutzbar
    expect(result.report.conflicts).toHaveLength(2)
    expect(result.report.conflicts.every((entry) => entry.keptExisting === true)).toBe(true)
    expect(result.report.upgrades).toEqual([])
  })

  it('geladene Bibliothek + Batch aus gueltigem Upgrade und aelterer Version: Upgrade gewinnt, aeltere wird ignoriert', async () => {
    const loaded = await importCoachFiles([A()])
    const v3 = { ...coachLibraryData(), libraryVersion: 3 }
    const v2 = { ...coachLibraryData(), libraryVersion: 2 }
    const result = await importCoachFiles([jsonFile(v2, 'v2.json'), jsonFile(v3, 'v3.json')], loaded)
    expect(result.entry.library.libraryVersion).toBe(3)
    expect(result.report.upgrades).toHaveLength(1)
    expect(names(result.report.ignored)).toEqual(['v2.json'])
  })

  it('geladene Bibliothek + Batch aus zwei Dateien mit hoechster Version im Konflikt und einer aelteren: geladene bleibt', async () => {
    const loaded = await importCoachFiles([A()])
    const result = await importCoachFiles([
      jsonFile({ ...withStep(coachLibraryData(), 't-explain', { title: 'X' }), libraryVersion: 3 }, 'x3.json'),
      jsonFile({ ...withStep(coachLibraryData(), 't-explain', { title: 'Y' }), libraryVersion: 3 }, 'y3.json'),
      jsonFile({ ...coachLibraryData(), libraryVersion: 2 }, 'alt2.json'),
    ], loaded)
    expect(result.entry.library.libraryVersion).toBe(1)
    expect(names(result.report.conflicts)).toEqual(['x3.json', 'y3.json'])
    expect(names(result.report.ignored)).toEqual(['alt2.json'])
  })

  it('unterschiedliche libraryId im selben Batch ist ein Konflikt', async () => {
    const other = { ...coachLibraryData(), libraryId: 'andere-coach-bibliothek' }
    const result = await importCoachFiles([A(), jsonFile(other, 'andere.json')])
    expect(result.entry).toBeNull()
    expect(result.conflict).toMatchObject({ reason: 'different-library-id' })
  })

  it('ein ungueltiger Kandidat blockiert die uebrigen nicht (Fehler nur fuer diese Datei)', async () => {
    const result = await importCoachFiles([jsonFile(coachLibraryData({ libraryVersion: 0 }), 'schlecht.json'), A()])
    expect(result.entry.fileName).toBe('A.json')
    expect(result.report.errors.map((entry) => entry.fileName)).toEqual(['schlecht.json'])
  })

  it('ein Konflikt im Batch loescht einen frueheren Konflikt-Zustand nicht, wenn nichts Neues gueltig ist', async () => {
    const conflicted = await importCoachFiles([A(), B()])
    const again = await importCoachFiles([jsonFile(coachLibraryData({ libraryVersion: 0 }), 'schlecht.json')], conflicted)
    expect(again.entry).toBeNull()
    expect(again.conflict).toBe(conflicted.conflict)
  })

  it('ein spaeter geladener eindeutiger Kandidat loest einen alten Konflikt-Zustand auf (Nutzer waehlt die richtige Datei)', async () => {
    const conflicted = await importCoachFiles([A(), B()])
    const resolved = await importCoachFiles([A()], conflicted)
    expect(resolved.entry.fileName).toBe('A.json')
    expect(resolved.conflict).toBeNull()
  })
})
