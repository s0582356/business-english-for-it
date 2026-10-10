import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../..')
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|ogg|opus|zip)$/i

function collectFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? collectFiles(path) : [path]
  })
}

describe('Audio-Privacy', () => {
  it('Test 25: keine Audio-Dateien oder ZIPs in src/, public/ oder dist/', () => {
    const offenders = ['src', 'public', 'dist'].flatMap((dir) => collectFiles(join(ROOT, dir))).filter((path) => AUDIO_EXTENSIONS.test(path))
    expect(offenders).toEqual([])
  })

  it('private Ausgabe (private/, tools/, dist/) ist per .gitignore ausgeschlossen', () => {
    const gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    expect(gitignore).toMatch(/^private\/$/m)
    expect(gitignore).toMatch(/^\/\*$/m) // Default-Deny im Repo-Root (deckt tools/ ab)
    expect(gitignore).toMatch(/^dist\/$/m)
    expect(gitignore).not.toMatch(/^!\/(private|tools)/m)
  })

  it('der Quellcode legt keine Audio-Daten in Browser-Speichern ab', () => {
    const files = collectFiles(join(ROOT, 'src')).filter((path) => /\.(js|vue)$/.test(path) && !path.includes('__tests__'))
    const forbidden = /indexedDB|caches\.open|serviceWorker|localStorage\.setItem\([^)]*(blob|audio)/i
    for (const path of files) {
      const content = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
      if (path.endsWith('audioSettings.js')) continue // einziger erlaubter localStorage-Zugriff fuer Audio: zwei Booleans
      expect(content, path).not.toMatch(forbidden)
    }
  })
})
