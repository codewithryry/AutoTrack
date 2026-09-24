import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Talking to TOBI: the browser's own speech recognition and speech synthesis.
 *
 * No audio leaves the device through Tool Track — recognition is the browser's
 * service, and only the recognised text is sent to TOBI like a typed message.
 * Where the browser has no recognition (Firefox, the Android app's WebView),
 * `canListen` is false and the mic buttons are simply not shown.
 *
 * Filipino recognition (`fil-PH`) also takes English and Taglish reasonably
 * well, which is how students here actually speak.
 */

const Recognition =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

export const canListen = !!Recognition
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

const LISTEN_LANG = 'fil-PH'

/** What is read aloud: the reply without list markers and bold marks. */
const speakable = (text) =>
  text
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n+/g, '. ')
    .replace(/(-?\d+\.\d{3})\d+/g, '$1')

function pickVoice(text) {
  const voices = window.speechSynthesis.getVoices()
  // A reply with common Filipino words reads better in a Filipino voice.
  const filipino = /\b(ang|mga|ng|ko|mo|po|ba|yung|ito|nasa|wala|meron|hindi)\b/i.test(text)
  const order = filipino ? ['fil', 'tl', 'en-PH', 'en'] : ['en-PH', 'en-US', 'en-GB', 'en']
  for (const lang of order) {
    const voice = voices.find((v) => v.lang?.toLowerCase().startsWith(lang.toLowerCase()))
    if (voice) return voice
  }
  return null
}

/**
 * `status`: 'idle' | 'listening' | 'speaking'. `listen()` resolves with the
 * final transcript ('' when nothing was heard); `interim` shows the words as
 * they are recognised.
 */
export function useVoice() {
  const [status, setStatus] = useState('idle')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const recognition = useRef(null)

  const stopListening = useCallback(() => {
    recognition.current?.abort()
    recognition.current = null
  }, [])

  const stopSpeaking = useCallback(() => {
    if (canSpeak) window.speechSynthesis.cancel()
  }, [])

  const stop = useCallback(() => {
    stopListening()
    stopSpeaking()
    setInterim('')
    setStatus('idle')
  }, [stopListening, stopSpeaking])

  const listen = useCallback(
    () =>
      new Promise((resolve) => {
        if (!Recognition) return resolve('')
        stopSpeaking()
        stopListening()
        const rec = new Recognition()
        rec.lang = LISTEN_LANG
        rec.interimResults = true
        rec.continuous = false
        rec.maxAlternatives = 1
        let finalText = ''
        rec.onresult = (event) => {
          let partial = ''
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i]
            if (result.isFinal) finalText += result[0].transcript
            else partial += result[0].transcript
          }
          setInterim((finalText + partial).trim())
        }
        rec.onerror = (event) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setError('Allow microphone access to talk to TOBI.')
          } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
            setError("TOBI couldn't hear that. Try again.")
          }
        }
        rec.onend = () => {
          if (recognition.current === rec) recognition.current = null
          setStatus('idle')
          setInterim('')
          resolve(finalText.trim())
        }
        recognition.current = rec
        setError('')
        setInterim('')
        setStatus('listening')
        try {
          rec.start()
        } catch {
          setStatus('idle')
          resolve('')
        }
      }),
    [stopListening, stopSpeaking],
  )

  const speak = useCallback(
    (text) =>
      new Promise((resolve) => {
        if (!canSpeak || !text) return resolve()
        stopListening()
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(speakable(text))
        const voice = pickVoice(text)
        if (voice) {
          utterance.voice = voice
          utterance.lang = voice.lang
        }
        utterance.rate = 1.02
        utterance.onend = utterance.onerror = () => {
          setStatus('idle')
          resolve()
        }
        setStatus('speaking')
        window.speechSynthesis.speak(utterance)
      }),
    [stopListening],
  )

  // Nothing keeps talking or listening after the chat is gone.
  useEffect(() => stop, [stop])

  // Cutting a reply short ends its utterance, which lets a voice conversation
  // go straight on to listening.
  return { status, interim, error, listen, speak, stop, skip: stopSpeaking, setError }
}
