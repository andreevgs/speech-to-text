import { useState, useEffect, useRef } from 'react';
import Hark from 'hark';
import { startRecording, stopRecording } from './recorderHelpers';

// https://cloud.google.com/speech-to-text/docs/reference/rest/v1/RecognitionConfig
import { GoogleCloudRecognitionConfig } from './GoogleCloudRecognitionConfig';
import {
  algoritms,
  computerScienceDef, distributed,
  engineering,
  greetings,
  howAreYouAnswers,
  intelligent, parallel, parallelDistributed, whatCanDiscuss, whatCanDo
} from '../commands/commands';

// https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
export interface SpeechRecognitionProperties {
  // continuous: do not pass continuous here, instead pass it as a param to the hook
  grammars?: SpeechGrammarList;
  interimResults?: boolean;
  lang?: string;
  maxAlternatives?: number;
}

const isEdgeChromium = navigator.userAgent.indexOf('Edg/') !== -1;

interface BraveNavigator extends Navigator {
  brave: {
    isBrave: () => Promise<boolean>;
  };
}

const AudioContext = window.AudioContext || (window as any).webkitAudioContext;

const SpeechRecognition =
  window.SpeechRecognition || (window as any).webkitSpeechRecognition;

let recognition: SpeechRecognition | null;

export type ResultType = {
  speechBlob?: Blob;
  timestamp: number;
  transcript: string;
};

// Set recognition back to null for brave browser due to promise resolving
// after the conditional on line 31
if ((navigator as BraveNavigator).brave) {
  (navigator as BraveNavigator).brave.isBrave().then((bool) => {
    if (bool) recognition = null;
  });
}

// Chromium browsers will have the SpeechRecognition method
// but do not implement the functionality due to google wanting 💰
// this covers new Edge and line 22 covers Brave, the two most popular non-chrome chromium browsers
if (!isEdgeChromium && SpeechRecognition) {
  recognition = new SpeechRecognition();
}

export interface UseSpeechToTextTypes {
  continuous?: boolean;
  crossBrowser?: boolean;
  googleApiKey?: string;
  googleCloudRecognitionConfig?: GoogleCloudRecognitionConfig;
  onStartSpeaking?: () => any;
  onStoppedSpeaking?: () => any;
  speechRecognitionProperties?: SpeechRecognitionProperties;
  timeout?: number;
  useLegacyResults?: boolean;
  useOnlyGoogleCloud?: boolean;
}

export default function useSpeechToText({
  continuous,
  crossBrowser = true,
  googleApiKey,
  googleCloudRecognitionConfig,
  onStartSpeaking = () => { console.log('started'); },
  onStoppedSpeaking = () => { console.log('stopped'); },
  speechRecognitionProperties = { interimResults: true },
  timeout = 10000,
  useOnlyGoogleCloud = false,
  useLegacyResults = true
}: UseSpeechToTextTypes) {
  const [isRecording, setIsRecording] = useState(false);

  const audioContextRef = useRef<AudioContext>();

  const [legacyResults, setLegacyResults] = useState<string[]>([]);
  const [results, setResults] = useState<ResultType[]>([]);

  const [interimResult, setInterimResult] = useState<string | undefined>();
  const [error, setError] = useState('');

  const timeoutId = useRef<number>();
  const mediaStream = useRef<MediaStream>();

  useEffect(() => {
    if (!crossBrowser && !recognition) {
      setError('Speech Recognition API is only available on Chrome');
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      setError('getUserMedia is not supported on this device/browser :(');
    }

    if ((crossBrowser || useOnlyGoogleCloud) && !googleApiKey) {
      console.error(
        'No google cloud API key was passed, google API will not be able to process speech'
      );
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    if (useLegacyResults) {
      console.warn(
        'react-hook-speech-to-text is using legacy results, pass useLegacyResults: false to the hook to use the new array of objects results. Legacy array of strings results will be removed in a future version.'
      );
    }
  }, []);

  // Chrome Speech Recognition API:
  // Only supported on Chrome browsers
  const chromeSpeechRecognition = () => {
    if (recognition) {
      // Continuous recording after stopped speaking event
      if (continuous) recognition.continuous = true;

      const { grammars, interimResults, lang, maxAlternatives } =
        speechRecognitionProperties || {};

      if (grammars) recognition.grammars = grammars;
      if (lang) recognition.lang = lang;

      recognition.interimResults = interimResults || false;
      recognition.maxAlternatives = maxAlternatives || 1;

      // start recognition
      recognition.start();

      // speech successfully translated into text
      recognition.onresult = (e) => {
        const result = e.results[e.results.length - 1];
        const { transcript } = result[0];

        const timestamp = Math.floor(Date.now() / 1000);

        // Allows for realtime speech result UI feedback
        if (interimResults) {
          if (result.isFinal) {
            setInterimResult(undefined);
            // setResults((prevResults) => [
            //   ...prevResults,
            //   { transcript, timestamp }
            // ]);
            setResults((prevResults) => {
              let answer: string = '';
              if (transcript == 'hello' || transcript == 'hi'){
                answer = greetings[Math.random() * 3];
              }
              console.log('answer: ', answer);
              return [
                ...prevResults,
                { transcript: answer, timestamp }
              ]
            });
            setLegacyResults((prevResults) => [...prevResults, transcript]);
          } else {
            let concatTranscripts = '';

            // If continuous: e.results will include previous speech results: need to start loop at the current event resultIndex for proper concatenation
            for (let i = e.resultIndex; i < e.results.length; i++) {
              concatTranscripts += e.results[i][0].transcript;
            }

            setInterimResult(concatTranscripts);
          }
        } else {
          // setResults((prevResults) => [
          //   ...prevResults,
          //   { transcript, timestamp }
          // ]);
          setResults((prevResults) => {
            let answer: string = '';
            if (transcript == 'hello' || transcript == 'hi'){
              answer = greetings[Math.random() * 3];
            }
            console.log('answer: ', answer);
            return [
              ...prevResults,
              { transcript: answer, timestamp }
            ]
          });
          setLegacyResults((prevResults) => [...prevResults, transcript]);
        }
      };

      recognition.onaudiostart = () => setIsRecording(true);

      // Audio stopped recording or timed out.
      // Chrome speech auto times-out if no speech after a while
      recognition.onend = () => {
        setIsRecording(false);
      };
    }
  };

  const startSpeechToText = async () => {
    if (!useOnlyGoogleCloud && recognition) {
      chromeSpeechRecognition();
      return;
    }

    if (!crossBrowser && !useOnlyGoogleCloud) {
      return;
    }

    // Resume audio context due to google auto play policy
    // https://developers.google.com/web/updates/2017/09/autoplay-policy-changes#webaudio
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current?.resume();
    }

    const stream = await startRecording({
      errHandler: () => setError('Microphone permission was denied'),
      audioContext: audioContextRef.current as AudioContext
    });

    setIsRecording(true);

    // Stop recording if timeout
    if (timeout) {
      clearTimeout(timeoutId.current);
      handleRecordingTimeout();
    }

    // stop previous mediaStream track if exists
    if (mediaStream.current) {
      stopMediaStream();
    }

    // Clones stream to fix hark bug on Safari
    mediaStream.current = stream.clone();

    const speechEvents = Hark(mediaStream.current, {
      audioContext: audioContextRef.current as AudioContext
    });

    speechEvents.on('speaking', () => {
      if (onStartSpeaking) onStartSpeaking();
      // startSpeechToText();

      // Clear previous recording timeout on every speech event
      clearTimeout(timeoutId.current);
    });

    speechEvents.on('stopped_speaking', () => {
      if (onStoppedSpeaking) onStoppedSpeaking();
      // stopSpeechToText();
      // Stops current recording and sends audio string to google cloud.
      // recording will start again after google cloud api
      // call if `continuous` prop is true. Until the api result
      // returns, technically the microphone is not being captured again
      stopRecording({
        exportWAV: true,
        wavCallback: (blob) =>
          handleBlobToBase64({ blob, continuous: continuous || false })
      });
    });
  };

  const stopSpeechToText = () => {
    if (recognition && !useOnlyGoogleCloud) {
      recognition.stop();
    } else {
      setIsRecording(false);
      stopMediaStream();
      stopRecording({
        exportWAV: true,
        wavCallback: (blob) => handleBlobToBase64({ blob, continuous: false })
      });
    }
  };

  const handleRecordingTimeout = () => {
    timeoutId.current = window.setTimeout(() => {
      setIsRecording(false);
      stopMediaStream();
      stopRecording({ exportWAV: false });
    }, timeout);
  };

  const handleBlobToBase64 = ({
    blob,
    continuous
  }: {
    blob: Blob;
    continuous: boolean;
  }) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);

    reader.onloadend = async () => {
      const base64data = reader.result as string;

      let sampleRate = audioContextRef.current?.sampleRate;

      // Google only accepts max 48000 sample rate: if
      // greater recorder js will down-sample to 48000
      if (sampleRate && sampleRate > 48000) {
        sampleRate = 48000;
      }

      const audio = { content: '' };

      const config: GoogleCloudRecognitionConfig = {
        encoding: 'LINEAR16',
        languageCode: 'en-US',
        sampleRateHertz: sampleRate,
        ...googleCloudRecognitionConfig
      };

      const data = {
        config,
        audio
      };

      // Gets raw base 64 string data
      audio.content = base64data.substr(base64data.indexOf(',') + 1);

      const googleCloudRes = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${googleApiKey}`,
        {
          method: 'POST',
          body: JSON.stringify(data)
        }
      );

      const googleCloudJson = await googleCloudRes.json();

      // Update results state with transcribed text
      if (googleCloudJson.results?.length > 0) {
        const { transcript } = googleCloudJson.results[0].alternatives[0];

        setLegacyResults((prevResults) => [...prevResults, transcript]);

        // setResults((prevResults) => [
        //   ...prevResults,
        //   {
        //     speechBlob: blob,
        //     transcript,
        //     timestamp: Math.floor(Date.now() / 1000)
        //   }
        // ]);

        setResults((prevResults) => {
          let answer: string = '';
          let question = transcript.toLowerCase();
          if (question == 'hello' || question == 'hi'){
            const random = Math.floor(Math.random() * (3 - 0) + 0);
            console.log('rand: ', random);
            answer = greetings[random];
          }
          else if (question == 'how are you' || question == 'how are you doing' || question == 'what\'s up'){
            const random = Math.floor(Math.random() * (4 - 0) + 0);
            console.log('rand: ', random);
            answer = howAreYouAnswers[random];
          }
          else if (question == 'what is computer science' || question == 'what is informatics'){
            answer = computerScienceDef[0];
          }
          else if (question == 'what can you do'){
            answer = whatCanDo[0];
          }
          else if (question == 'what can we discuss'){
            answer = whatCanDiscuss[0];
          }
          else if (question == 'what is algorithm' || question == 'what is algorithms' || question == 'what can you tell me about algorithms'){
            answer = algoritms[0];
          }
          else if (question == 'what is intelligent system' || question == 'which system we can define as an intelligent'){
            answer = intelligent[0];
          }
          else if (question == 'what is system engineering'){
            answer = engineering[0];
          }
          else if (question == 'parallel computing'){
            answer = parallel[0];
          }
          else if (question == 'distributed computing'){
            answer = distributed[0];
          }
          else if (question == 'difference between parallel and distributed computing' || question == 'difference between distributed and parallel computing'){
            answer = parallelDistributed[0];
          }
          else {
            answer = transcript;
          }
          console.log('answer: ', answer);
          return [
            ...prevResults,
            {
              speechBlob: blob,
              transcript: answer,
              timestamp: Math.floor(Date.now() / 1000)
            }
          ]
        });
      }

      if (continuous) {
        startSpeechToText();
      } else {
        stopMediaStream();
        setIsRecording(false);
      }
    };
  };

  const stopMediaStream = () => {
    mediaStream.current?.getAudioTracks()[0].stop();
  };

  return {
    error,
    interimResult,
    isRecording,
    results: useLegacyResults ? legacyResults : results,
    setResults,
    startSpeechToText,
    stopSpeechToText
  };
}
