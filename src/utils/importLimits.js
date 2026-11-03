// Groessenlimits fuer private JSON-Dateien. Die Pruefung nutzt file.size und passiert VOR jedem Lesen
// (file.text()) und Parsen, damit auch sehr grosse Dateien nie in den Speicher geladen werden.
//
// Das uebergreifende Limit liegt weit ueber allen vorhandenen Bibliotheken (die groesste hat rund 130 KB);
// Figuren-Dateien haben zusaetzlich ein eigenes, kleineres Limit (FIGURE_LIMITS.fileBytes).
export const MAX_JSON_FILE_BYTES = 5 * 1024 * 1024

export function isOversizedFile(file, limit = MAX_JSON_FILE_BYTES) {
  return typeof file?.size === 'number' && file.size > limit
}

export function oversizeReason(limit = MAX_JSON_FILE_BYTES) {
  const text = limit >= 1024 * 1024 ? `${Math.round((limit / (1024 * 1024)) * 10) / 10} MB` : `${Math.round(limit / 1024)} KB`
  return `Datei ist zu groß (höchstens ${text}).`
}
