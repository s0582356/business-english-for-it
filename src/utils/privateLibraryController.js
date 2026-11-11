// Steuerung der lokal gespeicherten privaten Bibliotheken (App-weit, einmal je App-Instanz).
//
// Aufgaben:
//   - restore(): beim App-Start gespeicherte Dateien laden und durch den normalen Importpfad aktivieren
//     (erneute Validierung, gleiche Regeln wie bei einer frisch gewaehlten Datei).
//   - persistOutcomes(): nach einem Import genau die aktivierten Dateien lokal speichern. Ungueltige Dateien
//     veraendern nichts am Gespeicherten; schlaegt das Speichern fehl, bleibt der alte Datensatz erhalten und die
//     Bibliothek ist fuer diese Sitzung trotzdem nutzbar. Der Controller vertraut NICHT auf seinen eigenen Zustand:
//     ob gespeichert, Duplikat, veraltet oder Konflikt entscheidet die atomare Transaktion im Speicher, und die
//     Anzeige wird danach aus dem tatsaechlichen Speicherstand neu aufgebaut.
//   - prepareRemoval()/remove(): manuelles Entfernen einer gespeicherten Bibliothek (nie automatisch, keine Ablauffrist).
//     Vor der Rueckfrage wird der angezeigte Datensatz als Snapshot (Metadaten + tatsaechliche Bytes) erfasst; entfernt
//     wird nur, wenn in der Transaktion noch genau dieser Inhalt gespeichert ist. Sonst bleibt der Datensatz erhalten.
//   - Pruefzeit: `state.lastCheckedAt` ist der Zeitpunkt, an dem der Speicher zuletzt TATSAECHLICH gelesen wurde. Die
//     Oberflaeche darf den gespeicherten Stand nur als "zuletzt geprueft" zeigen, nie als sicher aktuell.
//   - Synchronisierung: Aenderungen anderer Instanzen werden erkannt, die Anzeige wird neu aus dem Speicher gelesen.
//
// Alle Vorgaenge laufen ueber eine gemeinsame Warteschlange (enqueue), damit eine Auswahl, das Wiederherstellen und
// das Entfernen einander nie ueberholen.
//
// Der Zustand (`state`) enthaelt keine Bibliotheksinhalte, nur Metadaten (Art, Bereichs-ID, Version, Dateiname).

import { reactive } from 'vue'
import { runJsonImport } from './privateImportPipeline.js'
import { collectAcceptedRecords, createLibraryPersistence } from './privateLibraryPersistence.js'
import { LIBRARY_KIND, REMOVE_OUTCOME, STORE_ERROR, identitiesMatch } from './privateLibraryStore.js'
import { createSyncChannel } from './privateLibrarySync.js'

const STORE_PROBLEM_TEXT = {
  [STORE_ERROR.UNAVAILABLE]: 'Dein Browser erlaubt hier kein lokales Speichern (zum Beispiel im privaten Modus).',
  [STORE_ERROR.QUOTA]: 'Auf diesem Gerät ist nicht genug Speicherplatz frei.',
  [STORE_ERROR.BLOCKED]: 'Der lokale Speicher ist durch einen anderen geöffneten Tab der App blockiert.',
  [STORE_ERROR.FAILED]: 'Der lokale Speicher meldete einen Fehler.',
}

export function storeProblemText(code) {
  return STORE_PROBLEM_TEXT[code] ?? STORE_PROBLEM_TEXT[STORE_ERROR.FAILED]
}

// `getRegistries()` -> { quiz, coach, figures, practice } (aktueller Stand der App).
// `apply` -> { quiz, coach, figures, practice }: uebernimmt ein Importergebnis in die App.
// `sync`: Kanal zur Synchronisierung mit anderen Instanzen (Standard: BroadcastChannel/storage/Sichtbarkeit);
// `null` schaltet sie ab - der atomare Schutz im Speicher haengt nicht davon ab.
export function createPrivateLibraryController({ persistence = createLibraryPersistence(), getRegistries, apply, sync = createSyncChannel(), now = () => Date.now() }) {
  const state = reactive({
    // 'idle' (noch nichts versucht) | 'loading' | 'ready' | 'unavailable' | 'error'
    status: 'idle',
    records: [], // gespeicherte, intakte Bibliotheken (Metadaten)
    invalid: [], // gespeichert, aber beschaedigt: { key, record|null, reason }
    missing: [], // zuvor gespeichert, jetzt vom Browser entfernt: Merklisten-Eintraege
    saveProblems: [], // { key, kind, fileName, code } - geladen, aber nicht dauerhaft gespeichert (Fehler)
    saveRejections: [], // { key, fileName, outcome: 'stale'|'conflict', incomingVersion, storedVersion } - vom Speicher abgelehnt
    restoreErrors: {}, // fileName -> Grund, falls eine gespeicherte Datei beim Start nicht aktiviert werden konnte
    lastCheckedAt: null, // Zeitpunkt (ms) der letzten erfolgreichen Lesepruefung des Speichers; null = noch nie
    checkFailed: false, // die letzte Pruefung ist fehlgeschlagen (die angezeigten Staende stammen dann aus lastCheckedAt)
    persisted: null, // true/false = Browser hat dauerhaften Speicher zugesagt/nicht; null = unbekannt
    notice: '',
    noticeIsError: false,
  })

  // Nach dispose() veraendert nichts mehr den Controller oder die App (laufende Pruefungen laufen ins Leere).
  let disposed = false

  let queue = Promise.resolve()
  function enqueue(task) {
    const run = queue.catch(() => {}).then(task)
    queue = run
    return run
  }

  const quietApply = {
    quiz: (result) => !disposed && apply.quiz({ ...result, report: null }),
    coach: (result) => !disposed && apply.coach({ ...result, report: null }),
    figures: (result) => !disposed && apply.figures({ ...result, report: null }),
  }

  function isActive(record) {
    const registries = getRegistries()
    if (record.kind === LIBRARY_KIND.QUIZ) {
      const entry = registries.quiz.libraryByAreaId?.[record.areaId]
      return Boolean(entry) && entry.fingerprint === record.fingerprint && !registries.quiz.conflictsByAreaId?.[record.areaId]
    }
    const registry = registries[record.kind]
    return Boolean(registry?.entry) && registry.entry.fingerprint === record.fingerprint && !registry.conflict
  }

  async function doRestore() {
    if (disposed) return
    state.status = 'loading'
    let finalStatus = 'error'
    try {
      const mine = ++inspectSeq
      const loaded = await persistence.load()
      if (disposed) return
      finalStatus = loaded.status
      if (isLatest(mine)) {
        state.records = loaded.records
        state.invalid = loaded.invalid
        state.missing = loaded.missing
        if (loaded.status === 'ready') state.lastCheckedAt = now()
        state.checkFailed = loaded.status !== 'ready'
      } else {
        finalStatus = state.status === 'loading' ? loaded.status : state.status
      }
      if (loaded.files.length === 0) return
      // Der Status bleibt 'loading', bis die gespeicherten Dateien auch wieder AKTIVIERT sind: Wer "fertig" sieht,
      // sieht auch die aktivierten Bibliotheken.
      const outcomes = await runJsonImport(loaded.files, getRegistries, quietApply)
      if (disposed) return
      const errors = {}
      for (const outcome of outcomes) {
        const { report } = outcome.result
        for (const entry of [...(report?.errors ?? [])]) errors[entry.fileName] = entry.reason
      }
      state.restoreErrors = errors
    } catch {
      // Das Wiederherstellen darf die App nie blockieren; ohne Speicher wirkt sie wie bisher.
      finalStatus = 'error'
    } finally {
      if (!disposed) state.status = finalStatus
    }
  }

  function restore() {
    return enqueue(doRestore)
  }

  const inspectionSnapshot = () =>
    JSON.stringify([state.records.map((entry) => [entry.key, entry.identity]), state.invalid.map((entry) => [entry.key, entry.identity])])

  // Jede gestartete Lesepruefung bekommt eine monoton steigende Nummer. NUR die zuletzt gestartete Pruefung darf ihr
  // Ergebnis uebernehmen, egal ob Erfolg oder Fehler; jede aeltere wird vollstaendig verworfen (Datensaetze, Fehlerstatus,
  // Pruefzeit). So kann weder eine alte erfolgreiche Pruefung den Fehler einer neueren verdecken noch eine alte
  // fehlgeschlagene ein neueres Ergebnis ueberschreiben. Nach dispose() wird nichts mehr uebernommen.
  let inspectSeq = 0
  const isLatest = (seq) => !disposed && seq === inspectSeq

  // Baut records/invalid/missing aus dem tatsaechlichen Speicher neu auf (Quelle der Wahrheit ist der Speicher).
  // Mit `announce` wird eine Aenderung durch eine andere Instanz verstaendlich gemeldet.
  // Bei einem Fehler bleiben die zuvor bekannten Staende sichtbar, gelten aber ab dann als "zuletzt bekannt" (checkFailed,
  // lastCheckedAt unveraendert).
  async function refreshFromStore({ announce = false } = {}) {
    const mine = ++inspectSeq
    let inspected
    try {
      inspected = await persistence.inspect()
    } catch {
      inspected = { status: 'error' }
    }
    if (!isLatest(mine)) return false // ueberholt (oder disposed): Ergebnis, auch ein Fehler, ist nicht mehr massgeblich
    if (inspected.status !== 'ready') {
      state.checkFailed = true
      return false
    }
    const before = inspectionSnapshot()
    state.records = inspected.records
    state.invalid = inspected.invalid
    state.missing = inspected.missing
    state.lastCheckedAt = now()
    state.checkFailed = false
    if (state.status !== 'ready') state.status = 'ready'
    if (announce && before !== inspectionSnapshot()) {
      state.notice = 'Die lokal gespeicherten Bibliotheken wurden in einem anderen Tab oder Fenster geändert. Die Anzeige ist aktualisiert.'
      state.noticeIsError = false
    }
    return true
  }

  // Erneutes Lesen auf Anforderung (Oeffnen/Anzeigen des Speicherbereichs, "Neu pruefen"): ueber die Warteschlange,
  // ohne etwas zu importieren, zu schreiben oder zu senden.
  function checkNow() {
    return enqueue(async () => {
      if (disposed || state.status === 'idle' || state.status === 'loading') return false
      return refreshFromStore({ announce: true })
    })
  }

  async function doPersist(outcomes) {
    try {
      const collected = []
      for (const outcome of outcomes) collected.push(...(await collectAcceptedRecords(outcome.kind, outcome.files, outcome.result)))
      if (disposed || collected.length === 0) return

      if (!persistence.isSupported()) {
        state.saveProblems = collected.map((record) => ({ key: record.key, kind: record.kind, fileName: record.fileName, code: STORE_ERROR.UNAVAILABLE }))
        return
      }

      // Bewusst KEIN Vorfiltern anhand des eigenen Zustands: ein anderer Tab kann den Bestand laengst veraendert haben.
      // Ob gespeichert, Duplikat, veraltet oder Konflikt, entscheidet die atomare Transaktion.
      const { saved, duplicates, stale, conflicts, failed, persisted } = await persistence.save(collected)
      if (disposed) return
      const settledKeys = new Set([...saved, ...duplicates, ...stale, ...conflicts].map((entry) => entry.key))
      const failedKeys = new Set(failed.map((problem) => problem.key))
      state.saveProblems = [
        ...state.saveProblems.filter((problem) => !settledKeys.has(problem.key) && !failedKeys.has(problem.key)),
        ...failed.map(({ key, kind, fileName, code }) => ({ key, kind, fileName, code })),
      ]
      const rejected = [...stale.map((entry) => ({ entry, outcome: 'stale' })), ...conflicts.map((entry) => ({ entry, outcome: 'conflict' }))]
      state.saveRejections = [
        ...state.saveRejections.filter((rejection) => !settledKeys.has(rejection.key)),
        ...rejected.map(({ entry, outcome }) => ({
          key: entry.key,
          fileName: entry.fileName,
          outcome,
          incomingVersion: entry.libraryVersion,
          storedVersion: entry.stored?.libraryVersion ?? null,
        })),
      ]
      if (persisted !== null) state.persisted = persisted
      // Anzeige aus dem tatsaechlichen Speicher aufbauen; gelingt das nicht, wenigstens die gespeicherten Staende uebernehmen.
      const refreshed = await refreshFromStore()
      // Nur wenn das Lesen WIRKLICH fehlschlug (nicht wenn es von einer neueren Pruefung ueberholt wurde), die gespeicherten
      // Staende lokal uebernehmen.
      if (!refreshed && state.checkFailed && !disposed && saved.length > 0) {
        const savedKeys = new Set(saved.map((summary) => summary.key))
        state.records = [...state.records.filter((stored) => !savedKeys.has(stored.key)), ...saved]
        state.status = 'ready'
      }
      if (saved.length > 0 && !disposed) sync?.notifyChanged()
    } catch {
      if (disposed) return
      state.saveProblems = [{ key: '', kind: null, fileName: '', code: STORE_ERROR.FAILED }]
    }
  }

  function persistOutcomes(outcomes) {
    return doPersist(outcomes)
  }

  function deactivate(record) {
    const registries = getRegistries()
    if (record.kind === LIBRARY_KIND.QUIZ) {
      const libraryByAreaId = { ...registries.quiz.libraryByAreaId }
      delete libraryByAreaId[record.areaId]
      apply.quiz({ libraryByAreaId, conflictsByAreaId: { ...registries.quiz.conflictsByAreaId }, report: null })
    } else {
      apply[record.kind]({ entry: null, conflict: null, report: null })
    }
  }

  // Vor der Rueckfrage: erfasst den Datensatz, wie er JETZT gespeichert ist (Metadaten + Byte-Kopie). Weicht er von dem
  // ab, was die Oberflaeche zeigt (ein anderer Tab war schneller), wird keine Rueckfrage geoeffnet, sondern die Anzeige
  // aktualisiert und gemeldet. Rueckgabe: { snapshot } | { changed: true } | { gone: true } | { error: true }
  function prepareRemoval(key) {
    return enqueue(async () => {
      const shown = state.records.find((stored) => stored.key === key) ?? state.invalid.find((entry) => entry.key === key) ?? null
      let snapshot
      try {
        snapshot = await persistence.prepareRemoval(key)
      } catch {
        if (disposed) return { error: true }
        state.notice = 'Die gespeicherte Bibliothek konnte nicht gelesen werden. Es wurde nichts entfernt. Bitte versuche es noch einmal.'
        state.noticeIsError = true
        return { error: true }
      }
      if (disposed) return { error: true }
      if (!snapshot) {
        state.notice = 'Diese gespeicherte Bibliothek ist nicht mehr vorhanden (zum Beispiel in einem anderen Tab entfernt). Die Anzeige ist aktualisiert.'
        state.noticeIsError = false
        await refreshFromStore()
        return { gone: true }
      }
      if (shown && !identitiesMatch(shown, snapshot)) {
        state.notice = 'Diese gespeicherte Bibliothek wurde in der Zwischenzeit geändert (zum Beispiel in einem anderen Tab). Die Anzeige ist aktualisiert; prüfe den aktuellen Stand, bevor du sie entfernst.'
        state.noticeIsError = true
        await refreshFromStore()
        return { changed: true }
      }
      return { snapshot }
    })
  }

  // `snapshot`: der vom Nutzer bestaetigte Datensatz (aus prepareRemoval). Entfernt wird nur genau dieser Inhalt; die
  // Meldung "entfernt" erscheint erst, wenn der Speicher den Vorgang bestaetigt hat.
  async function doRemove(key, snapshot) {
    const known = state.records.find((stored) => stored.key === key) ?? state.invalid.find((entry) => entry.key === key)?.record ?? null
    if (!snapshot) {
      state.notice = 'Die Bestätigung ist nicht mehr gültig. Es wurde nichts entfernt. Bitte starte das Entfernen noch einmal.'
      state.noticeIsError = true
      await refreshFromStore()
      return false
    }

    let result
    try {
      result = await persistence.remove(key, snapshot)
    } catch {
      if (disposed) return false
      state.notice = 'Die gespeicherte Bibliothek konnte nicht entfernt werden. Sie ist weiterhin gespeichert. Bitte versuche es noch einmal.'
      state.noticeIsError = true
      return false
    }

    if (disposed) return false
    if (result.outcome === REMOVE_OUTCOME.CHANGED) {
      state.notice =
        'Diese gespeicherte Bibliothek wurde in der Zwischenzeit geändert (zum Beispiel in einem anderen Tab) und deshalb NICHT entfernt. Prüfe den aktuellen Stand in der Liste und entferne sie bei Bedarf erneut.'
      state.noticeIsError = true
      await refreshFromStore()
      return false
    }

    state.records = state.records.filter((stored) => stored.key !== key)
    state.invalid = state.invalid.filter((entry) => entry.key !== key)
    state.saveProblems = state.saveProblems.filter((problem) => problem.key !== key)
    state.saveRejections = state.saveRejections.filter((rejection) => rejection.key !== key)
    // Nur die aus diesem Speicher stammende, aktive Bibliothek wird deaktiviert; Lernfortschritt bleibt unberuehrt.
    if (known?.kind && isActive(known)) deactivate(known)
    state.notice =
      result.outcome === REMOVE_OUTCOME.GONE
        ? 'Diese gespeicherte Bibliothek war bereits entfernt (zum Beispiel in einem anderen Tab). Dein Lernfortschritt bleibt erhalten.'
        : 'Gespeicherte Bibliothek entfernt. Dein Lernfortschritt bleibt erhalten; zum erneuten Lernen wähle die Datei wieder aus.'
    state.noticeIsError = false
    sync?.notifyChanged()
    return true
  }

  function remove(key, snapshot) {
    return enqueue(() => doRemove(key, snapshot))
  }

  function dismissMissing(key) {
    persistence.dismissMissing(key)
    state.missing = state.missing.filter((entry) => entry.key !== key)
  }

  function clearNotice() {
    state.notice = ''
    state.noticeIsError = false
  }

  // Aenderungen anderer Instanzen: nur Anzeige neu aus dem Speicher lesen (kein Import, kein Schreiben, kein Zurueckfunken).
  // Mehrere Signale hintereinander werden zu einem Neulesen zusammengefasst.
  let syncQueued = false
  const unsubscribe = sync?.onChange(() => {
    if (disposed || syncQueued) return
    syncQueued = true
    enqueue(async () => {
      syncQueued = false
      if (state.status === 'idle' || state.status === 'loading') return
      try {
        await refreshFromStore({ announce: true })
      } catch {
        // Anzeige bleibt wie sie ist
      }
    })
  })

  function dispose() {
    disposed = true
    unsubscribe?.()
    sync?.close()
  }

  return { state, enqueue, restore, persistOutcomes, remove, prepareRemoval, checkNow, dismissMissing, clearNotice, refreshFromStore, dispose, isActive, importJson: (files, applyFns = apply) => runJsonImport(files, getRegistries, applyFns) }
}
