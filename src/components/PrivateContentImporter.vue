<script setup>
import { ref } from 'vue'
import { importLibraryFiles } from '../utils/libraryImport.js'
import { loadAudioPacks, splitImportFiles } from '../utils/audioPack.js'
import { EMPTY_COACH_REGISTRY, importCoachFiles, partitionCoachFiles } from '../utils/coachImport.js'
import { EMPTY_FIGURE_REGISTRY, importFigureFiles, partitionFigureFiles } from '../utils/figureImport.js'

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
})

const emit = defineEmits(['libraries-loaded', 'audio-pack-loaded', 'coach-loaded', 'figures-loaded'])
const fileInput = ref(null)

async function handleFileChange(event) {
  const files = event.target.files
  if (!files || files.length === 0) return

  // .zip -> gemeinsames Audio-Pack, alles andere wie bisher -> Lernbibliotheken.
  // Die Libraries werden zuerst und unabhaengig vom Audio-Pack importiert:
  // ein defektes ZIP darf den Library-Import nie beeintraechtigen.
  const { libraryFiles: jsonFiles, audioFiles } = splitImportFiles(files)
  // Lerncoach-Bibliotheken (type "businessEnglishCoach") laufen ueber denselben Dateiwaehler,
  // werden aber getrennt von den Quiz-Bibliotheken importiert.
  const { coachFiles, otherFiles: nonCoachFiles } = await partitionCoachFiles(jsonFiles)
  // Diagramm-Figuren (type "businessEnglishFigures") sind eine eigene optionale Datei; sie wird getrennt
  // importiert, damit ein fehlerhafter Figuren-Import die Quiz-Bibliotheken nie beeintraechtigt.
  const { figureFiles, otherFiles: libraryFiles } = await partitionFigureFiles(nonCoachFiles)

  if (libraryFiles.length > 0) {
    const result = await importLibraryFiles(libraryFiles, props.currentRegistry)
    emit('libraries-loaded', result)
  }
  if (coachFiles.length > 0) {
    emit('coach-loaded', await importCoachFiles(coachFiles, props.currentCoach))
  }
  if (figureFiles.length > 0) {
    try {
      emit('figures-loaded', await importFigureFiles(figureFiles, props.currentFigures))
    } catch (error) {
      const report = { loaded: [], upgrades: [], duplicates: [], ignored: [], conflicts: [], errors: figureFiles.map((file) => ({ fileName: file.name, reason: error?.message || 'Unbekannter Fehler beim Lesen.' })) }
      emit('figures-loaded', { ...props.currentFigures, entry: props.currentFigures.entry ?? null, conflict: props.currentFigures.conflict ?? null, report })
    }
  }
  if (audioFiles.length > 0) {
    emit('audio-pack-loaded', await loadAudioPacks(audioFiles))
  }
  event.target.value = ''
}

function openFilePicker() {
  fileInput.value?.click()
}

defineExpose({ openFilePicker })
</script>

<template>
  <section class="import-card" aria-label="Lernbibliotheken laden">
    <div>
      <h2>Lernbibliotheken laden</h2>
      <p>
        Wähle eine oder mehrere private JSON-Dateien aus (auch die optionale
        Figuren-Datei), bei Bedarf zusammen mit dem Audio-Pack (.zip). Jede Datei wird einzeln geprüft und nur im Browser
        gelesen - nicht hochgeladen und nicht gespeichert.
      </p>
    </div>

    <button class="import-button" type="button" @click="openFilePicker">Lernbibliotheken auswählen</button>
    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept=".json,application/json,.zip,application/zip,application/x-zip-compressed"
      multiple
      @change="handleFileChange"
    />
  </section>
</template>
