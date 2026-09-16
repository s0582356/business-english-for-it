<script setup>
import { ref } from 'vue'
import { importLibraryFiles } from '../utils/libraryImport.js'

const props = defineProps({
  currentRegistry: {
    type: Object,
    default: () => ({ libraryByAreaId: {}, conflictsByAreaId: {} }),
  },
})

const emit = defineEmits(['libraries-loaded'])
const fileInput = ref(null)

async function handleFileChange(event) {
  const files = event.target.files
  if (!files || files.length === 0) return

  const result = await importLibraryFiles(files, props.currentRegistry)
  emit('libraries-loaded', result)
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
        Wähle eine oder mehrere private JSON-Dateien aus. Jede Datei wird
        einzeln geprüft und nur im Browser gelesen - nicht hochgeladen und
        nicht gespeichert.
      </p>
    </div>

    <button class="import-button" type="button" @click="openFilePicker">Lernbibliotheken auswählen</button>
    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept=".json,application/json"
      multiple
      @change="handleFileChange"
    />
  </section>
</template>
