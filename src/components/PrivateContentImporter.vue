<script setup>
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { loadAudioPacks, splitImportFiles } from '../utils/audioPack.js'
import { EMPTY_COACH_REGISTRY } from '../utils/coachImport.js'
import { EMPTY_FIGURE_REGISTRY } from '../utils/figureImport.js'
import { EMPTY_SPEAKING_REGISTRY } from '../utils/speakingImport.js'
import { createPrivateLibraryController, storeProblemText } from '../utils/privateLibraryController.js'
import { KIND_LABELS } from '../utils/privateLibraryPersistence.js'

const props = defineProps({
  currentRegistry: {
    type: Object,
    default: () => ({ libraryByAreaId: {}, conflictsByAreaId: {} }),
  },
  currentCoach: {
    type: Object,
    default: () => EMPTY_COACH_REGISTRY,
  },
  currentFigures: {
    type: Object,
    default: () => EMPTY_FIGURE_REGISTRY,
  },
  currentSpeaking: {
    type: Object,
    default: () => EMPTY_SPEAKING_REGISTRY,
  },
  // Die App stellt einen App-weiten Controller bereit (Wiederherstellen beim Start, lokale Speicherung).
  // Ohne ihn arbeitet der Importer eigenstaendig und meldet Ergebnisse wie bisher ueber Events.
  controller: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['libraries-loaded', 'audio-pack-loaded', 'coach-loaded', 'figures-loaded', 'speaking-loaded'])
const fileInput = ref(null)

const controller =
  props.controller ??
  createPrivateLibraryController({
    getRegistries: () => ({ quiz: props.currentRegistry, coach: props.currentCoach, figures: props.currentFigures, speaking: props.currentSpeaking }),
    apply: {
      quiz: (result) => emit('libraries-loaded', result),
      coach: (result) => emit('coach-loaded', result),
      figures: (result) => emit('figures-loaded', result),
      speaking: (result) => emit('speaking-loaded', result),
    },
  })
const stored = controller.state

// Auswahlen werden nacheinander verarbeitet: Jeder Import rechnet gegen den Stand, den die vorherige Auswahl
// hinterlassen hat. So kann eine langsame aeltere Auswahl keine neuere ueberschreiben oder mit veraltetem
// Registry-Stand entscheiden (Reihenfolge der Auswahlen = Reihenfolge der Wirkung). Die Warteschlange gehoert dem
// Controller, damit auch das Wiederherstellen beim Start und das Entfernen gespeicherter Bibliotheken eingereiht sind.
function handleFileChange(event) {
  const input = event.target
  const files = [...(input.files ?? [])]
  if (files.length === 0) return undefined
  return controller.enqueue(() => processFiles(files, input))
}

async function processFiles(files, input) {
  // .zip -> gemeinsames Audio-Pack, alles andere wie bisher -> Lernbibliotheken.
  // Die Libraries werden zuerst und unabhaengig vom Audio-Pack importiert:
  // ein defektes ZIP darf den Library-Import nie beeintraechtigen.
  // Audio-Pakete (.zip) speichert die App getrennt von den JSON-Bibliotheken (audioPackStore.js, siehe App.vue).
  controller.clearNotice()
  const { libraryFiles: jsonFiles, audioFiles } = splitImportFiles(files)
  const outcomes = await controller.importJson(jsonFiles)
  if (audioFiles.length > 0) {
    emit('audio-pack-loaded', { ...(await loadAudioPacks(audioFiles)), files: audioFiles })
  }
  // Erst nach der Aktivierung lokal speichern: ein Speicherproblem beeintraechtigt den Import nie.
  await controller.persistOutcomes(outcomes)
  // Die Eltern-Komponente uebernimmt die Ergebnisse im naechsten Tick; erst danach darf die naechste Auswahl rechnen.
  await nextTick()
  input.value = ''
}

function openFilePicker() {
  fileInput.value?.click()
}

defineExpose({ openFilePicker })

// ---- Anzeige der lokal gespeicherten Bibliotheken ----
// shallowRef: der Snapshot enthaelt eine Byte-Kopie der Bibliothek und soll nicht reaktiv eingewickelt werden.
const confirm = shallowRef(null)
// Elemente fuer die Fokusfuehrung (Vue-Template-Refs; Zeilen-Buttons ueber Funktions-Refs je Schluessel).
const importButton = ref(null)
const checkButton = ref(null)
const removeButtons = new Map()
const cancelButtons = new Map()
const trackRef = (map, key) => (element) => {
  if (element) map.set(key, element)
  else map.delete(key)
}
const isAsking = (key) => confirm.value?.key === key

const hasStoredEntries = computed(() => stored.records.length + stored.invalid.length + stored.missing.length > 0)
const unavailable = computed(() => stored.status === 'unavailable')

function labelOf(record) {
  const kind = KIND_LABELS[record.kind] ?? 'Bibliothek'
  const name = record.areaTitle || record.areaId
  return name ? `${kind}: ${name}` : kind
}

function sizeText(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function dateText(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''
}

function activeVersionOf(record) {
  if (record.kind === 'quiz') return props.currentRegistry.libraryByAreaId?.[record.areaId]?.library.libraryVersion ?? null
  const registry = { coach: props.currentCoach, figures: props.currentFigures, speaking: props.currentSpeaking }[record.kind]
  return registry?.entry?.library.libraryVersion ?? null
}

function rejectionText(rejection) {
  const name = rejection.fileName ? `„${rejection.fileName}“` : 'Die Datei'
  if (rejection.outcome === 'stale') {
    return `${name} (Version ${rejection.incomingVersion}) wurde nicht gespeichert: Auf diesem Gerät ist bereits eine neuere Version (${rejection.storedVersion}) gespeichert, vermutlich aus einem anderen Tab. Der neuere Stand bleibt unverändert.`
  }
  return `${name} (Version ${rejection.incomingVersion}) wurde nicht gespeichert: Es gibt bereits eine gespeicherte Bibliothek mit derselben Version, aber anderem Inhalt (oder anderer Bibliotheks-ID). Es wurde nichts überschrieben. Entferne die gespeicherte Bibliothek oder importiere eine höhere Version.`
}

// Zwei getrennte Aussagen: "In dieser Sitzung" (aktive Bibliothek dieser Ansicht) und "Auf diesem Gerät gespeichert"
// (zuletzt aus IndexedDB gelesen, siehe lastCheckedAt). Das Haekchen gilt nur der aktiven Sitzung.
function statusOf(record) {
  if (controller.isActive(record)) return { ready: true, text: `In dieser Sitzung einsatzbereit – Version ${record.libraryVersion}` }
  const reason = stored.restoreErrors[record.fileName]
  if (reason) return { ready: false, text: `Nicht nutzbar: ${reason} Bitte importiere die Datei erneut.` }
  const activeVersion = activeVersionOf(record)
  if (activeVersion !== null && activeVersion !== record.libraryVersion) {
    return { ready: false, text: `In dieser Sitzung ist Version ${activeVersion} aktiv, auf diesem Gerät gespeichert ist Version ${record.libraryVersion}. Die laufende Sitzung bleibt unverändert; beim nächsten Start gilt die gespeicherte Version.` }
  }
  return { ready: false, text: 'In dieser Sitzung nicht aktiv (zum Beispiel wegen eines Konflikts oder weil sie noch nicht geladen wurde).' }
}

const rows = computed(() =>
  stored.records.map((record) => ({ record, label: labelOf(record), status: statusOf(record) })),
)

// Loeschbestaetigung fuer gueltige UND beschaedigte Eintraege. Vor der Rueckfrage erfasst der Controller den Datensatz
// samt tatsaechlichen Bytes; entfernt wird nur genau dieser Inhalt. Hat ein anderer Tab ihn inzwischen veraendert,
// oeffnet sich keine Rueckfrage bzw. er bleibt erhalten, und die Anzeige wird aktualisiert.
async function askRemove(key) {
  const prepared = await controller.prepareRemoval(key)
  if (!prepared.snapshot) return // Fokus bleibt auf dem Entfernen-Button (er wird nicht ersetzt)
  confirm.value = { key, snapshot: prepared.snapshot }
  // Der Entfernen-Button wird durch die Rueckfrage ersetzt: Fokus auf den ungefaehrlichen "Abbrechen"-Button setzen,
  // damit Tastatur- und Screenreader-Nutzer nicht den Faden verlieren.
  await nextTick()
  cancelButtons.get(key)?.focus()
}

async function cancelRemove() {
  const key = confirm.value?.key
  confirm.value = null
  await nextTick()
  if (key) removeButtons.get(key)?.focus() // zurueck zum ausloesenden Button
}

async function confirmRemove() {
  const pending = confirm.value
  confirm.value = null
  if (!pending) return
  const removed = await controller.remove(pending.key, pending.snapshot)
  await nextTick()
  // Nach Erfolg existiert die Zeile nicht mehr: auf ein vorhandenes, sinnvolles Element ausweichen. Nach einem Fehler
  // steht der Entfernen-Button der Zeile wieder bereit (keine Fokusfalle); ist er nicht mehr da, gilt dasselbe Ausweichziel.
  const target = (!removed && removeButtons.get(pending.key)) || checkButton.value || importButton.value
  target?.focus()
}

// Beim (erneuten) Anzeigen des Speicherbereichs den tatsaechlichen Speicherstand neu lesen, statt einen alten
// Anzeigestand zu behaupten (der Importer wird bei jeder Rueckkehr zur Startansicht neu eingehaengt). Beim App-Start
// ist der Controller noch nicht bereit; dort uebernimmt das Wiederherstellen die erste Pruefung.
onMounted(() => {
  controller.checkNow()
})

function timeText(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''
}

const checkedLine = computed(() => {
  if (stored.status !== 'ready' && !hasStoredEntries.value) return ''
  if (!Number.isFinite(stored.lastCheckedAt)) return 'Der gespeicherte Stand wurde noch nicht geprüft.'
  const at = timeText(stored.lastCheckedAt)
  return stored.checkFailed
    ? `Der gespeicherte Stand konnte zuletzt nicht geprüft werden. Angezeigt ist der Stand von ${at} Uhr.`
    : `Gespeicherter Stand zuletzt geprüft um ${at} Uhr.`
})
</script>

<template>
  <div class="private-import">
    <section class="import-card" aria-label="Lernbibliotheken laden">
      <div>
        <h2>Lernbibliotheken laden</h2>
        <p>
          Wähle eine oder mehrere private JSON-Dateien aus (auch die optionale
          Figuren- und Sprech-Datei), bei Bedarf zusammen mit dem Audio-Pack (.zip). Jede Datei wird einzeln geprüft und nur im Browser
          gelesen - nicht hochgeladen. Gültige JSON-Bibliotheken merkt sich die App zusätzlich
          nur auf diesem Gerät, ebenso gültige Audio-Packs (.zip).
        </p>
      </div>

      <button ref="importButton" class="import-button" type="button" @click="openFilePicker">Lernbibliotheken auswählen</button>
      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept=".json,application/json,.zip,application/zip,application/x-zip-compressed"
        multiple
        @change="handleFileChange"
      />
    </section>

    <section class="stored-libraries" aria-label="Auf diesem Gerät gespeicherte Bibliotheken" data-stored-libraries>
      <h3>Auf diesem Gerät gespeichert</h3>

      <!-- Nicht kritische Statusmeldungen: dauerhaft vorhandener, hoeflicher Live-Bereich (role="status"). -->
      <div class="stored-live" role="status" aria-live="polite" aria-atomic="true">
        <p v-if="stored.status === 'loading'" class="stored-note" data-stored-state="loading">Gespeicherte Bibliotheken werden geladen …</p>
        <p v-else-if="unavailable" class="stored-warning" data-stored-state="unavailable">
          Dein Browser erlaubt hier kein lokales Speichern (zum Beispiel im privaten Modus).
          Importierte Bibliotheken gelten nur, bis du die App schließt, und müssen beim nächsten Start erneut gewählt werden.
        </p>
        <p v-else-if="stored.status === 'error'" class="stored-warning" data-stored-state="error">
          Der lokale Speicher konnte nicht gelesen werden. Wähle deine Dateien bei Bedarf erneut aus.
        </p>
        <p v-else-if="!hasStoredEntries" class="stored-note" data-stored-state="empty">
          Noch keine Bibliothek gespeichert. Nach einem erfolgreichen Import bleibt sie auf diesem Gerät erhalten und
          steht beim nächsten Öffnen der App automatisch wieder bereit.
        </p>
        <p v-if="stored.notice && !stored.noticeIsError" class="stored-note" data-stored-notice>{{ stored.notice }}</p>
      </div>

      <!-- Kritische Fehlermeldungen: role="alert" (je Meldung genau einmal, erscheint nur bei Auftreten). -->
      <p v-if="stored.notice && stored.noticeIsError" class="stored-warning" role="alert" data-stored-notice>{{ stored.notice }}</p>
      <p v-for="problem in stored.saveProblems" :key="'save-' + problem.key + problem.fileName" class="stored-warning" role="alert" data-stored-save-problem>
        {{ problem.fileName ? `„${problem.fileName}“ ist geladen, wurde aber nicht gespeichert.` : 'Die Bibliothek wurde nicht gespeichert.' }}
        {{ storeProblemText(problem.code) }}
        Sie gilt nur, bis du die App schließt; eine zuvor gespeicherte Fassung bleibt unverändert erhalten.
      </p>
      <p v-for="rejection in stored.saveRejections" :key="'reject-' + rejection.key + rejection.fileName" class="stored-warning" role="alert" data-stored-rejection>
        {{ rejectionText(rejection) }}
      </p>

      <div v-if="checkedLine" class="stored-checked" data-stored-checked>
        <span>{{ checkedLine }}</span>
        <button ref="checkButton" class="secondary-button stored-check-button" type="button" data-stored-check @click="controller.checkNow()">Neu prüfen</button>
      </div>

      <ul v-if="rows.length" class="stored-list">
        <li v-for="row in rows" :key="row.record.key" class="stored-item" :data-stored-key="row.record.key">
          <div class="stored-main">
            <strong class="stored-label">{{ row.label }}</strong>
            <span class="stored-meta">
              Auf diesem Gerät gespeichert – Version {{ row.record.libraryVersion }} · {{ row.record.fileName }} · {{ sizeText(row.record.size) }}
              <template v-if="dateText(row.record.savedAt)"> · gespeichert am {{ dateText(row.record.savedAt) }}</template>
            </span>
            <span :class="row.status.ready ? 'stored-status stored-status-ready' : 'stored-status stored-status-problem'" data-stored-status>
              {{ row.status.ready ? '✓ ' : '⚠ ' }}{{ row.status.text }}
            </span>
          </div>
          <div class="stored-actions">
            <button v-if="!isAsking(row.record.key)" :ref="trackRef(removeButtons, row.record.key)" class="secondary-button" type="button" data-stored-remove @click="askRemove(row.record.key)">
              Gespeicherte Bibliothek entfernen
            </button>
            <template v-else>
              <span class="stored-confirm-text" role="alert">Möchtest du diese lokal gespeicherte Bibliothek wirklich entfernen? Dein Lernfortschritt bleibt erhalten.</span>
              <button class="primary-button" type="button" data-stored-remove-confirm @click="confirmRemove">Ja, entfernen</button>
              <button :ref="trackRef(cancelButtons, row.record.key)" class="secondary-button" type="button" data-stored-remove-cancel @click="cancelRemove">Abbrechen</button>
            </template>
          </div>
        </li>
      </ul>

      <ul v-if="stored.invalid.length" class="stored-list">
        <li v-for="entry in stored.invalid" :key="'invalid-' + entry.key" class="stored-item" data-stored-invalid>
          <div class="stored-main">
            <strong class="stored-label">{{ entry.record ? labelOf(entry.record) : 'Gespeicherter Eintrag' }}</strong>
            <span class="stored-status stored-status-problem">⚠ {{ entry.reason }} Bitte importiere die JSON-Datei erneut oder entferne den Eintrag.</span>
          </div>
          <div class="stored-actions">
            <button v-if="!isAsking(entry.key)" :ref="trackRef(removeButtons, entry.key)" class="secondary-button" type="button" data-stored-remove @click="askRemove(entry.key)">
              Gespeicherte Bibliothek entfernen
            </button>
            <template v-else>
              <span class="stored-confirm-text" role="alert">Möchtest du diese lokal gespeicherte Bibliothek wirklich entfernen? Dein Lernfortschritt bleibt erhalten.</span>
              <button class="primary-button" type="button" data-stored-remove-confirm @click="confirmRemove">Ja, entfernen</button>
              <button :ref="trackRef(cancelButtons, entry.key)" class="secondary-button" type="button" data-stored-remove-cancel @click="cancelRemove">Abbrechen</button>
            </template>
          </div>
        </li>
      </ul>

      <ul v-if="stored.missing.length" class="stored-list">
        <li v-for="entry in stored.missing" :key="'missing-' + entry.key" class="stored-item" data-stored-missing>
          <div class="stored-main">
            <strong class="stored-label">{{ entry.kind ? labelOf(entry) : 'Gespeicherte Bibliothek' }}</strong>
            <span class="stored-status stored-status-problem">
              ⚠ Nicht mehr auf diesem Gerät vorhanden{{ entry.fileName ? ` (${entry.fileName})` : '' }}. Dein Browser oder iOS hat lokale
              Daten entfernt. Bitte wähle die JSON-Datei erneut aus.
            </span>
          </div>
          <div class="stored-actions">
            <button class="secondary-button" type="button" data-stored-dismiss @click="controller.dismissMissing(entry.key)">Hinweis ausblenden</button>
          </div>
        </li>
      </ul>

      <div class="stored-fineprint" data-stored-persistence>
        <p class="stored-hint" data-stored-ios-hint>
          Auf dem iPhone können Safari und eine zum Home-Bildschirm hinzugefügte Web-App getrennte lokale Speicher verwenden.
          Falls deine Lernbibliotheken dort fehlen, importiere sie in dieser Ansicht einmal erneut.
        </p>
        <ul class="stored-facts">
          <li>Gespeicherte JSON-Bibliotheken haben keine automatische Ablauffrist.</li>
          <li>Der Browser oder das Betriebssystem kann Website-Daten trotzdem entfernen (zum Beispiel bei Speicherknappheit oder längerer Nichtnutzung). Eine garantierte Aufbewahrung von mindestens 30 Tagen ist technisch nicht möglich.</li>
          <li>Die Dateien bleiben nur auf diesem Gerät. Die App speichert private Dateien nicht auf Render und lädt sie nirgendwohin hoch.</li>
          <li v-if="stored.persisted === true">Der Browser hat zugesagt, die Daten nicht automatisch zu bereinigen.</li>
        </ul>
      </div>
    </section>
  </div>
</template>

<style scoped>
.private-import {
  display: grid;
  gap: 12px;
}

.stored-libraries {
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
}

.stored-libraries h3 {
  margin: 0 0 8px;
  font-size: 0.95rem;
}

.stored-note,
.stored-warning {
  margin: 6px 0;
  line-height: 1.5;
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.stored-note {
  color: var(--color-text-secondary);
}

.stored-warning {
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--color-warning);
  background: var(--color-warning-bg);
}

.stored-checked {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin: 6px 0 10px;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  line-height: 1.4;
}

.stored-check-button {
  margin: 0;
  padding: 8px 12px;
  min-height: 44px;
}

.stored-fineprint {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  line-height: 1.5;
}

.stored-hint {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-surface-alt);
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.stored-facts {
  margin: 0;
  padding-left: 1.1em;
  display: grid;
  gap: 4px;
  overflow-wrap: anywhere;
}

.stored-list {
  display: grid;
  gap: 10px;
  margin: 8px 0;
  padding: 0;
  list-style: none;
}

.stored-item {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface-alt);
}

.stored-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.stored-meta {
  color: var(--color-text-secondary);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.stored-status {
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.stored-status-ready {
  color: var(--color-success);
  font-weight: 700;
}

.stored-status-problem {
  color: var(--color-warning);
}

.stored-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.stored-actions .primary-button,
.stored-actions .secondary-button {
  margin: 0;
  padding: 10px 14px;
}

.stored-confirm-text {
  flex: 1 1 100%;
  font-size: 0.9rem;
}

@media (max-width: 640px) {
  .stored-actions .primary-button,
  .stored-actions .secondary-button {
    flex: 1 1 100%;
  }
}
</style>
