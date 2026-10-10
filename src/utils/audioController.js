// Audio-Controller: ein Objekt pro App (per provide/inject an die Renderer).
//
// Haelt das geladene Audio-Pack (nur im Speicher), die zwei Einstellungen,
// einen kleinen Object-URL-Cache und den einzigen Player. Audio ist reine
// Zusatzfunktion: jeder Fehler (fehlende/defekte Datei, blockiertes Autoplay)
// fuehrt nur dazu, dass fuer die betroffene Datei kein Audio angeboten wird -
// niemals zu einer Exception, die den Lernfluss stoert.

import { computed, ref, shallowRef } from 'vue'
import { getAudioFileNames } from './audioKeys.js'
import { createAudioPlayer } from './audioPlayer.js'
import { loadAudioSettings, parsePlaybackRate, saveAudioSettings } from './audioSettings.js'

export const AUDIO_CONTROLLER_KEY = 'audioController'

// Aktuelle Frage + Loesung + naechste Frage; mehr wird nicht vorgehalten.
const MAX_CACHED_URLS = 6

const NO_FILES = Object.freeze({ q: null, s: null })

export function createAudioController({ createAudio } = {}) {
  const initialSettings = loadAudioSettings()
  const audioEnabled = ref(initialSettings.audioEnabled)
  const autoPlay = ref(initialSettings.autoPlay)
  const playbackRate = ref(initialSettings.playbackRate)
  const pack = shallowRef(null)
  const hasPack = computed(() => pack.value !== null)
  const packRevision = ref(0)
  const brokenRevision = ref(0)
  const autoplayBlocked = ref(false)

  const broken = new Set()
  const urlCache = new Map() // Dateiname -> Object-URL (Blob liegt nur im Speicher)
  // Object-URL-Besitz: JEDE erzeugte URL steht in createdUrls, bis sie genau einmal freigegeben wird.
  // retiredUrls: aus dem Cache entfernt, aber noch Quelle des Players - Freigabe, sobald der Player
  // eine andere Quelle hat oder stoppt (nie unter einer laufenden Wiedergabe wegziehen).
  const createdUrls = new Set()
  const retiredUrls = new Set()
  const pendingLoads = new Map()
  let disposed = false
  const fileNamesByItem = new WeakMap()
  let currentOwner = null
  let playSeq = 0

  const player = createAudioPlayer({
    createAudio,
    onError: (url) => {
      for (const [name, cachedUrl] of urlCache) if (cachedUrl === url) markBroken(name)
    },
  })

  player.setPlaybackRate(playbackRate.value)

  function revokeUrl(url) {
    retiredUrls.delete(url)
    if (!createdUrls.delete(url)) return // schon freigegeben: nie doppelt revoken
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
  }

  function releaseRetired({ force = false } = {}) {
    for (const url of [...retiredUrls]) if (force || url !== player.currentUrl) revokeUrl(url)
  }

  function revoke(name) {
    const url = urlCache.get(name)
    if (!url) return
    urlCache.delete(name)
    if (url === player.currentUrl) retiredUrls.add(url)
    else revokeUrl(url)
  }

  function markBroken(name) {
    if (broken.has(name)) return
    broken.add(name)
    revoke(name)
    brokenRevision.value++
  }

  function trimCache() {
    while (urlCache.size > MAX_CACHED_URLS) revoke(urlCache.keys().next().value)
  }

  // Alles freigeben (Packwechsel, dispose): erst die Quelle des Players loesen, dann jede URL einmal revoken.
  function releaseAllUrls() {
    player.release()
    urlCache.clear()
    pendingLoads.clear()
    for (const url of [...createdUrls]) revokeUrl(url)
    retiredUrls.clear()
  }

  // Liest EINE Datei aus dem Pack (bei Bedarf) und macht daraus eine Object-URL.
  function loadUrl(name) {
    if (urlCache.has(name)) return Promise.resolve(urlCache.get(name))
    if (pendingLoads.has(name)) return pendingLoads.get(name)

    const promise = (async () => {
      const currentPack = pack.value
      if (!currentPack || broken.has(name) || typeof URL.createObjectURL !== 'function') return null
      try {
        const blob = await currentPack.getBlob(name)
        if (disposed || !blob || pack.value !== currentPack) return null // veraltete Anfrage: keine URL erzeugen
        const url = URL.createObjectURL(blob)
        createdUrls.add(url)
        urlCache.set(name, url)
        trimCache()
        return url
      } catch {
        markBroken(name)
        return null
      }
    })()
    pendingLoads.set(name, promise)
    // nur den eigenen Eintrag entfernen: ein Packwechsel kann fuer denselben Namen schon eine neuere Anfrage angelegt haben
    promise.finally(() => { if (pendingLoads.get(name) === promise) pendingLoads.delete(name) })
    return promise
  }

  // { q, s }: Dateinamen, die im Pack WIRKLICH vorhanden (und nicht als defekt
  // markiert) sind, sonst null. Der Dateiname haengt vom Text-Hash ab - ein
  // geaenderter Text findet daher kein altes Audio.
  async function resolveFiles(item) {
    const currentPack = pack.value
    if (!currentPack || !item) return NO_FILES
    let names = fileNamesByItem.get(item)
    if (!names) {
      names = getAudioFileNames(item.areaId, item).catch(() => NO_FILES)
      fileNamesByItem.set(item, names)
    }
    const { q, s } = await names
    const usable = (name) => (name && currentPack.has(name) && !broken.has(name) ? name : null)
    return { q: usable(q), s: usable(s) }
  }

  // Bereitet Object-URLs vor (nicht abspielen!). Die Loesung darf technisch
  // vorbereitet werden; abgespielt wird sie nur nach der Abgabe.
  async function prepare(files) {
    await Promise.all([files?.q, files?.s].filter(Boolean).map((name) => loadUrl(name)))
  }

  async function prefetchQuestion(item) {
    if (!pack.value || !audioEnabled.value) return
    const files = await resolveFiles(item)
    if (files.q) await loadUrl(files.q)
  }

  function stop(owner) {
    if (owner !== undefined && owner !== currentOwner) return
    playSeq++
    currentOwner = null
    player.stop()
    releaseRetired({ force: true }) // gestoppt: zurueckgestellte URLs werden nicht mehr gebraucht
  }

  // true = Wiedergabe gestartet. Wirft nie.
  async function playFile(name, { owner = null, auto = false } = {}) {
    if (!audioEnabled.value || !name || !pack.value) return false
    const seq = ++playSeq
    currentOwner = owner

    let url = urlCache.get(name)
    if (!url) {
      player.stop()
      url = await loadUrl(name)
      if (seq !== playSeq || !url) return false
    }

    const playing = player.play(url)
    releaseRetired() // der Player hat jetzt eine neue Quelle: zurueckgestellte URLs freigeben
    const result = await playing
    if (seq !== playSeq || result.stale) return false
    if (result.ok) {
      autoplayBlocked.value = false
      return true
    }
    if (result.error?.name === 'NotAllowedError') {
      // iOS/Safari hat das automatische Starten blockiert: kein Fehler, nur Hinweis.
      if (auto) autoplayBlocked.value = true
      return false
    }
    markBroken(name)
    return false
  }

  function setPack(newPack) {
    const previous = pack.value
    stop()
    releaseAllUrls()
    disposed = false
    broken.clear()
    pack.value = newPack
    packRevision.value++
    autoplayBlocked.value = false
    previous?.close?.()
  }

  function persist() {
    saveAudioSettings({ audioEnabled: audioEnabled.value, autoPlay: autoPlay.value, playbackRate: playbackRate.value })
  }

  function setAudioEnabled(value) {
    audioEnabled.value = Boolean(value)
    if (!audioEnabled.value) stop()
    persist()
  }

  function setAutoPlay(value) {
    autoPlay.value = Boolean(value)
    persist()
  }

  // value darf eine Zahl oder der String eines Range-Inputs sein; nur die zehn
  // Rasterwerte 0.75-1.20 werden akzeptiert, alles andere wird ignoriert.
  function setPlaybackRate(value) {
    const rate = parsePlaybackRate(typeof value === 'string' ? Number(value) : value)
    if (rate === null) return false
    playbackRate.value = rate
    player.setPlaybackRate(rate)
    persist()
    return true
  }

  function unlock() {
    if (pack.value) player.unlock()
  }

  function dispose() {
    stop()
    disposed = true
    releaseAllUrls()
  }

  return {
    audioEnabled,
    autoPlay,
    playbackRate,
    hasPack,
    packRevision,
    brokenRevision,
    autoplayBlocked,
    setPack,
    setAudioEnabled,
    setAutoPlay,
    setPlaybackRate,
    resolveFiles,
    prepare,
    prefetchQuestion,
    playFile,
    stop,
    unlock,
    dispose,
  }
}
