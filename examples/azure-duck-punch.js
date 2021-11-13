// WARNING: This is the quick hack version that goes with three-azure-v1.html. 
// It was just a quick dive into the modules, hacking my way through with no grace.
// Move straight on to three-azure-v2 for a proper module webpacked version

function duckPunchAwsIntoAzure(getCurrentHostFunc) {
    let orig1 = HOST.aws.TextToSpeechFeature.initializeService;
    HOST.aws.TextToSpeechFeature.initializeService = async function (polly, presigner, windowAwsVersion) {
        this.polly2 = polly;
        this.presigner2 = presigner;
        this.windowAwsVersion2 = windowAwsVersion;
        this.origFunc = orig1;
        console.log("'HOST.aws.TextToSpeechFeature.initializeService' is currently knocked out!! (stubbed)");
        // return orig1.call(this, arguments);
    }

    //let origInstallApi = HOST.aws.TextToSpeechFeature.prototype.installApi;
    //HOST.aws.TextToSpeechFeature.prototype.installApi = function () {
    //    let api = origInstallApi.call(this, arguments);
    //    console.log("installApi...", api);
    //    api.play = function (param) {
    //        console.log("Button pressed: PLAY 2", param);
    //        var host = getCurrentHostFunc();
    //        azureTextToSpeech(param, host);
    //    }
    //    return api;
    //}
}

let VisemeHandler = function (host, visemes) {
    let awsVisemes = [];
    this.index = 0;
    this.startContextMs = -1;
    for (var a = 0; a < visemes.length; a++) {
        let azVis = visemes[a];
        if (azVis.visemeId === 0) {
            continue;
        }
        var visemeDuration = 200;
        if (a < visemes.length - 1) {
            visemeDuration = visemes[a + 1].audioOffset - azVis.audioOffset;
        }
        if (visemeDuration < 25) {
            visemeDuration = 25;
        }
        awsVisemes.push({ audioOffset: azVis.audioOffset, visemeId: AzuAwsVismLookup[azVis.visemeId], visemeDuration });
    };
    let visemesLength = awsVisemes.length;
    var nextViseme = awsVisemes[0];
    //console.log("awsVisemes", host, host?._features, host?._features?.LipsyncFeature);
    host._features.LipsyncFeature._onPlay();

    this.CheckForViseme = function () {
        if (!host.sound || !host.sound.context) {
            return
        }
        let currentMs = host.sound.context.currentTime * 1000;
        if (this.startContextMs === -1) {
            this.startContextMs = currentMs;
        }
        //console.log("currentMs | audioOffset", currentMs, nextViseme.audioOffset + this.startContextMs);
        while (currentMs >= nextViseme.audioOffset + this.startContextMs) {
            raiseVisemeEvent(host, nextViseme.visemeId, nextViseme.visemeDuration - 5);
            this.index++;
            if (this.index >= visemesLength) {
                host.visemeHandler = undefined;
                //console.log("Done visemes", host.sound);
                host._features.LipsyncFeature._onStop();
                return;
            }
            nextViseme = awsVisemes[this.index];
        }
    }
}

// Just a harness for later, using play button only
let handleButtons = function (host) {
    this.play = function (param) {
        console.log("Button pressed: PLAY");
        azureTextToSpeech(param, host);
    }
    this.stop = function (param) { console.log("Button pressed: STOP"); }
    this.pause = function (param) { console.log("Button pressed: PAUSE"); }
    this.resume = function (param) { console.log("Button pressed: RESUME"); }
}


// Azure bits below ------------------------------------------------

function azureTextToSpeech(param, host) {
    var lang = "en-US";
    var voiceName = "en-US-ChristopherNeural";
    getAzureTTS(param, lang, voiceName, host);
}

function raiseVisemeEvent(host, visemeValue, duration) {
    var speechMark = { mark: { value: visemeValue, duration: duration } };
    host._features.TextToSpeechFeature.emit("onVisemeEvent", speechMark);                   // Async (not awaited, fire n forget)
    //host._features.LipsyncFeature._onViseme({ mark: { value: visemeValue, duration } });  // Synch
}

function getAzureTTS(ssmlBody, langCode, voiceName, host) {
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription("<Your Azure Speech Cognitive Key (a long hex number)>", "<Your Service Region (eg uksouth)>");

    const audioStream = SpeechSDK.AudioOutputStream.createPullStream();
    const audioConfig = SpeechSDK.AudioConfig.fromStreamOutput(audioStream);
    const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);
    const visemes = [];

    synthesizer.visemeReceived = function (s, e) {
        visemes.push({ audioOffset: e.audioOffset / 10000, visemeId: e.visemeId });
    }

    var ssmlPart = tidyTextMakeAzureSSML(ssmlBody)

    synthesizeSpeech(ssmlPart, handleSynthResult);

    function handleSynthResult(result) {
        console.log("result", result);
        if (!result.audioData || result.audioData.byteLength === 0) {
            alert("No results returned from Azure for that input string");
            return;
        }

        //saveData(buffer, "sound.wav"); // save to file

        // Make a Data URL from returned WAV file
        var blob = new Blob([result.audioData], { type: "octet/stream" }),
            url = window.URL.createObjectURL(blob);

        // Queue up the visemes
        host.visemeHandler = new VisemeHandler(host, result.visemes);

        // Start playing the audio and watch progress in the animation loop
        host.sound = new THREE.Audio(host.audioListener);
        // host.sound.onEnded = () => {  console.log("sound.onEnded - a useful event, depending your needs");(); };

        // Use the built-in audio loaded buffer reader - accepts both AWS mp3 and Azure Wav
        const audioLoader = new THREE.AudioLoader();
        audioLoader.load(url, function (buffer) {
            host.sound.setBuffer(buffer);
            host.sound.setVolume(0.5);
            host.sound.play();
        });
    }

    function tidyTextMakeAzureSSML(ssmlBody) {
        ssmlBody = ssmlBody.replace("<speak>", "");
        ssmlBody = ssmlBody.replace("</speak>", "");
        ssmlBody = ssmlBody.replace("<amazon:domain name=\"conversational\">", "");
        ssmlBody = ssmlBody.replace("</amazon:domain>", "");
        var tidiedString = ssmlBody.replace(/\n/g, " ");
        tidiedString = tidiedString.replace(/\s+/g, ' ').trim();
        return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${langCode}"><voice name="${voiceName}">${tidiedString}</voice></speak>`;
    }

    // The actual cloud call
    function synthesizeSpeech(ssmlIn, callback) {
        synthesizer.speakSsmlAsync(ssmlIn,
            result => {
                if (result) {
                    synthesizer.close();
                    result.visemes = visemes;
                    callback(result);
                }
            },
            error => {
                console.log(error);
                synthesizer.close();
            }
        );
    }
}

// Optional tools 
// For dowloading webpage constructed stuffz
var saveData = (function () {
    var a = document.createElement("a");
    document.body.appendChild(a);
    a.style = "display: none";
    return function (data, fileName) {
        var blob = new Blob([data], { type: "octet/stream" }),
            url = window.URL.createObjectURL(blob);
        a.href = url;
        a.download = fileName;
        a.click();
        window.URL.revokeObjectURL(url);
        console.log("data downloaded");
    };
}());

// For to play stuff, like
function playAudio(listener) {
    console.log("yey");
    const audio = new Audio("/examples/assets/audio/audio.wav");
    document.body.appendChild(audio);
    //audio.load();
    audio.play();

    // https://threejs.org/docs/#api/en/audio/AudioListener
    //const sound = new THREE.Audio(listener);
    //// load a sound and set it as the Audio object's buffer
    //const audioLoader = new THREE.AudioLoader();
    //audioLoader.load("/examples/assets/audio/audio.mp3", function (buffer) {
    //    sound.setBuffer(buffer);
    //    sound.setLoop(true);
    //    sound.setVolume(0.5);
    //    sound.play();
    //});

}


// Useful reads and refs for composng/correcting the x-ref tables below
//
// https://aws-samples.github.io/amazon-sumerian-hosts/global.html#DefaultVisemeMap
// vs
// https://docs.microsoft.com/en-gb/azure/cognitive-services/speech-service/how-to-speech-synthesis-viseme?pivots=programming-language-csharp

// also note
// http://www.tapiex.com/ES_Help/SPEECH_VISEMETYPE.htm

// best list
// https://docs.aws.amazon.com/polly/latest/dg/ph-table-english-us.html

// Python with images
// https://docs.aws.amazon.com/code-samples/latest/catalog/python-polly-polly_lipsync.py.html

// Polly - Mary had a little lamb
// https://docs.aws.amazon.com/polly/latest/dg/speechmarkexamples.html
//

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
]

let AzuAwsVismLookup = {};
AzuAwsVismXrefTable.forEach((xref) => {
    AzuAwsVismLookup[xref.azVisemeId] = xref.awsVisemes[0]; // Simple implementation: Obly takes the first AWS viseme but some are multi - needs improving (further dividing)
});


////////////////////////////// -------------------- MODULE EXPORTS

export { playAudio, getAzureTTS, duckPunchAwsIntoAzure, handleButtons }