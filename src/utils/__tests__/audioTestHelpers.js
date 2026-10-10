// Gemeinsame Test-Helfer fuer Audio (keine Testdatei: Vitest sammelt nur *.test.js).
import { vi } from 'vitest'
import { createAudioController } from '../audioController.js'
import { getAudioFileNames } from '../audioKeys.js'

export class FakeAudio {
  constructor() {
    this._src = ''
    this.currentTime = 0
    this.playbackRate = 1
    this.defaultPlaybackRate = 1
    this.playedRates = [] // playbackRate zum Zeitpunkt jeder echten Wiedergabe
    this.muted = false
    this.paused = true
    this.listeners = {}
    this.playedSources = []
    this.playError = null // z. B. { name: 'NotAllowedError' }
    this.failSources = new Set() // Quellen, die nicht dekodierbar sind
  }

  // Wie im echten Browser: eine neue Quelle setzt playbackRate auf defaultPlaybackRate zurueck.
  get src() {
    return this._src
  }

  set src(value) {
    this._src = value
    this.playbackRate = this.defaultPlaybackRate
  }

  addEventListener(type, handler) {
    ;(this.listeners[type] ??= []).push(handler)
  }

  pause() {
    this.paused = true
  }

  play() {
    if (this.muted) return Promise.resolve() // stiller Unlock-Versuch
    if (this.playError) return Promise.reject(this.playError)
    if (this.failSources.has(this.src)) {
      for (const handler of this.listeners.error ?? []) handler()
      return Promise.reject(Object.assign(new Error('decode'), { name: 'NotSupportedError' }))
    }
    this.paused = false
    this.playedSources.push(this.src)
    this.playedRates.push(this.playbackRate)
    return Promise.resolve()
  }

  // Nur echte Wiedergaben (nicht der stille Unlock).
  get realPlays() {
    return this.playedSources.filter((src) => src.startsWith('blob:'))
  }
}

const blobBySource = new Map()
let urlCounter = 0

export function installObjectUrlStub() {
  blobBySource.clear()
  urlCounter = 0
  URL.createObjectURL = vi.fn((blob) => {
    const url = `blob:fake/${++urlCounter}`
    blobBySource.set(url, blob)
    return url
  })
  URL.revokeObjectURL = vi.fn()
}

export function blobForSource(url) {
  return blobBySource.get(url)
}

// Fake-Pack: Dateiname -> Bytes (oder Error, um eine defekte Datei zu simulieren).
export function createFakePack(files = {}, { fileName = 'business-english-audio-v1.zip' } = {}) {
  const map = new Map(Object.entries(files))
  const reads = []
  return {
    fileName,
    fileCount: map.size,
    reads,
    has: (name) => map.has(name),
    getBlob: async (name) => {
      reads.push(name)
      const value = map.get(name)
      if (value === undefined) return null
      if (value instanceof Error) throw value
      return new Blob([value], { type: 'audio/mpeg' })
    },
    close: vi.fn(async () => {}),
  }
}

export async function packFor(items, { kinds = ['q', 's'], extra = {} } = {}) {
  const files = { ...extra }
  for (const item of items) {
    const names = await getAudioFileNames(item.areaId, item)
    for (const kind of kinds) if (names[kind]) files[names[kind]] = new Uint8Array([1, 2, 3, kind === 'q' ? 4 : 5])
  }
  return { files, pack: createFakePack(files), names: await Promise.all(items.map((item) => getAudioFileNames(item.areaId, item))) }
}

export function createTestController(settings = {}) {
  window.localStorage.setItem('businessEnglishAudio:v1', JSON.stringify({ audioEnabled: true, autoPlay: true, ...settings }))
  const audioElement = new FakeAudio()
  const controller = createAudioController({ createAudio: () => audioElement })
  return { controller, audioElement }
}

export const choiceItem = {
  id: 'tel-test-01', itemId: 'tel-test-01', areaId: 'telephoning', type: 'choice',
  prompt: 'You pick up the phone at a help desk. Which greeting is best?',
  options: ['Hello, Support Team, Kim speaking. How may I help?', 'WRONG-OPTION-ONE yeah what', 'WRONG-OPTION-TWO hi it is me'],
  correctAnswer: 'Hello, Support Team, Kim speaking. How may I help?',
  explanation: 'ERKLAERUNG-NICHT-VORLESEN weil höflich.',
  memoryHint: { whyItFits: 'MERKHILFE-NICHT-VORLESEN', memoryHook: 'HOOK-NICHT-VORLESEN' },
}

export const gapItem = {
  id: 'social-test-01', itemId: 'social-test-01', areaId: 'socialising-opinions', type: 'gap',
  prompt: 'Complete the fixed phrase: "Nice ___ see you again. How was your trip?"',
  acceptedAnswers: ['to'], explanation: 'ERKLAERUNG-NICHT-VORLESEN',
}

export const orderedDialogItem = {
  id: 'tel-test-05', itemId: 'tel-test-05', areaId: 'telephoning', type: 'ordered',
  prompt: 'Put this short call opening into the correct order.',
  steps: [
    { id: 'a', label: 'Hello, Support Team, Kim speaking.' },
    { id: 'b', label: 'Hi, this is Pat from Accounts.' },
    { id: 'c', label: 'How may I help you, Pat?' },
  ],
  correctOrder: ['a', 'b', 'c'], explanation: 'ERKLAERUNG-NICHT-VORLESEN', stepFeedback: { b: 'FEEDBACK-NICHT-VORLESEN' },
}

export const orderedStructureItem = {
  id: 'email-test-01', itemId: 'email-test-01', areaId: 'email-writing', type: 'ordered',
  prompt: 'Put these four parts of a report into the correct order.',
  steps: [
    { id: 'a', label: 'Title' },
    { id: 'b', label: 'Introduction' },
    { id: 'c', label: 'Main argument (evidence, examples)' },
    { id: 'd', label: 'Conclusion' },
  ],
  correctOrder: ['a', 'b', 'c', 'd'],
}
