<script setup>
import { ref } from 'vue'
import { fingerprintFile } from '../utils/fingerprint.js'
import { validateContentPackage } from '../utils/contentValidation.js'

const emit = defineEmits(['items-loaded'])
const fileInput = ref(null)

async function handleFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const [fileContent, fingerprint] = await Promise.all([file.text(), fingerprintFile(file)])
    const parsedData = JSON.parse(fileContent)
    const items = validateContentPackage(parsedData)

    emit('items-loaded', { items, fileName: file.name, fingerprint })
    event.target.value = ''
  } catch (error) {
    alert(`Import fehlgeschlagen: ${error.message}`)
    event.target.value = ''
  }
}

function openFilePicker() {
  fileInput.value?.click()
}

defineExpose({ openFilePicker })
</script>

<template>
  <section class="import-card" aria-label="Privates Lernpaket laden">
    <div>
      <h2>Privates Lernpaket laden</h2>
      <p>
        Wähle eine lokale JSON-Datei aus. Sie wird nur im Browser gelesen,
        nicht hochgeladen und nicht gespeichert.
      </p>
    </div>

    <button class="import-button" type="button" @click="openFilePicker">JSON auswählen</button>
    <input
      ref="fileInput"
      class="visually-hidden"
      type="file"
      accept=".json,application/json"
      @change="handleFileChange"
    />
  </section>
</template>
