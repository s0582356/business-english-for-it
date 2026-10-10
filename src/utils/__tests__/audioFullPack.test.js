import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAudioFileNames } from '../audioKeys.js'
import { openAudioPack } from '../audioPack.js'
import { flattenLibraryItems, validateLibrary } from '../libraryImport.js'

// Regression gegen das echte private Voll-Pack (nur lokal vorhanden, sonst uebersprungen).
// Coverage unterscheidet drei Faelle und wird nie kuenstlich gruen gemacht:
//   EXPECTED_AUDIO        - die App erwartet die Datei, sie MUSS im ZIP liegen
//   INTENTIONAL_NO_AUDIO  - bewusst ohne Audio (negative Choice Klasse B laut closure-decisions.json,
//                           Ordered ohne sprechbare Satzfolge) - darf NICHT im ZIP liegen
//   MISSING_AUDIO_ERROR   - erwartet, aber nicht vorhanden -> Fehler
const ROOT = resolve(__dirname, '../../..')
const PRIVATE = join(ROOT, 'private')
const ZIP = join(PRIVATE, 'audio/business-english-audio-v1.zip')
const DECISIONS = join(PRIVATE, 'audio/closure-decisions.json')
const libraryFiles = existsSync(PRIVATE) ? readdirSync(PRIVATE).filter((name) => name.endsWith('.json')) : []
const hasFullPack = existsSync(ZIP) && libraryFiles.length > 0 && readFileSync(ZIP).length > 5 * 1024 * 1024

describe.skipIf(!hasFullPack)('Voll-Pack: App-Mapping gegen alle privaten Libraries', () => {
  it('EXPECTED_AUDIO vollstaendig, INTENTIONAL_NO_AUDIO nicht im ZIP, MISSING_AUDIO_ERROR = 0, keine unerwarteten Dateien', async () => {
    const decisions = existsSync(DECISIONS) ? JSON.parse(readFileSync(DECISIONS, 'utf8')) : { negativeChoice: {} }
    const intentionalSolution = (itemId) => decisions.negativeChoice?.[itemId]?.class === 'B'

    const pack = await openAudioPack(new File([readFileSync(ZIP)], 'business-english-audio-v1.zip', { type: 'application/zip' }))
    const expected = new Set()
    const intentional = []
    const missing = []
    const noNameNotOrdered = []
    let itemCount = 0
    const perArea = {}

    for (const file of libraryFiles) {
      const library = validateLibrary(JSON.parse(readFileSync(join(PRIVATE, file), 'utf8')))
      for (const item of flattenLibraryItems(library)) {
        itemCount++
        const names = await getAudioFileNames(library.areaId, item)
        expect(names.q, `${item.itemId} braucht immer eine Frage`).toBeTruthy()
        const area = (perArea[library.areaId] ??= { expected: 0, present: 0, intentional: 0 })
        for (const kind of ['q', 's']) {
          const name = names[kind]
          if (!name) {
            if (kind === 's' && item.type !== 'ordered') noNameNotOrdered.push(item.itemId) // nur Ordered darf ohne Loesungstext sein
            continue
          }
          if (kind === 's' && intentionalSolution(item.itemId)) {
            intentional.push(`${library.areaId}/${item.itemId}`)
            area.intentional++
            expect(pack.has(name), `${item.itemId}: bewusst ausgeschlossen, darf nicht im ZIP liegen`).toBe(false)
            continue
          }
          expected.add(name)
          area.expected++
          if (pack.has(name)) area.present++
          else missing.push(`${library.areaId}/${item.itemId}/${kind}`)
        }
      }
    }

    expect(itemCount).toBeGreaterThan(0)
    expect(noNameNotOrdered, 'Loesungstext fehlt bei Nicht-Ordered-Items').toEqual([])
    expect(missing, 'MISSING_AUDIO_ERROR').toEqual([])
    for (const [areaId, counts] of Object.entries(perArea)) expect(counts.present, `${areaId}: EXPECTED_AUDIO`).toBe(counts.expected)
    expect(pack.fileCount).toBe(expected.size) // keine veralteten/unerwarteten Dateien im Pack
    expect(new Set(intentional).size).toBe(intentional.length)
    await pack.close()
  })

  // Unabhaengige, FEST einprogrammierte Liste (nicht aus closure-decisions.json oder der Generator-Logik abgeleitet):
  // genau diese 13 Items duerfen ohne Loesungs-Audio sein, bei allen anderen muss sie im ZIP liegen.
  const INTENTIONAL_NO_AUDIO = {
    negativeChoice: [
      'email-request-register-03', 'email-request-direct-02', 'opinion-disagree-04', 'tel-first-02', 'tel-reach-transfer-02',
      'tel-reach-unavailable-03', 'tel-slow-02', 'tel-disagree-02', 'tel-closing-03',
    ],
    ordered: ['email-closing-03', 'email-salutation-03', 'email-structure-01', 'vocab-org-hierarchy-06'],
  }

  it('INTENTIONAL_NO_AUDIO: genau die 13 festen Items haben keine Loesungs-Audio im ZIP - jedes andere hat sie', async () => {
    const fixed = [...INTENTIONAL_NO_AUDIO.negativeChoice, ...INTENTIONAL_NO_AUDIO.ordered]
    expect(fixed).toHaveLength(13)
    expect(new Set(fixed).size).toBe(13)

    const pack = await openAudioPack(new File([readFileSync(ZIP)], 'business-english-audio-v1.zip', { type: 'application/zip' }))
    const withoutSolution = []
    const types = {}
    let itemCount = 0
    let questionFiles = 0
    let solutionFiles = 0

    for (const file of libraryFiles) {
      const library = validateLibrary(JSON.parse(readFileSync(join(PRIVATE, file), 'utf8')))
      for (const item of flattenLibraryItems(library)) {
        itemCount++
        types[item.itemId] = item.type
        const names = await getAudioFileNames(library.areaId, item)
        expect(pack.has(names.q), `${item.itemId}: Fragen-Audio fehlt`).toBe(true) // Fragen-Audio gibt es fuer ALLE Items, auch die 13
        questionFiles++
        const hasSolutionFile = Boolean(names.s) && pack.has(names.s)
        if (hasSolutionFile) solutionFiles++
        else withoutSolution.push(item.itemId)
      }
    }

    expect(withoutSolution.sort()).toEqual([...fixed].sort())
    // Negative Choice: die App BERECHNET einen Loesungs-Namen, die Datei liegt aber bewusst nicht im ZIP (-> kein Button)
    for (const id of INTENTIONAL_NO_AUDIO.negativeChoice) expect(types[id], id).toBe('choice')
    // Ordered ohne sprechbare Satzfolge: die App berechnet gar keinen Loesungs-Namen
    for (const id of INTENTIONAL_NO_AUDIO.ordered) expect(types[id], id).toBe('ordered')
    expect(questionFiles).toBe(itemCount)
    expect(solutionFiles).toBe(itemCount - 13)
    expect(pack.fileCount).toBe(itemCount + itemCount - 13) // Fragen + Loesungen, nichts Zusaetzliches
    await pack.close()
  })
})
