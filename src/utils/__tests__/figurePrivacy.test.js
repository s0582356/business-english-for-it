import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../..')

function collectFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? collectFiles(path) : [path]
  })
}
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
const FIGURE_CODE = ['src/components/ChartFigure.vue', 'src/components/ChartPlot.vue', 'src/utils/figureLibrary.js', 'src/utils/figureImport.js', 'src/utils/chartScale.js']

describe('Figuren-Privacy', () => {
  it('keine private Figuren-Datei und keine Pilot-Kennungen in src/, public/, index.html oder dist/', () => {
    const files = ['src', 'public', 'dist'].flatMap((dir) => collectFiles(join(ROOT, dir)))
    const dataFiles = files.filter((path) => /\.(json|csv|svg|png|jpe?g|webp|gif)$/i.test(path))
    for (const path of dataFiles.filter((candidate) => candidate.endsWith('.json'))) {
      expect(readFileSync(path, 'utf8'), path).not.toContain('businessEnglishFigures')
    }
    const scanned = files.filter((path) => /\.(js|vue|html|css|json)$/i.test(path) && !path.includes('__tests__'))
    for (const path of [...scanned, join(ROOT, 'index.html')]) {
      if (!existsSync(path)) continue
      expect(readFileSync(path, 'utf8'), path).not.toMatch(/w3u-|w3-fig-|w3-graph-figures/)
    }
  })

  it('der Figuren-Code wertet keine Daten als HTML oder Code aus und nutzt keinen Browser-Speicher', () => {
    const forbidden = /innerHTML|outerHTML|insertAdjacentHTML|v-html|\beval\s*\(|new Function|document\.write|localStorage|sessionStorage|indexedDB|caches\.open|serviceWorker|fetch\s*\(|XMLHttpRequest/
    for (const relative of FIGURE_CODE) {
      expect(stripComments(readFileSync(join(ROOT, relative), 'utf8')), relative).not.toMatch(forbidden)
    }
  })

  it('der Figuren-Code laedt keine externe Diagramm-Bibliothek', () => {
    const imports = FIGURE_CODE.flatMap((relative) => [...readFileSync(join(ROOT, relative), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]))
    expect(imports.filter((specifier) => !specifier.startsWith('.') && specifier !== 'vue')).toEqual([])
  })

  it('private Dateien bleiben per .gitignore vom Repository ausgeschlossen', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^private\/$/m)
    expect(gitignore).not.toMatch(/^!\/?private/m)
  })
})
