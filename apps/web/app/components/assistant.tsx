'use client';

import { useEffect, useRef, useState } from 'react';
import { parseJsonSafe, type VideoRecord } from './api';
import AssistantEntity, { type EntityMood } from './assistant-entity';
import { watchForBargeIn } from './barge-in';
import { LogoMark } from './logo';
import { createRecordedRecognition } from './recorded-dictation';
import { bestVoice, primeVoices, toChunks, toSpeech } from './speech-voice';

interface AssistantProps {
    videos: VideoRecord[];
    loading: boolean;
    // The list failed to load: the greeting must not claim there are no videos.
    loadError: string;
    selected: VideoRecord | null;
    onCreated: (video: VideoRecord) => void;
    onUpdated: (video: VideoRecord) => void;
    onSelect: (id: string) => void;
    onDeleted: (id: string) => void;
}

interface Turn {
    who: 'tu' | 'stickman';
    text: string;
    // Said by the panel itself, not by the copilot: the basic-mode notice, a
    // refused microphone, a failed request. Shown, but never sent back as
    // history - the model would read them as its own words and repeat them.
    local?: boolean;
}

// Speech recognition is still vendor-prefixed in Chrome and absent in Firefox,
// so it is reached through a narrow local shape instead of a DOM lib type.
type SpeechAlternative = { transcript: string };
// isFinal lives on the result slot, not the alternative: a slot updates with
// interim text several times before the engine settles on a final transcript.
type SpeechResult = ArrayLike<SpeechAlternative> & { isFinal: boolean };
type SpeechResultEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechErrorEvent = { error?: string };
type Recognition = {
    lang: string; continuous: boolean; interimResults: boolean;
    start: () => void; stop: () => void;
    onresult: ((event: SpeechResultEvent) => void) | null;
    onerror: ((event: SpeechErrorEvent) => void) | null;
    onend: (() => void) | null;
};

// Latin American Spanish: the videos are narrated with Mexican voices and the
// vocabulary is Colombian ("cuota inicial") - 'es-ES' (Spain) recognises
// neither well. Kept as a named constant with an env override instead of a
// literal inside getRecognition(), so fixing it for a different market later
// is a one-line change, not a hunt through the function body.
const RECOGNITION_LANG = process.env.NEXT_PUBLIC_RECOGNITION_LANG ?? 'es-MX';

// How long the operator has to stay quiet before what they said is sent, while
// the engine still holds part of the phrase as interim (it has not decided the
// sentence is over). Sending on the first final result cut people off
// mid-thought; 2.5 s on top of the model's latency felt like talking to a wall.
// 1.5 s still covers a "let me think" breath in the middle of a phrase.
const PAUSE_TO_SEND_MS = 1500;
// Once the engine has settled everything it heard (nothing interim left), it
// has already waited out its own end-of-phrase silence, so a short extra pause
// is enough to send.
const SETTLED_PAUSE_MS = 700;
// Between one recognition session ending and the next one starting in
// hands-free: starting again inside the same tick fails in Chrome while the
// previous session is still releasing the mic.
const RESUME_DELAY_MS = 250;
// /api/speak answered "no voice" (no key, no HeyGen balance): skip that round
// trip for a while instead of paying its latency before every reply.
const HEYGEN_RETRY_MS = 10 * 60 * 1000;

// Outside the component: speak() only ever runs from event handlers, but the
// React compiler's purity lint cannot tell and flags a bare Date.now() there.
function heygenResting(offUntil: number): boolean {
    return Date.now() < offUntil;
}
// A tool turn (writing a script, planning scenes) can take several seconds;
// past this, a short spoken filler tells the operator they were heard.
const FILLER_AFTER_MS = 3500;
const FILLERS = ['Dame un segundo.', 'Ya casi lo tengo.', 'Un momento, ya lo hago.'];

function getRecognition(): Recognition | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    // No native engine (Firefox, Brave...): record the phrase and transcribe
    // it on the server instead, so the mic works in every browser.
    if (!Ctor) return createRecordedRecognition();
    const recognition = new Ctor();
    recognition.lang = RECOGNITION_LANG;
    // Continuous for press-to-talk too: non-continuous sessions end themselves
    // at the first pause, which is the same cut-off with a different cause.
    // When to stop is decided here, by PAUSE_TO_SEND_MS or by a second press.
    recognition.continuous = true;
    // Always on: showing the partial transcript as it is heard is the whole
    // fix for "press, talk into silence, nothing moves until the phrase ends".
    recognition.interimResults = true;
    return recognition;
}

const VOICE_KEY = 'stickman:voz';

export default function Assistant({ videos, loading, loadError, selected, onCreated, onUpdated, onSelect, onDeleted }: AssistantProps) {
    const [listening, setListening] = useState(false);
    // Hands-free is never restored from storage: an open microphone is not a
    // display preference like mute/unmute, it is a live sensor in what can be
    // a shared office, and RF-012's caution about accidental triggers argues
    // for it defaulting off on every visit rather than turning itself on.
    const [handsFree, setHandsFree] = useState(false);
    // Live partial transcript, shown while a phrase is still being spoken and
    // cleared the moment it either finalises (and gets sent) or the mic stops.
    const [interim, setInterim] = useState('');
    // True while an utterance is actually sounding, independent of "busy":
    // the fetch can finish well before the reply has been read out loud.
    const [speaking, setSpeaking] = useState(false);
    // Whether the assistant answers out loud. Kept in a ref as well because a
    // reply can land after the user has already hit mute, and the ref is what
    // the reply reads.
    const [voiceOn, setVoiceOn] = useState(true);
    // null until the first answer. False means the turn was served by the
    // keyword fallback because no language model answered - worth saying, or
    // the operator just sees a copilot giving canned replies.
    const [modelo, setModelo] = useState<boolean | null>(null);
    const voiceRef = useRef(true);
    const handsFreeRef = useRef(false);
    const speakingRef = useRef(false);
    // The HeyGen clip being played, so muting or a newer reply can cut it.
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const wordTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
    // When /api/speak may be tried again; 0 means "try it now".
    const heygenOffUntilRef = useRef(0);
    // The utterance being spoken. Held so Chrome does not garbage-collect it
    // mid-sentence, which silently drops its onend and strands the mic.
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
    // Stops the hands-free barge-in watcher while a reply is being spoken.
    const bargeInStopRef = useRef<(() => void) | null>(null);
    const fillerCountRef = useRef(0);
    const busyRef = useRef(false);
    const [busy, setBusy] = useState(false);
    // Bumped on each heard or spoken word; the figure turns it into motion.
    const [pulse, setPulse] = useState(0);
    const onVoiceActivity = () => setPulse((current) => current + 1);
    const [input, setInput] = useState('');
    const [turns, setTurns] = useState<Turn[]>([]);
    // 'error' when the greeting was the "could not load" one, so a later
    // successful retry still gets the real greeting.
    const greeted = useRef<'no' | 'error' | 'ok'>('no');
    const recognitionRef = useRef<Recognition | null>(null);
    // Bumped on every speak() call so an utterance that gets cancelled by the
    // next one (say() can fire twice per turn: the reply, then a silent
    // aside) never resumes the microphone on behalf of a reply that never
    // finished playing.
    const speechTokenRef = useRef(0);
    // Set by onerror, read by the onend that always follows it: recognition
    // reports the error and the stop as two separate events.
    const lastErrorRef = useRef<string | null>(null);
    const transcriptRef = useRef<HTMLDivElement>(null);
    // send() is often called from a recognition callback built renders ago,
    // where `turns` and `selected` are frozen at that moment: the copilot then
    // got a history missing the last exchanges and lost the thread by voice.
    // These refs are what send() reads, so it always sees the current state.
    const turnsRef = useRef<Turn[]>([]);
    const selectedRef = useRef(selected);
    const modeloRef = useRef<boolean | null>(null);
    useEffect(() => {
        turnsRef.current = turns;
        selectedRef.current = selected;
        modeloRef.current = modelo;
    }, [turns, selected, modelo]);

    useEffect(() => {
        transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
    }, [turns, busy, interim]);

    // Read after mount, not in the initial state: the server renders this too,
    // and a stored value there would not match what the browser paints.
    // Storage can throw or come back empty (private window, blocked cookies),
    // in which case the assistant simply keeps its voice.
    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                if (window.localStorage.getItem(VOICE_KEY) === 'off') {
                    voiceRef.current = false;
                    setVoiceOn(false);
                }
            } catch {
                // no stored preference available; the default stands
            }
        }, 0);
        return () => clearTimeout(timer);
    }, []);

    // The voice list loads asynchronously; start now so the first reply
    // already has the good voice. Leaving the page stops any reply mid-air
    // and releases the barge-in microphone.
    useEffect(() => {
        primeVoices();
        const bargeIn = bargeInStopRef;
        const recognitionSlot = recognitionRef;
        const handsFreeSlot = handsFreeRef;
        return () => {
            bargeIn.current?.();
            window.speechSynthesis?.cancel();
            // An open microphone must not outlive the panel. Handlers are
            // detached first: stopping fires onend, which would otherwise send
            // the half-heard phrase from a component that no longer exists,
            // and hands-free off keeps a pending resume from reopening it.
            handsFreeSlot.current = false;
            const recognition = recognitionSlot.current;
            recognitionSlot.current = null;
            if (recognition) {
                recognition.onresult = null;
                recognition.onerror = null;
                recognition.onend = null;
                try {
                    recognition.stop();
                } catch {
                    // already stopped
                }
            }
        };
    }, []);

    function toggleVoice() {
        const next = !voiceOn;
        voiceRef.current = next;
        setVoiceOn(next);
        // Silence has to be immediate: muting while a sentence is being spoken
        // and still hearing it out is not muting. Hands-free picks the
        // microphone back up right away - there is nothing left to echo.
        if (!next && typeof window !== 'undefined') {
            stopSpeaking();
            maybeResumeListening();
        }
        try {
            window.localStorage.setItem(VOICE_KEY, next ? 'on' : 'off');
        } catch {
            // the toggle still works for this session
        }
    }

    // Greets on arrival with what is actually waiting, so the first thing the
    // client sees is the state of their work rather than a blank box. Runs once
    // the video list has loaded, hence the dependency on it.
    //
    // Text only: browsers refuse speechSynthesis before the visitor has
    // interacted with the page, so speaking here would be silently dropped. The
    // assistant finds its voice from the first reply onwards.
    useEffect(() => {
        if (greeted.current === 'ok' || loading) return;
        if (loadError) {
            if (greeted.current === 'error') return;
            greeted.current = 'error';
            // Local: it describes this browser's failed request, not the
            // conversation, so it is never sent back to the model.
            setTurns([{
                who: 'stickman',
                text: 'Hola. No pude cargar tus videos. Pulsa «Reintentar» en la lista; mientras tanto puedes escribirme igual.',
                local: true,
            }]);
            return;
        }
        const afterError = greeted.current === 'error';
        greeted.current = 'ok';

        const pendientes = videos.filter((v) => v.status === 'pendiente_aprobacion').length;
        const generando = videos.filter((v) => v.render_status === 'procesando').length;

        let text: string;
        if (videos.length === 0) {
            text = 'Hola. Soy tu asistente. Dime un tema y te armo el primer video: por ejemplo, "crea un video sobre tasas fijas para TikTok".';
        } else if (pendientes > 0) {
            text = `Hola. Tienes ${pendientes} video${pendientes === 1 ? '' : 's'} esperando tu aprobación. Nadie más puede aprobarlos, tienen que pasar por ti. Dime si quieres revisarlos o empezar uno nuevo.`;
        } else if (generando > 0) {
            text = `Hola. Hay ${generando} video${generando === 1 ? '' : 's'} generándose ahora mismo. Mientras tanto puedo empezar otro si me dices el tema.`;
        } else {
            text = `Hola. Tienes ${videos.length} videos guardados. Dime qué quieres hacer, o abre uno de la lista para revisarlo.`;
        }
        setTurns((current) => (afterError ? [...current, { who: 'stickman', text }] : [{ who: 'stickman', text }]));
    }, [loading, loadError, videos]);

    // Speaks text and reports back through onDone once it is truly finished
    // (or was never spoken at all - unsupported browser, empty string). This
    // is the one hook point for the whole echo trap: recognition must stay
    // suspended until this fires, never a fixed delay.
    function stopVoiceClip() {
        wordTimersRef.current.forEach(clearTimeout);
        wordTimersRef.current = [];
        const audio = audioRef.current;
        audioRef.current = null;
        if (audio) {
            audio.onended = null;
            audio.onerror = null;
            audio.pause();
            // pause() fires no end event, so whoever was waiting on this clip
            // is released here; the token check below keeps it from resuming
            // the mic on behalf of a reply that has already been superseded.
            audio.dispatchEvent(new Event('stickman-stopped'));
        }
    }

    // The HeyGen voice first (the same voice as the videos), the browser's
    // own voice whenever that is not available: /api/speak answers 204 with no
    // key, no balance, no session or any error, and a clip that will not play
    // falls back too. Either way onDone fires exactly once. A 204 is
    // remembered for a while, so a studio without HeyGen balance does not wait
    // on that round trip before every single reply.
    function speak(text: string, onDone: () => void, browserOnly = false) {
        const spoken = toSpeech(text);
        if (typeof window === 'undefined' || !spoken) {
            onDone();
            return;
        }
        const token = ++speechTokenRef.current;
        stopVoiceClip();
        window.speechSynthesis?.cancel();
        const finish = () => {
            if (speechTokenRef.current === token) onDone();
        };
        if (browserOnly || heygenResting(heygenOffUntilRef.current)) {
            speakWithBrowser(spoken, token, finish);
            return;
        }

        void (async () => {
            try {
                const response = await fetch('/api/speak', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: spoken }),
                    signal: AbortSignal.timeout(9000),
                });
                if (response.status !== 200) heygenOffUntilRef.current = Date.now() + HEYGEN_RETRY_MS;
                if (speechTokenRef.current !== token) return;
                if (response.status === 200) {
                    const data = await response.json() as { audio_url?: string; word_starts?: number[] };
                    if (speechTokenRef.current !== token) return;
                    if (data.audio_url) {
                        const audio = new Audio(data.audio_url);
                        audioRef.current = audio;
                        let settled = false;
                        const done = () => {
                            if (settled) return;
                            settled = true;
                            wordTimersRef.current.forEach(clearTimeout);
                            wordTimersRef.current = [];
                            if (audioRef.current === audio) audioRef.current = null;
                            finish();
                        };
                        audio.onended = done;
                        audio.addEventListener('stickman-stopped', done);
                        audio.onerror = () => {
                            if (settled) return;
                            settled = true;
                            if (audioRef.current === audio) audioRef.current = null;
                            speakWithBrowser(spoken, token, finish);
                        };
                        audio.onplay = () => {
                            onSpeechStart(token);
                            // Pulse the figure on every word, like the browser
                            // voice's boundary events do.
                            wordTimersRef.current = (data.word_starts ?? []).map((start) => setTimeout(onVoiceActivity, start * 1000));
                        };
                        try {
                            await audio.play();
                            return;
                        } catch {
                            // Autoplay refused or the clip will not decode:
                            // drop it so the browser voice below takes over.
                            settled = true;
                            if (audioRef.current === audio) audioRef.current = null;
                        }
                    }
                }
            } catch {
                // Timed out or offline: treated like a 204, and the browser's
                // voice below takes over.
                heygenOffUntilRef.current = Date.now() + HEYGEN_RETRY_MS;
            }
            if (speechTokenRef.current === token && !audioRef.current) speakWithBrowser(spoken, token, finish);
        })();
    }

    // The browser's voice, made human: the best Spanish voice installed
    // (speech-voice.ts ranks them) and the reply read sentence by sentence.
    // One long utterance is cut off by Chrome after about fifteen seconds and
    // makes the first word wait for the whole paragraph; short chunks start
    // at once and chain through onend.
    function speakWithBrowser(text: string, token: number, finish: () => void) {
        const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
        if (!synth || speechTokenRef.current !== token) {
            finish();
            return;
        }
        const chunks = toChunks(text);
        void bestVoice().then((voice) => {
            if (speechTokenRef.current !== token) return;
            if (synth.speaking || synth.pending) synth.cancel();
            let index = 0;
            let watchdog: ReturnType<typeof setTimeout> | null = null;
            const next = () => {
                if (watchdog) clearTimeout(watchdog);
                watchdog = null;
                // Superseded (a newer reply, mute, barge-in): whoever bumped
                // the token owns what happens next, so nothing resumes here.
                if (speechTokenRef.current !== token) return;
                if (index >= chunks.length) {
                    utteranceRef.current = null;
                    finish();
                    return;
                }
                const chunk = chunks[index];
                const first = index === 0;
                index += 1;
                const utterance = new SpeechSynthesisUtterance(chunk);
                if (voice) utterance.voice = voice;
                utterance.lang = voice?.lang ?? RECOGNITION_LANG;
                // Neural voices already have natural pacing; speeding them up
                // or shifting the pitch is what makes them sound synthetic.
                utterance.rate = 1;
                utterance.pitch = 1;
                let ended = false;
                const end = () => {
                    if (ended) return;
                    ended = true;
                    next();
                };
                // cancel() fires onend/onerror on whatever it interrupted;
                // next() checks the token, so a superseded chunk chains nothing.
                utterance.onend = end;
                utterance.onerror = end;
                utterance.onboundary = onVoiceActivity;
                utterance.onstart = () => {
                    onVoiceActivity();
                    if (first) onSpeechStart(token);
                };
                utteranceRef.current = utterance;
                // Chrome now and then never fires onend (network voices, a
                // speak() right after cancel()); without a deadline the reply
                // would never finish and hands-free would never listen again.
                // Generous: about 9 characters a second plus start-up time.
                watchdog = setTimeout(end, 4000 + chunk.length * 110);
                synth.speak(utterance);
            };
            next();
        });
    }

    // The reply has actually started sounding: only now is the barge-in
    // watcher armed, so its calibration hears the assistant's own echo rather
    // than the silence before it.
    function onSpeechStart(token: number) {
        if (speechTokenRef.current !== token || !speakingRef.current || !handsFreeRef.current || bargeInStopRef.current) return;
        bargeInStopRef.current = watchForBargeIn(bargeIn);
    }

    function stopBargeIn() {
        bargeInStopRef.current?.();
        bargeInStopRef.current = null;
    }

    // Cuts whatever is being said, now. The token bump keeps the cancelled
    // utterance's onend from resuming anything; the caller decides what
    // follows (listen, send, or nothing).
    function stopSpeaking() {
        speechTokenRef.current += 1;
        stopVoiceClip();
        if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
        utteranceRef.current = null;
        stopBargeIn();
        if (speakingRef.current) {
            speakingRef.current = false;
            setSpeaking(false);
        }
    }

    // Barge-in: the operator talked over the reply (hands-free) or pressed the
    // mic while it was speaking. Like a person would, it stops and listens.
    function bargeIn() {
        if (!speakingRef.current) return;
        stopSpeaking();
        beginListening();
    }

    function onSpeechEnd() {
        stopBargeIn();
        speakingRef.current = false;
        setSpeaking(false);
        maybeResumeListening();
    }

    // The single gate for "should the mic pick itself back up right now",
    // used after a reply, after a silence timeout, and after a mute toggle.
    function maybeResumeListening() {
        if (!handsFreeRef.current || recognitionRef.current || speakingRef.current || busyRef.current) return;
        beginListening();
    }

    function say(text: string, aloud = true, local = !aloud) {
        setTurns((current) => [...current, { who: 'stickman', text, local }]);
        if (aloud && voiceRef.current) {
            speakingRef.current = true;
            setSpeaking(true);
            speak(text, onSpeechEnd);
        } else {
            // Nothing is going to sound, so there is nothing to echo either -
            // hands-free can keep listening right away.
            maybeResumeListening();
        }
    }

    async function send(message: string) {
        const text = message.trim();
        if (!text || busyRef.current) return;

        // Typing while it talks means the operator has moved on: the old
        // reply stops instead of talking over the new one.
        stopSpeaking();
        setInput('');
        const history = [
            ...turnsRef.current
                .filter((turn) => !turn.local)
                .map((turn) => ({ role: turn.who === 'tu' ? 'user' as const : 'assistant' as const, content: turn.text })),
            { role: 'user' as const, content: text },
        ];
        setTurns((current) => [...current, { who: 'tu', text }]);
        setBusy(true);
        busyRef.current = true;

        // Silence after speaking reads as "it did not hear me". Spoken only,
        // never added to the conversation, and cut by the reply itself (speak()
        // cancels whatever is sounding) the moment it lands.
        const filler = setTimeout(() => {
            if (!busyRef.current || !voiceRef.current || speakingRef.current) return;
            const phrase = FILLERS[fillerCountRef.current % FILLERS.length];
            fillerCountRef.current += 1;
            speak(phrase, () => undefined, true);
        }, FILLER_AFTER_MS);

        try {
            // The copilot runs the tools itself, against the same persistence
            // the panels use, and hands back the record it touched. The browser
            // only does what a server cannot: move the selection and open a file.
            let response: Response;
            try {
                response = await fetch('/api/copilot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ videoId: selectedRef.current?.id ?? null, messages: history }),
                });
            } catch {
                throw new Error('No se pudo conectar con el servidor.');
            }
            // Not always JSON: a Vercel timeout (504) or a proxy error answers
            // with an HTML or plain-text page, and response.json() would throw
            // a browser message in English that then got shown and spoken.
            const parsed = await parseJsonSafe(response);
            if (parsed === null || typeof parsed !== 'object') {
                throw new Error(response.status === 504
                    ? 'El asistente tardó demasiado en responder. Prueba de nuevo o pide algo más corto.'
                    : 'El asistente no respondió bien. Prueba de nuevo en un momento.');
            }
            const data = parsed as {
                reply?: string; error?: string;
                video?: VideoRecord | null; created?: boolean; deletedId?: string | null;
                selectId?: string | null; descargarUrl?: string | null; provider?: string | null;
            };
            if (!response.ok) throw new Error(data.error ?? 'El asistente no respondió.');
            setModelo(Boolean(data.provider));

            if (data.deletedId) onDeleted(data.deletedId);
            if (data.video) {
                if (data.created) onCreated(data.video);
                else onUpdated(data.video);
            }
            if (data.selectId) onSelect(data.selectId);
            if (data.descargarUrl) window.open(data.descargarUrl, '_blank', 'noopener');

            // Flipped off before speaking rather than in a finally: a spoken
            // reply can take far longer than the fetch did, and the mic must
            // be free to resume the instant the turn's speech (or the lack of
            // it) says so, not only once this function eventually returns.
            clearTimeout(filler);
            setBusy(false);
            busyRef.current = false;

            say(data.reply ?? 'Hecho.');
            if (!data.provider && modeloRef.current !== false) {
                say('Aviso: ahora respondo en modo básico, porque los modelos de lenguaje no contestaron. Entiendo órdenes concretas, pero no conversación libre. Prueba de nuevo en un minuto.', false);
            }
        } catch (error) {
            clearTimeout(filler);
            setBusy(false);
            busyRef.current = false;
            say(error instanceof Error ? error.message : 'Algo falló al ejecutar eso.', true, true);
        }
    }

    // Shared by the press-to-talk button and hands-free mode: both are just
    // "start one recognition session", they differ only in what happens on
    // onend, which is decided below from handsFreeRef.
    function beginListening() {
        if (recognitionRef.current || busyRef.current || speakingRef.current) return;
        const recognition = getRecognition();
        if (!recognition) {
            // Only reached when the browser cannot even record audio (both the
            // native engine and the recorded fallback are missing). Said out
            // loud rather than hidden: a control that silently does nothing
            // reads as a bug. Hands-free falls back to the text field.
            say('Este navegador no permite usar el micrófono. Escríbeme y te ayudo igual.', false);
            if (handsFreeRef.current) {
                handsFreeRef.current = false;
                setHandsFree(false);
            }
            return;
        }

        let handled = false;
        // Everything the engine has settled on so far in this session. Rebuilt
        // from the whole results list on every event rather than appended from
        // resultIndex, so a phrase the engine revises can never be counted twice.
        let heard = '';
        let pauseTimer: ReturnType<typeof setTimeout> | null = null;
        const clearPause = () => {
            if (pauseTimer) clearTimeout(pauseTimer);
            pauseTimer = null;
        };
        // Sends what was heard exactly once, whichever comes first: the pause,
        // a second press of the mic, or the browser ending the session.
        const commit = () => {
            clearPause();
            const said = heard.trim();
            if (handled || !said) return false;
            handled = true;
            setInterim('');
            void send(said);
            return true;
        };

        recognition.onresult = (event) => {
            if (handled) return;
            let settled = '';
            let pending = '';
            for (let i = 0; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0]?.transcript ?? '';
                if (result.isFinal) settled += transcript;
                else pending += transcript;
            }
            heard = settled;
            setInterim(`${settled}${pending}`.trim());
            // Any new sound restarts the countdown: only a real pause sends.
            clearPause();
            pauseTimer = setTimeout(() => {
                if (commit()) recognition.stop();
            }, pending.trim() ? PAUSE_TO_SEND_MS : SETTLED_PAUSE_MS);
            onVoiceActivity();
        };
        recognition.onerror = (event) => {
            lastErrorRef.current = event.error ?? null;
        };
        recognition.onend = () => {
            recognitionRef.current = null;
            setListening(false);
            // Stopped by a second press, or closed by the browser on its own:
            // either way what was already heard is sent, not thrown away.
            commit();
            if (!handled) setInterim('');

            const error = lastErrorRef.current;
            lastErrorRef.current = null;

            // A refused microphone says why once and stops - it does not
            // retry itself into a loop of failed permission prompts.
            if (error === 'not-allowed' || error === 'service-not-allowed' || error === 'audio-capture') {
                handsFreeRef.current = false;
                setHandsFree(false);
                say('No puedo usar el micrófono: revisa el permiso del navegador o que haya uno conectado. Sigo disponible por escrito.', false);
                return;
            }
            if (error === 'network') {
                handsFreeRef.current = false;
                setHandsFree(false);
                say('Se perdió la conexión del reconocimiento de voz. Sigo disponible por escrito.', false);
                return;
            }

            // Any other end - a silence timeout, the browser closing the
            // session on its own, or a phrase sent whose reply already came
            // back while this session was still closing (voice off, fast
            // answer) - is normal in continuous listening. Pick the mic back
            // up rather than making the operator click again; the gate
            // refuses while a turn is still thinking or speaking, and that
            // turn resumes it itself when it is done.
            setTimeout(maybeResumeListening, RESUME_DELAY_MS);
        };

        recognitionRef.current = recognition;
        setInterim('');
        try {
            recognition.start();
        } catch {
            // Chrome throws if the previous session has not fully let go of
            // the mic yet. Try once more shortly instead of leaving hands-free
            // silently dead.
            recognitionRef.current = null;
            setListening(false);
            if (handsFreeRef.current) setTimeout(maybeResumeListening, RESUME_DELAY_MS * 2);
            return;
        }
        setListening(true);
    }

    function toggleMic() {
        // Pressed while it talks: barge in, in either mode.
        if (speakingRef.current) {
            bargeIn();
            return;
        }
        if (handsFreeRef.current) return; // the mic already belongs to hands-free
        if (listening) {
            recognitionRef.current?.stop();
            return;
        }
        beginListening();
    }

    function toggleHandsFree() {
        const next = !handsFree;
        handsFreeRef.current = next;
        setHandsFree(next);
        if (next) {
            // No-ops quietly if a turn is already in flight; the turn's own
            // completion (say -> onSpeechEnd or the silent-aside branch) will
            // pick the mic up as soon as it is free, via maybeResumeListening.
            beginListening();
        } else {
            stopBargeIn();
            recognitionRef.current?.stop();
        }
    }

    const statusText = speaking
        ? 'Hablando...'
        : listening
        ? (handsFree ? 'Escuchando (manos libres)...' : 'Escuchando...')
        : busy
        ? 'Pensando...'
        : modelo === false
        ? 'Modo básico: sin modelo de lenguaje conectado'
        : voiceOn
        ? 'Háblame o escríbeme'
        : 'Voz apagada: te respondo por escrito';

    const mood: EntityMood = speaking ? 'speaking' : busy ? 'thinking' : listening ? 'listening' : 'idle';

    const micPlaceholder = speaking
        ? (handsFree ? 'Hablando... interrúmpeme cuando quieras' : 'Hablando... pulsa el micrófono para interrumpir')
        : listening
        ? (handsFree ? 'Escuchando... haz una pausa para enviar' : 'Escuchando... pausa o pulsa el micrófono para enviar')
        : 'Escribe o pulsa el micrófono';

    return (
        <section className="panel flex max-h-[44rem] min-h-[30rem] flex-col overflow-hidden" aria-label="Asistente de voz">
            <header className="flex flex-wrap items-center gap-2 border-b border-white/[0.07] px-4 py-3">
                <LogoMark size={32} />
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                        <span className="panel-title">Asistente</span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${
                            speaking ? 'animate-pulse bg-brand-300' : listening ? 'animate-pulse bg-red-400' : busy ? 'bg-amber-400' : 'bg-emerald-400'
                        }`} aria-hidden="true" />
                    </span>
                    <span className="block truncate text-xs text-slate-400">{statusText}</span>
                </span>
                <button
                    type="button"
                    onClick={toggleHandsFree}
                    aria-pressed={handsFree}
                    aria-label={handsFree
                        ? 'Modo manos libres activado: escucha, envía y vuelve a escuchar sola. Pulsa para apagarlo'
                        : 'Activar el modo manos libres: escucha de forma continua sin pulsar el micrófono cada vez'}
                    title={handsFree ? 'Manos libres activado' : 'Activar manos libres'}
                    className={`btn btn-sm rounded-full ${
                        handsFree
                            ? 'border border-emerald-400/40 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25'
                            : 'btn-secondary'
                    }`}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17 2l4 4-4 4" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <path d="M7 22l-4-4 4-4" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                    </svg>
                    <span>Manos libres</span>
                    {handsFree && (
                        <span
                            className={`h-1.5 w-1.5 rounded-full ${listening ? 'animate-pulse bg-red-400' : 'bg-emerald-400'}`}
                            aria-hidden="true"
                        />
                    )}
                </button>
                <button
                    type="button"
                    onClick={toggleVoice}
                    aria-pressed={!voiceOn}
                    aria-label={voiceOn ? 'Apagar la voz del asistente' : 'Encender la voz del asistente'}
                    title={voiceOn ? 'Apagar la voz: seguirá respondiendo por escrito' : 'Encender la voz'}
                    className={`btn-icon rounded-full ${
                        voiceOn ? 'border border-white/10 bg-white/[0.04] text-slate-200' : 'bg-red-500/15 text-red-300 hover:bg-red-500/25 hover:text-red-200'
                    }`}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M11 5 6 9H3v6h3l5 4z" />
                        {voiceOn ? (
                            <>
                                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                                <path d="M18.5 5.5a9 9 0 0 1 0 13" />
                            </>
                        ) : (
                            <path d="m16 9 5 6M21 9l-5 6" />
                        )}
                    </svg>
                </button>
            </header>

            {/* The assistant's body, between the controls and the conversation:
                it is what tells you, at a glance, whether it is listening,
                thinking or talking. */}
            <div className="flex flex-col items-center border-b border-white/[0.07] bg-gradient-to-b from-brand-500/[0.07] to-transparent pb-3 pt-2">
                <AssistantEntity mood={mood} pulse={pulse} />
                <span className="chip -mt-1" aria-live="polite">{statusText}</span>
            </div>

            <div
                ref={transcriptRef}
                role="log"
                aria-live="polite"
                aria-label="Conversación con el asistente"
                className="thin-scroll flex-1 space-y-3 overflow-y-auto p-4"
            >
                {turns.length === 0 && (
                    // Until the list loads there is no greeting yet: a quiet
                    // placeholder instead of an empty box.
                    <div className="space-y-2" aria-hidden="true">
                        <div className="skeleton h-10 w-3/4 rounded-2xl" />
                        <div className="skeleton h-6 w-1/2 rounded-2xl" />
                    </div>
                )}
                {turns.map((turn, index) => (
                    <div
                        key={index}
                        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                            turn.who === 'tu'
                                ? 'ml-auto rounded-br-md bg-brand-600 text-white'
                                : 'rounded-bl-md border border-white/[0.08] bg-white/[0.04] text-slate-100'
                        }`}
                    >
                        {turn.text}
                    </div>
                ))}
                {interim && (
                    // What it is hearing right now, not yet sent: dashed so it
                    // reads as provisional next to the solid sent bubbles.
                    <div
                        className="ml-auto max-w-[88%] rounded-2xl rounded-br-md border border-dashed border-brand-400/50 bg-brand-500/10 px-3.5 py-2.5 text-sm italic leading-relaxed text-brand-100"
                        aria-label={`Escuchando: ${interim}`}
                    >
                        {interim}
                    </div>
                )}
                {busy && (
                    <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-white/[0.08] bg-white/[0.04] px-3.5 py-3" role="status">
                        <span className="sr-only">Pensando...</span>
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" aria-hidden="true" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" aria-hidden="true" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" aria-hidden="true" />
                    </div>
                )}
            </div>

            <form
                onSubmit={(event) => { event.preventDefault(); void send(input); }}
                className="flex items-center gap-2 border-t border-white/[0.07] bg-ink-900/40 p-3"
            >
                <button
                    type="button"
                    onClick={toggleMic}
                    // Enabled while it speaks, in either mode: pressing it
                    // then is a barge-in - it stops talking and listens.
                    disabled={busy || (handsFree && !speaking)}
                    aria-pressed={listening && !handsFree}
                    aria-label={speaking
                        ? 'Interrumpir al asistente y hablar'
                        : handsFree
                        ? 'Micrófono en uso por el modo manos libres'
                        : listening ? 'Escuchando: pulsa para detener' : 'Hablar: pulsa y di lo que necesitas'}
                    title={speaking ? 'Interrumpir y hablar' : handsFree ? 'El modo manos libres ya tiene el micrófono abierto' : undefined}
                    className={`btn rounded-full px-3 text-xs ${
                        listening && !handsFree ? 'listening-ring bg-red-600 font-semibold text-white hover:bg-red-700' : 'btn-secondary'
                    }`}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v4" />
                    </svg>
                    <span className="hidden min-[400px]:inline">{speaking ? 'Interrumpir' : listening && !handsFree ? 'Escuchando' : 'Hablar'}</span>
                </button>
                <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    disabled={busy}
                    placeholder={micPlaceholder}
                    aria-label="Mensaje para el asistente"
                    className="field h-10 min-w-0 flex-1 rounded-full px-4"
                />
                <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    aria-label="Enviar mensaje"
                    className="btn btn-primary rounded-full px-3 sm:px-4"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                    <span className="hidden sm:inline">Enviar</span>
                </button>
            </form>
        </section>
    );
}
