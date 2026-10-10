import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioPlayer } from '../audioPlayer.js'
import { FakeAudio } from './audioTestHelpers.js'

describe('createAudioPlayer - ein einziges HTMLAudioElement', () => {
  let created
  let player
  let audio

  beforeEach(() => {
    created = 0
    audio = new FakeAudio()
    player = createAudioPlayer({ createAudio: () => { created++; return audio } })
  })

  it('nutzt fuer alle Wiedergaben dasselbe Element (lazy erzeugt)', async () => {
    expect(created).toBe(0)
    await player.play('blob:a')
    await player.play('blob:b')
    await player.play('blob:a')
    expect(created).toBe(1)
    expect(audio.realPlays).toEqual(['blob:a', 'blob:b', 'blob:a'])
  })

  it('neues Audio stoppt altes: vor jedem Start wird pausiert und von vorn begonnen', async () => {
    await player.play('blob:a')
    audio.currentTime = 4.2
    const pause = vi.spyOn(audio, 'pause')
    await player.play('blob:a')
    expect(pause).toHaveBeenCalled()
    expect(audio.currentTime).toBe(0)
  })

  it('stop() pausiert und setzt zurueck', async () => {
    await player.play('blob:a')
    audio.currentTime = 2
    player.stop()
    expect(audio.paused).toBe(true)
    expect(audio.currentTime).toBe(0)
  })

  it('Race-Schutz: ein verspaetet aufgeloestes play() wird als stale verworfen', async () => {
    let releaseFirst
    audio.play = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve }))
      .mockImplementation(() => Promise.resolve())
    const first = player.play('blob:first')
    const second = player.play('blob:second')
    releaseFirst()
    expect(await first).toEqual({ ok: false, stale: true })
    expect(await second).toEqual({ ok: true })
  })

  it('stop() waehrend eines haengenden play() macht dieses stale statt als Fehler zu melden', async () => {
    let rejectPlay
    audio.play = vi.fn(() => new Promise((_resolve, reject) => { rejectPlay = reject }))
    const pending = player.play('blob:a')
    player.stop()
    rejectPlay(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    expect(await pending).toEqual({ ok: false, stale: true })
  })

  it('meldet Fehler als Ergebnis statt zu werfen', async () => {
    audio.playError = Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
    const result = await player.play('blob:a')
    expect(result.ok).toBe(false)
    expect(result.error.name).toBe('NotAllowedError')
  })

  it('unlock() startet stilles Audio (stumm) ohne echte Wiedergabe und echtes Audio ist danach nicht stumm', async () => {
    player.unlock()
    expect(audio.src.startsWith('data:audio/wav')).toBe(true)
    await player.play('blob:real')
    expect(audio.muted).toBe(false)
    expect(audio.realPlays).toEqual(['blob:real'])
    expect(player.isUnlocked).toBe(true)
  })
})
