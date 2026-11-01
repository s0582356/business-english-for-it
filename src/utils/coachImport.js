// Import der privaten Lerncoach-Bibliothek ueber denselben Dateiwaehler wie die
// Quiz-Bibliotheken. Dateien werden nur im Browser gelesen und nur im Speicher
// gehalten. Versionsvergleich, Duplikat- und Konfliktregeln sind dieselben wie
// bei den Quiz-Bibliotheken (classifyIncomingLibrary).

import { fingerprintFile } from './fingerprint.js'
import { classifyIncomingLibrary } from './libraryImport.js'
import { isCoachLibraryData, validateCoachLibrary } from './coachLibrary.js'

export const EMPTY_COACH_REGISTRY = Object.freeze({ entry: null, conflict: null })

// Trennt Lerncoach-Dateien von allen anderen Dateien (am "type" im JSON).
// Nicht lesbare Dateien gehen an den normalen Import, der den Fehler meldet.
export async function partitionCoachFiles(files) {
  const coachFiles = []
  const otherFiles = []
  for (const file of [...files]) {
    let isCoach = false
    try {
      isCoach = isCoachLibraryData(JSON.parse(await file.text()))
    } catch {
      isCoach = false
    }
    ;(isCoach ? coachFiles : otherFiles).push(file)
  }
  return { coachFiles, otherFiles }
}

// Entscheidet ueber den GESAMTEN Import-Batch statt Datei fuer Datei, damit das Ergebnis nicht von der
// Reihenfolge abhaengt (A / abweichendes B / A darf nicht doch A aktivieren):
//   1. Jede Datei wird einzeln geprueft (Fehler betreffen nur diese Datei).
//   2. Inhaltsgleiche Dateien (gleicher Fingerabdruck, auch zur geladenen Bibliothek) sind Duplikate.
//   3. Bleiben mehrere verschiedene Kandidaten uebrig, widersprechen sich diese, wenn sie unterschiedliche
//      libraryId haben oder bei gleicher libraryId die hoechste Version mit verschiedenem Inhalt teilen.
//      Dann wird KEINER der widersprechenden Kandidaten aktiv; eine zuvor geladene Bibliothek bleibt
//      unveraendert aktiv. Kandidaten mit niedrigerer Version werden als aelter ignoriert.
//   4. Ein einzelner uebrig bleibender Kandidat wird wie bisher gegen die geladene Bibliothek geprueft
//      (Laden, Upgrade, aelter ignoriert, Konflikt mit der geladenen Bibliothek).
export async function importCoachFiles(files, currentRegistry = EMPTY_COACH_REGISTRY) {
  const existing = currentRegistry.entry ?? null
  let entry = existing
  let conflict = currentRegistry.conflict ?? null
  const report = { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: [] }

  const candidates = []
  for (const file of [...files]) {
    let library
    try {
      library = validateCoachLibrary(JSON.parse(await file.text()))
    } catch (error) {
      report.errors.push({ fileName: file.name, reason: error instanceof SyntaxError ? 'Datei ist kein gültiges JSON.' : error.message })
      continue
    }
    candidates.push({ library, fileName: file.name, fingerprint: await fingerprintFile(file) })
  }

  const infoOf = (candidate) => ({ fileName: candidate.fileName, areaId: candidate.library.areaId, libraryVersion: candidate.library.libraryVersion })
  const unique = []
  for (const candidate of candidates) {
    const isDuplicate = existing?.fingerprint === candidate.fingerprint || unique.some((other) => other.fingerprint === candidate.fingerprint)
    if (isDuplicate) report.duplicates.push(infoOf(candidate))
    else unique.push(candidate)
  }
  if (unique.length === 0) return { entry, conflict, report }

  const libraryIds = new Set(unique.map((candidate) => candidate.library.libraryId))
  const topVersion = Math.max(...unique.map((candidate) => candidate.library.libraryVersion))
  const newest = unique.filter((candidate) => candidate.library.libraryVersion === topVersion)
  let contradiction = null
  if (libraryIds.size > 1) contradiction = { reason: 'different-library-id', members: unique }
  else if (newest.length > 1) contradiction = { reason: 'same-version-different-fingerprint', members: newest }

  if (contradiction) {
    for (const member of contradiction.members) report.conflicts.push({ ...infoOf(member), reason: contradiction.reason, keptExisting: Boolean(existing) })
    if (libraryIds.size === 1) {
      for (const older of unique.filter((candidate) => !newest.includes(candidate))) report.ignored.push(infoOf(older))
    }
    if (!existing) {
      conflict = {
        areaId: contradiction.members[0].library.areaId,
        reason: contradiction.reason,
        candidates: contradiction.members.map((member) => ({ fileName: member.fileName, libraryId: member.library.libraryId, libraryVersion: member.library.libraryVersion })),
      }
    }
    return { entry, conflict, report }
  }

  const incoming = newest[0]
  for (const older of unique.filter((candidate) => candidate !== incoming)) report.ignored.push(infoOf(older))
  const classification = classifyIncomingLibrary(existing, incoming)
  const info = infoOf(incoming)

  if (classification.action === 'load' || classification.action === 'upgrade') {
    entry = incoming
    conflict = null
    report[classification.action === 'upgrade' ? 'upgrades' : 'loaded'].push(info)
  } else if (classification.action === 'ignore-older') {
    report.ignored.push(info)
  } else {
    // Konflikt zwischen der geladenen und der neuen Bibliothek: wie bei den Quiz-Bibliotheken bleibt keine aktiv.
    conflict = {
      areaId: incoming.library.areaId,
      reason: classification.reason,
      candidates: [
        { fileName: existing.fileName, libraryId: existing.library.libraryId, libraryVersion: existing.library.libraryVersion },
        { fileName: incoming.fileName, libraryId: incoming.library.libraryId, libraryVersion: incoming.library.libraryVersion },
      ],
    }
    entry = null
    report.conflicts.push({ ...info, reason: classification.reason, keptExisting: false })
  }

  return { entry, conflict, report }
}
