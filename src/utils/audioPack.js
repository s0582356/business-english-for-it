// Gemeinsames Audio-Pack (business-english-audio-v1.zip) - nur im Speicher.
//
// Beim Laden wird ausschliesslich das ZIP-Inhaltsverzeichnis gelesen (zip.js
// arbeitet auf der Datei per Blob.slice). Einzelne MP3s werden erst bei
// getBlob(name) gelesen. Nichts wird in IndexedDB/localStorage/Cache gelegt.
// zip.js wird per dynamischem Import nur geladen, wenn tatsaechlich ein ZIP
// gewaehlt wurde - JSON-only-Nutzer zahlen dafuer nichts.

const MP3_TYPE = 'audio/mpeg'

// Klare, interne Fehlerklassen: code unterscheidet Duplikate von sonstigen ZIP-Defekten.
export class AudioPackError extends Error {
  constructor(code, message, details = []) {
    super(message)
    this.name = 'AudioPackError'
    this.code = code
    this.details = details
  }
}

function describeNames(names) {
  const shown = names.slice(0, 5).join(', ')
  return names.length > 5 ? `${shown} (+${names.length - 5} weitere)` : shown
}

export function isAudioPackFile(file) {
  const name = typeof file?.name === 'string' ? file.name.toLowerCase() : ''
  const type = typeof file?.type === 'string' ? file.type.toLowerCase() : ''
  return name.endsWith('.zip') || type === 'application/zip' || type === 'application/x-zip-compressed'
}

export function splitImportFiles(files) {
  const libraryFiles = []
  const audioFiles = []
  for (const file of [...files]) (isAudioPackFile(file) ? audioFiles : libraryFiles).push(file)
  return { libraryFiles, audioFiles }
}

// Wrapper um ein ZIP-Reader-Objekt: has(name) / getBlob(name) / fileCount.
export function createAudioPack({ fileName, entries, close }) {
  return {
    fileName,
    fileCount: entries.size,
    has: (name) => entries.has(name),
    names: () => [...entries.keys()],
    getBlob: async (name) => {
      const read = entries.get(name)
      return read ? read() : null
    },
    close: async () => { try { await close?.() } catch { /* nichts zu tun */ } },
  }
}

// Dateinamen, die in mehr als einem Pack vorkommen: { name -> [Pack-Dateinamen] }.
export function findCrossPackDuplicates(packs) {
  const owners = new Map()
  for (const pack of packs) for (const name of pack.names()) owners.set(name, [...(owners.get(name) ?? []), pack.fileName])
  return new Map([...owners].filter(([, packNames]) => packNames.length > 1))
}

// Kombiniert mehrere Packs (z. B. spaeter eines pro Bereich) zu einem.
// Gemeinsame Dateinamen werden NIE still aufgeloest (kein first/last wins): sie sind ein Fehler.
export function combineAudioPacks(packs) {
  const duplicates = findCrossPackDuplicates(packs)
  if (duplicates.size > 0) {
    throw new AudioPackError('duplicate-across-packs', `Audio-Dateinamen kommen in mehreren Packs vor: ${describeNames([...duplicates.keys()])}`, [...duplicates.keys()])
  }
  if (packs.length === 1) return packs[0]
  return {
    fileName: packs.map((pack) => pack.fileName).join(', '),
    fileCount: packs.reduce((sum, pack) => sum + pack.fileCount, 0),
    has: (name) => packs.some((pack) => pack.has(name)),
    names: () => packs.flatMap((pack) => pack.names()),
    getBlob: async (name) => {
      const owner = packs.find((pack) => pack.has(name))
      return owner ? owner.getBlob(name) : null
    },
    close: async () => { await Promise.all(packs.map((pack) => pack.close())) },
  }
}

export async function openAudioPack(file) {
  const { ZipReader, BlobReader, Uint8ArrayWriter, configure } = await import('@zip.js/zip.js')
  configure({ useWebWorkers: false })

  const reader = new ZipReader(new BlobReader(file))
  try {
    const zipEntries = await reader.getEntries()
    const entries = new Map()
    const duplicates = new Set()
    for (const entry of zipEntries) {
      if (entry.directory) continue
      // Nur der Basisname zaehlt (auch wenn Files/macOS einen Ordner anlegt);
      // Metadaten wie __MACOSX/._name.mp3 werden ignoriert.
      const baseName = entry.filename.split('/').pop()
      if (!baseName || baseName.startsWith('.') || !baseName.toLowerCase().endsWith('.mp3')) continue
      // Derselbe Basisname mehrfach (auch aus verschiedenen Ordnern) ist mehrdeutig: nichts wird still ueberschrieben.
      if (entries.has(baseName)) { duplicates.add(baseName); continue }
      entries.set(baseName, async () => new Blob([await entry.getData(new Uint8ArrayWriter())], { type: MP3_TYPE }))
    }
    if (duplicates.size > 0) {
      throw new AudioPackError('duplicate-entries', `Audio-Pack "${file.name}" enthaelt doppelte Audio-Dateinamen: ${describeNames([...duplicates])}`, [...duplicates])
    }
    return createAudioPack({ fileName: file.name, entries, close: () => reader.close() })
  } catch (error) {
    await reader.close().catch(() => {})
    throw error
  }
}

const GENERIC_PACK_ERROR = 'Audio-Pack konnte nicht gelesen werden (ZIP defekt?).'

// Laedt alle gewaehlten ZIPs. Wirft nie: ungueltige ZIPs landen im Report.
// Ungueltig sind defekte ZIPs, ZIPs mit doppelten Audio-Dateinamen und ZIPs, deren Dateinamen sich mit
// einem anderen gewaehlten Pack ueberschneiden (dann werden ALLE beteiligten Packs abgelehnt, damit das
// Ergebnis nicht von der Auswahlreihenfolge abhaengt).
export async function loadAudioPacks(files) {
  const opened = []
  const report = { loaded: [], errors: [] }
  for (const file of files) {
    try {
      opened.push(await openAudioPack(file))
    } catch (error) {
      const duplicate = error instanceof AudioPackError && error.code === 'duplicate-entries'
      report.errors.push({
        fileName: file.name,
        code: duplicate ? 'duplicate-entries' : 'unreadable',
        reason: duplicate ? `Audio-Pack ungültig: ${error.details.length} doppelte Audio-Dateinamen im ZIP.` : GENERIC_PACK_ERROR,
        detail: error instanceof AudioPackError ? error.message : undefined,
      })
    }
  }

  const duplicates = findCrossPackDuplicates(opened)
  const rejected = new Set()
  for (const packNames of duplicates.values()) for (const name of packNames) rejected.add(name)
  const accepted = []
  for (const pack of opened) {
    if (rejected.has(pack.fileName)) {
      const clashes = [...duplicates].filter(([, packNames]) => packNames.includes(pack.fileName))
      report.errors.push({
        fileName: pack.fileName,
        code: 'duplicate-across-packs',
        reason: `Audio-Pack ungültig: ${clashes.length} Audio-Dateinamen kommen auch in einem anderen gewählten Pack vor.`,
        detail: `Audio-Dateinamen kommen in mehreren Packs vor: ${describeNames(clashes.map(([name]) => name))}`,
      })
      await pack.close()
    } else {
      accepted.push(pack)
      report.loaded.push({ fileName: pack.fileName, fileCount: pack.fileCount })
    }
  }
  return { pack: accepted.length ? combineAudioPacks(accepted) : null, report }
}
