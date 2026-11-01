import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioController } from '../audioController.js'
import { combineAudioPacks, openAudioPack } from '../audioPack.js'
import { getAudioFileNames } from '../audioKeys.js'
import { describeSpokenTexts, getSpokenTexts } from '../audioText.js'
import { PLAYBACK_RATE_MIN } from '../audioSettings.js'
import { validateCoachLibrary } from '../coachLibrary.js'
import { FakeAudio, createFakePack, installObjectUrlStub, packFor } from './audioTestHelpers.js'
import { coachLibraryData } from './coachTestHelpers.js'

const library = validateCoachLibrary(coachLibraryData())
const steps = Object.fromEntries(library.units[0].steps.map((step) => [step.stepId, step]))
const examples = steps['t-examples'].examples

describe('Coach-Audio: Sprechtexte und Dateinamen (bestehende Regeln)', () => {
  it('Beispielsaetze: nur der englische Satz wird gesprochen, nie die deutsche Uebersetzung', () => {
    expect(getSpokenTexts(examples[0])).toEqual({ question: 'The test passes today.', solution: null })
    expect(JSON.stringify(examples.map(getSpokenTexts))).not.toContain('Der Test')
  })

  it('Eigene Satzbildung: nur die ERSTE Musterloesung, keine weiteren, keine Checkliste, kein Feedback, nie eine Nutzerantwort', () => {
    expect(getSpokenTexts(steps['t-produce'])).toEqual({ question: null, solution: 'Model sentence one.' })
    const all = JSON.stringify(Object.values(steps).map((step) => (step.type === 'examples' ? step.examples : [step]).map(getSpokenTexts)))
    for (const text of ['Wrong-ish', 'Punkt eins', 'FEEDBACK', 'Schreibe einen Satz']) expect(all).not.toContain(text)
  })

  it('Choice: falsche Optionen und Erklaerung gelangen nie ins Audio; Loesung ist die richtige Antwort', () => {
    const spoken = getSpokenTexts(steps['t-choice'])
    expect(spoken.solution).toBe('Right sentence one.')
    expect(JSON.stringify(spoken)).not.toMatch(/WRONG|ERKLAERUNG/)
  })

  it('Gap: Loesungssatz wird mit der Antwort rekonstruiert, ohne Aufgabenanweisung', () => {
    expect(getSpokenTexts(steps['t-gap'])).toEqual({ question: 'Complete the sentence: The test … today.', solution: 'The test passes today.' })
  })

  it('Reine Lese-Schritte (Erklaerung, Fazit) haben kein Audio', () => {
    for (const id of ['t-explain', 't-recap']) expect(describeSpokenTexts(steps[id])).toEqual({ question: null, solution: null, flags: [] })
  })

  it('Dateinamen folgen <areaId>__<itemId>__<q|s>__<hash8>.mp3 und aendern sich mit dem Text', async () => {
    const names = await getAudioFileNames(examples[0].areaId, examples[0])
    expect(names.q).toMatch(/^w3-lerncoach__t-ex-1__q__[0-9a-f]{8}\.mp3$/)
    expect(names.s).toBeNull()
    const changed = await getAudioFileNames(examples[0].areaId, { ...examples[0], en: 'The test passes tomorrow.' })
    expect(changed.q).not.toBe(names.q)
    expect((await getAudioFileNames('w3-lerncoach', steps['t-produce'])).s).toMatch(/^w3-lerncoach__t-produce__s__[0-9a-f]{8}\.mp3$/)
  })

  it('Coach-Dateinamen kollidieren nicht mit W2- oder W3-Quiz-Namen (eigener areaId-Praefix)', async () => {
    const coach = Object.values(await getAudioFileNames('w3-lerncoach', steps['t-choice']))
    const quiz = Object.values(await getAudioFileNames('w3-unterricht', steps['t-choice']))
    for (const name of coach.filter(Boolean)) expect(quiz).not.toContain(name)
  })
})

describe('Coach-Audio: Tempo und Wiederholen (bestehender Player)', () => {
  let audioElement
  beforeEach(() => {
    window.localStorage.clear()
    installObjectUrlStub()
    audioElement = new FakeAudio()
  })
  afterEach(() => vi.unstubAllGlobals())

  async function controllerWithExample() {
    const controller = createAudioController({ createAudio: () => audioElement })
    const { pack } = await packFor([examples[0]])
    controller.setPack(pack)
    controller.unlock()
    const files = await controller.resolveFiles(examples[0])
    return { controller, name: files.q }
  }

  it('Einmal-Tempo: "langsam" spielt mit 0,75x, danach gilt wieder das globale Tempo', async () => {
    const { controller, name } = await controllerWithExample()
    controller.setPlaybackRate(1.1)
    await controller.playFile(name, { rate: PLAYBACK_RATE_MIN })
    await controller.playFile(name)
    expect(audioElement.playedRates.slice(-2)).toEqual([0.75, 1.1])
    expect(controller.playbackRate.value).toBe(1.1) // globale Einstellung unveraendert
    expect(JSON.parse(window.localStorage.getItem('businessEnglishAudio:v1')).playbackRate).toBe(1.1)
  })

  it('Tempo-Aenderung waehrend einer langsamen Wiedergabe ueberschreibt das Einmal-Tempo nicht', async () => {
    const { controller, name } = await controllerWithExample()
    await controller.playFile(name, { rate: PLAYBACK_RATE_MIN })
    controller.setPlaybackRate(1.2)
    expect(audioElement.playbackRate).toBe(0.75)
  })

  it('Wiederholen: erneutes Tippen spielt dieselbe Datei erneut von vorn (ein Element, kein Web Audio)', async () => {
    const { controller, name } = await controllerWithExample()
    await controller.playFile(name)
    await controller.playFile(name)
    expect(audioElement.realPlays).toHaveLength(2)
    expect(new Set(audioElement.realPlays).size).toBe(1)
    expect(audioElement.currentTime).toBe(0)
  })
})

describe('Audio-Pack: Ergaenzen statt Ersetzen (addPack)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    installObjectUrlStub()
  })

  const pack = (names, fileName) => createFakePack(Object.fromEntries(names.map((name) => [name, new Uint8Array([1])])), { fileName })

  it('zwei verschiedene ZIPs sind gleichzeitig aktiv, W2-Dateien bleiben erreichbar', () => {
    const controller = createAudioController({ createAudio: () => new FakeAudio() })
    controller.addPack(pack(['telephoning__a__q__11111111.mp3'], 'w2.zip'))
    const result = controller.addPack(pack(['w3-lerncoach__b__q__22222222.mp3'], 'coach.zip'))
    expect(result.ok).toBe(true)
    expect(controller.hasPack.value).toBe(true)
  })

  it('ueberschneidende Dateinamen: ok:false und der bisherige Zustand bleibt unveraendert', () => {
    const controller = createAudioController({ createAudio: () => new FakeAudio() })
    const first = pack(['a__x__q__11111111.mp3'], 'eins.zip')
    controller.setPack(first)
    const revision = controller.packRevision.value
    const result = controller.addPack(pack(['a__x__q__11111111.mp3', 'b__y__q__22222222.mp3'], 'zwei.zip'))
    expect(result.ok).toBe(false)
    expect(controller.packRevision.value).toBe(revision)
    expect(controller.hasPack.value).toBe(true)
  })

  it('derselbe Dateiname ersetzt sein Gegenstueck (erneutes Laden), schliesst nur das ersetzte Teil', () => {
    const controller = createAudioController({ createAudio: () => new FakeAudio() })
    const oldCoach = Object.assign(pack(['w3-lerncoach__b__q__22222222.mp3'], 'coach.zip'), { close: vi.fn() })
    const w2 = Object.assign(pack(['telephoning__a__q__11111111.mp3'], 'w2.zip'), { close: vi.fn() })
    controller.addPack(w2)
    controller.addPack(oldCoach)
    const newCoach = pack(['w3-lerncoach__b__q__22222222.mp3', 'w3-lerncoach__c__q__33333333.mp3'], 'coach.zip')
    expect(controller.addPack(newCoach).ok).toBe(true)
    expect(oldCoach.close).toHaveBeenCalledTimes(1)
    expect(w2.close).not.toHaveBeenCalled()
  })

  it('kombinierte Packs behalten ihre Teile fuer spaeteres Ersetzen', () => {
    const combined = combineAudioPacks([pack(['a__x__q__11111111.mp3'], 'a.zip'), pack(['b__y__q__22222222.mp3'], 'b.zip')])
    expect(combined.parts.map((part) => part.fileName)).toEqual(['a.zip', 'b.zip'])
  })
})

// Regression gegen das echte private Coach-Audio (nur lokal vorhanden, sonst uebersprungen).
const ROOT = resolve(__dirname, '../../..')
const PRIVATE_COACH = join(ROOT, 'private/w3/w3-lerncoach.json')
const PRIVATE_ZIP = join(ROOT, 'private/audio-coach/business-english-audio-coach-v1.zip')
const hasPrivateCoach = existsSync(PRIVATE_COACH) && existsSync(PRIVATE_ZIP)

describe.skipIf(!hasPrivateCoach)('Coach-Audio: echtes privates Paket', () => {
  it('die App erwartet genau die Dateinamen im ZIP (Mapping ohne Manifest, keine Waisen)', async () => {
    const realLibrary = validateCoachLibrary(JSON.parse(readFileSync(PRIVATE_COACH, 'utf8')))
    const expected = []
    for (const unit of realLibrary.units) for (const step of unit.steps) {
      for (const item of step.type === 'examples' ? step.examples : [step]) {
        const names = await getAudioFileNames(item.areaId, item)
        expected.push(...[names.q, names.s].filter(Boolean))
      }
    }
    const file = new File([readFileSync(PRIVATE_ZIP)], 'business-english-audio-coach-v1.zip', { type: 'application/zip' })
    const zip = await openAudioPack(file)
    expect(zip.names().sort()).toEqual(expected.sort())
    await zip.close()
  })
})
