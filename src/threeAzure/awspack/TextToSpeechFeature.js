// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import CoreTextToSpeechFeature from 'core/awspack/TextToSpeechFeature';

/**
 * @extends core/awspack/TextToSpeechFeature
 * @alias threeAzure/TextToSpeechFeature
 */
class TextToSpeechFeature extends CoreTextToSpeechFeature {
    /**
     * @constructor
     *
     * @param {three/HostObject} host - Host object managing the feature.
     * @param {Object=} options - Options that will be sent to Polly for each speech.
     * @param {external:"THREE.AudioListener"} options.listener - Three audio listener to use with
     * audio.
     * @param {external:"THREE.Object3D"=} options.attachTo - Optional object to attach the speech
     * audio to.
     */
    constructor(
        host,
        options = {
            voice: undefined,
            engine: undefined,
            language: undefined,
            audioFormat: 'mp3',
            sampleRate: undefined,
            listener: undefined,
            attachTo: undefined,
        }
    ) {
        super(host, options);
        this._listener = options.listener;
        this._attachTo = options.attachTo || host.owner;
        this._setAudioContext();
        this._observeAudioContext();
        this._AzureAwsLookups = this._makeAzuAwsVismLookups();
        //TextToSpeechFeature._AzureServiceKey = null;
        //TextToSpeechFeature._AzureServiceRegion = null;
        //this._AzureServiceKey = null ;
        //this._AzureServiceRegion = null;
        //this.initializeForAzure = this._initializeForAzure;
    }

    static async initializeService(polly, presigner, version) {
        this._isReady = true;
        this.emit(this.EVENTS.ready);
    }

    static async initializeForAzure(ServiceKey, ServiceRegion) {
        this.SERVICES.AzureServiceKey = ServiceKey;
        this.SERVICES.AzureServiceRegion = ServiceRegion;
        this._isReady = true;
        this.emit(this.EVENTS.ready);
    }

    _validate() {
        this._isValidated = true;
    }

    _setAudioContext() {
        if (this._listener) {
            this._audioContext = this._listener.context;
        }
    }

    _updateSpeech(text, config, force = false) {
        const speech = this._speechCache[text] || {};
        // Exit if nothing has changed and force is false
        if (
            !force &&
            config !== undefined &&
            speech.config &&
            JSON.stringify(config) === JSON.stringify(speech.config)
        ) {
            return speech;
        }

        //var voiceName = "en-US-AriaNeural";  // <-- MsDocs: 13/11/2021 - Aria Neural is the only Azure voice that handles bookmarks
        // Update: Not the case any more? Seems working with ChristopherNeural - see below
        // https://docs.microsoft.com/en-gb/azure/cognitive-services/speech-service/speech-synthesis-markup?tabs=csharp#bookmark-element

        // Generate audio and speechmarks
        speech.config = config;
        speech.promise = new Promise(resolve => {

            var ssmlPart = this._tidyTextMakeAzureSSML(text, this._voice);

            const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(this.constructor?.SERVICES?.AzureServiceKey, this.constructor?.SERVICES?.AzureServiceRegion);

            const audioStream = SpeechSDK.AudioOutputStream.createPullStream();
            const audioConfig = SpeechSDK.AudioConfig.fromStreamOutput(audioStream);
            const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);
            const azSpeechMarks = {};

            synthesizer.visemeReceived = function (s, e) {
                let msOffset = e.audioOffset / 10000;
                let key = `${msOffset}_viseme`;
                azSpeechMarks[key] = { type: "viseme", audioOffset: msOffset, visemeId: e.visemeId };
            }

            synthesizer.bookmarkReached = function (s, e) {
                let msOffset = e.audioOffset / 10000;
                let key = `${msOffset}_mark`;
                azSpeechMarks[key] = { type: "mark", audioOffset: msOffset, mark: e.text };
            }

            // 13/11/2021: Sentance boundaries not in Azure yet. Only available in Windows.Media.SpeechSynthesis (Desktop)
            // https://docs.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizeroptions

            // Uncomment for Azure word boundaries
            //synthesizer.wordBoundary = function (s, e) {
            //    console.log("wordBoundary", e);  
            //}

            _synthesizeSpeech(synthesizer, ssmlPart, (result) => {

                var blob = new Blob([result.audioData], { type: "octet/stream" }),
                    url = window.URL.createObjectURL(blob);

                var azSpeechMarks = result.azSpeechMarks;

                Promise.all([
                    this._synthesizeSpeechmarks(azSpeechMarks),
                    this._synthesizeAudio(url),
                ]).then(results => {
                    return resolve(this._createSpeech(text, ...results));
                });
            });

            // The actual cloud call
            function _synthesizeSpeech(synthesizer, ssmlIn, callback) {

                synthesizer.speakSsmlAsync(ssmlIn,
                    result => {
                        if (result) {
                            synthesizer.close();
                            result.azSpeechMarks = azSpeechMarks;
                            callback(result);
                        }
                    },
                    error => {
                        console.log(error);
                        synthesizer.close();
                    }
                );
            }
        });

        this._speechCache[text] = speech;

        return speech;
    }

    _tidyTextMakeAzureSSML(ssmlBody, voice) {
        ssmlBody = ssmlBody.replace("<speak>", "");
        ssmlBody = ssmlBody.replace("</speak>", "");
        ssmlBody = ssmlBody.replace("<amazon:domain name=\"conversational\">", "");
        ssmlBody = ssmlBody.replace("</amazon:domain>", "");
        var tidiedString = ssmlBody.replace(/\n/g, " ");
        tidiedString = tidiedString.replace(/\s+/g, ' ').trim();
        return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.regionCode}"><voice name="${voice.name}">${tidiedString}</voice></speak>`;
    }

    _synthesizeAudio(url) {

        //const url = "http://localhost:1337/examples/assets/audio/audio.wav";
        const result = { url };

        // Create an Audio object that points to the presigned url
        const audio = new Audio(url);
        audio.loop = this.loop;
        audio.crossOrigin = 'anonymous';
        audio.preload = 'auto';
        result.audio = audio;

        if (this._attachTo !== undefined && !this._isGlobal) {
            // Create positional audio if there's an attach point
            result.threeAudio = new THREE.PositionalAudio(this._listener);
            this._attachTo.add(result.threeAudio);
        } else {
            // Create non-positional audio
            result.threeAudio = new THREE.Audio(this._listener);
        }

        // Set Audio object as the source
        result.threeAudio.setMediaElementSource(result.audio);

        return new Promise(resolve => {
            // Resolve once the minimum amount is loaded
            audio.addEventListener('canplaythrough', () => {
                resolve(result);
            });

            // Start loading the audio
            document.body.appendChild(audio);
            audio.load();
        });
    }

    _synthesizeSpeechmarks(azSpeechMarks) {
        const dataItems = [];

        let keys = Object.keys(azSpeechMarks);
        for (var a = 0; a < keys.length; a++) {
            let item = azSpeechMarks[keys[a]];
            if (item.type === "viseme") {
                dataItems.push({ time: item.audioOffset, type: "viseme", value: this._AzureAwsLookups[item.visemeId] });
            }
            else {
                dataItems.push({ time: item.audioOffset, type: "ssml", value: item.mark });
            }
        }

        const markTypes = {
            sentence: [],
            word: [],
            viseme: [],
            ssml: [],
        };
        const endMarkTypes = {
            sentence: null,
            word: null,
            viseme: null,
            ssml: null,
        };

        const speechMarks = dataItems.map(
            mark => {
                // Set the duration of the last speechmark stored matching this one's type
                const numMarks = markTypes[mark.type].length;
                if (numMarks > 0) {
                    const lastMark = markTypes[mark.type][numMarks - 1];
                    lastMark.duration = mark.time - lastMark.time;
                }

                markTypes[mark.type].push(mark);
                endMarkTypes[mark.type] = mark;
                return mark;
            }
        );

        // Find the time of the latest speechmark
        const endTimes = [];
        if (endMarkTypes.sentence) {
            endTimes.push(endMarkTypes.sentence.time);
        }
        if (endMarkTypes.word) {
            endTimes.push(endMarkTypes.word.time);
        }
        if (endMarkTypes.viseme) {
            endTimes.push(endMarkTypes.viseme.time);
        }
        if (endMarkTypes.ssml) {
            endTimes.push(endMarkTypes.ssml.time);
        }
        const endTime = Math.max(...endTimes);

        // Calculate duration for the ending speechMarks of each type
        if (endMarkTypes.sentence) {
            endMarkTypes.sentence.duration = Math.max(
                this._minEndMarkDuration,
                endTime - endMarkTypes.sentence.time
            );
        }
        if (endMarkTypes.word) {
            endMarkTypes.word.duration = Math.max(
                this._minEndMarkDuration,
                endTime - endMarkTypes.word.time
            );
        }
        if (endMarkTypes.viseme) {
            endMarkTypes.viseme.duration = Math.max(
                this._minEndMarkDuration,
                endTime - endMarkTypes.viseme.time
            );
        }
        if (endMarkTypes.ssml) {
            endMarkTypes.ssml.duration = Math.max(
                this._minEndMarkDuration,
                endTime - endMarkTypes.ssml.time
            );
        }

        //console.log("speechMarks", speechMarks);

        return speechMarks;
    }

    _makeAzuAwsVismLookups() {
        let AzuAwsVismXref = function (azVisemeId, ipaNameExamplePairsArray, awsVisemes) {
            this.azVisemeId = azVisemeId;
            this.ipaNameExamplePairsArray = ipaNameExamplePairsArray;
            this.awsVisemes = awsVisemes;
        }

        let AzuAwsVismXrefTable = [
            new AzuAwsVismXref(1, [['æ', '[a]ctive'], ['ʌ', '[u]ncle'], ['ə', '[a]go'], ['ɚ', 'all[er]gy']], ['a', '@', 'E']),
            new AzuAwsVismXref(2, [['ɑ', '[o]bstinate'], ['ɑɹ', '[ar]tist']], ['a']),
            new AzuAwsVismXref(3, [['ɔ', 'c[au]se'], ['ɔɹ', '[or]ange']], ['O']),
            new AzuAwsVismXref(4, [['eɪ', '[a]te'], ['ɛ', '[e]very'], ['ʊ', 'b[oo]k'], ['ɛɹ', '[air]plane'], ['ʊɹ', 'c[ur]e']], ['e', 'E', 'u']),
            new AzuAwsVismXref(5, [['ɝ', '[ear]th']], ['E']),
            new AzuAwsVismXref(6, [['i', '[ea]t'], ['ɪ', '[i]f'], ['ju', '[Yu]ma'], ['ɪɹ', '[ear]s'], ['j', '[y]ard, f[e]w']], ['i']),
            new AzuAwsVismXref(7, [['u', '[U]ber'], ['ju', '[Yu]ma'], ['w', '[w]ith, s[ue]de']], ['u']),
            new AzuAwsVismXref(8, [['oʊ', '[o]ld']], ['o']),
            new AzuAwsVismXref(9, [['aʊ', '[ou]t'], ['aʊ(ə)ɹ', '[hour]s']], ['a']),
            new AzuAwsVismXref(10, [['ɔɪ', '[oi]l']], ['O']),
            new AzuAwsVismXref(11, [['aɪ', '[i]ce'], ['aɪ(ə)ɹ', '[Ire]land']], ['a']),
            new AzuAwsVismXref(12, [['h', '[h]elp']], ['k']),
            new AzuAwsVismXref(13, [['ɪɹ', '[ear]s'], ['ɛɹ', '[air]plane'], ['ʊɹ', 'c[ur]e'], ['aɪ(ə)ɹ', '[Ire]land'], ['aʊ(ə)ɹ', '[hour]s'],
            ['ɔɹ', '[or]ange'], ['ɑɹ', '[ar]tist'], ['ɝ', '[ear]th'], ['ɚ', 'all[er]gy'], ['ɹ', '[r]ed, b[r]ing']], ['r']),
            new AzuAwsVismXref(14, [['l', '[l]id, g[l]ad']], ['t']),
            new AzuAwsVismXref(15, [['s', '[s]it'], ['z', '[z]ap']], ['s']),
            new AzuAwsVismXref(16, [['ʃ', '[sh]e'], ['ʒ', '[J]acques'], ['tʃ', '[ch]in'], ['dʒ', '[j]oy']], ['S']),
            new AzuAwsVismXref(17, [['θ', '[th]in'], ['ð', '[th]en']], ['T']),
            new AzuAwsVismXref(18, [['f', '[f]ork'], ['v', '[v]alue']], ['f']),
            new AzuAwsVismXref(19, [['t', '[t]alk'], ['d', '[d]ig'], ['n', '[n]o, s[n]ow']], ['t']),
            new AzuAwsVismXref(20, [['k', '[c]ut'], ['g', '[g]o'], ['ŋ', 'li[n]k']], ['k']),
            new AzuAwsVismXref(21, [['p', '[p]ut'], ['b', '[b]ig'], ['m', '[m]at, s[m]ash']], ['p'])
        ];
        var obj = {};
        AzuAwsVismXrefTable.forEach((xref) => {
            obj[xref.azVisemeId] = xref.awsVisemes[0]; // Simple implementation: Obly takes the first AWS viseme but some are multi - needs improving (further dividing)
        });

        return obj;
    }
}

export default TextToSpeechFeature;
