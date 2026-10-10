<script setup>
import { ref } from 'vue'
import { importLibraryFiles } from '../utils/libraryImport.js'
import { loadAudioPacks, splitImportFiles } from '../utils/audioPack.js'

const props = defineProps({
  currentRegistry: {
    type: Object,
    default: () => ({ libraryByAreaId: {}, conflictsByAreaId: {} }),
  },
})

const emit = defineEmits(['libraries-loaded', 'audio-pack-loaded'])
const fileInput = ref(null)

async function handleFileChange(event) {
  const files = event.target.files
  if (!files || files.length === 0) return

  // .zip -> gemeinsames Audio-Pack, alles andere wie bisher -> Lernbibliotheken.
  // Die Libraries werden zuerst und unabhaengig vom Audio-Pack importiert:
  // ein defektes ZIP darf den Library-Import nie beeintraechtigen.
  const { libraryFiles, audioFiles } = splitImportFiles(files)

  if (libraryFiles.length > 0) {
    const result = await importLibraryFiles(libraryFiles, props.currentRegistry)
    emit('libraries-loaded', result)
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
        Wähle eine oder mehrere private JSON-Dateien aus, bei Bedarf zusammen mit
        dem Audio-Pack (.zip). Jede Datei wird einzeln geprüft und nur im Browser
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
