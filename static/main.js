// ################################
// # AUDIO GENERATION AND QUEUING #
// ################################
/**
 * Queues up audio as needed. This should be called intermittently
 */
async function queueIfNeeded() {
    if (!IS_PLAYING || INFLIGHT_GENERATIONS > 0) {
        return;
    }

    const settings = getPromptSettings();
    if (settings != null) {
        let minimumBuffer = estimatedGenerationTime(settings.steps, settings.length);
        // Longer generations can vary wildy in generation time. Add some buffer to compensate.
        if (settings.length >= 30) {
            minimumBuffer = minimumBuffer * 1.40;
        } else {
            minimumBuffer = minimumBuffer * 1.25;
        }
        minimumBuffer += 2.0; // Try to maintain at least a two second buffer period
        
        const enoughBuffer = remainingBufferTime() > minimumBuffer;
        if (!enoughBuffer) {
            INFLIGHT_GENERATIONS += 1;
            const now = Date.now();
            
            const item = pushQueueItem(settings);
            if (increment_seed_checkbox.checked) {
                seed_input.value = (parseInt(seed_input.value) + 1).toString();
            }
            try {
                // Build and send request
                const {url, body} = buildGenerationRequest(settings);
                const arrayBuffer = await fetch(url, {
                    method: "POST",
                    body,
                }).then(res => res.arrayBuffer());
                // Set up audioBuffer + node
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                const node = audioCtx.createBufferSource();
                node.buffer = audioBuffer
                node.connect(getDestinationNode());
                
                // Queue audio node
                const queueTime = getLatestQueuedOrNow();
                LATEST_QUEUED_TIME = queueTime + getPreciseDuration(settings.length);                
                node.start(queueTime);
                
                // Update playlist 
                await item.setQueued(audioBuffer, queueTime);
                
                // Update stats
                const elapsed = (Date.now() - now) / 1000.0;
                recordGenerationStats(settings.steps, audioBuffer.duration, elapsed);
                setEstimatedTimeDisplay()
            } catch (error) {
                item.setExpired();
                console.error(error);
            }
            INFLIGHT_GENERATIONS -= 1;
        }
    }
}

/**
 * @param {number} steps
 * @param {number} length
 * @returns {number} The estimated amount of time, in seconds, that it takes to generate the next batch of audio.
 */
function estimatedGenerationTime(steps, length) {
    if (RECENT_STEPSECONDS.length == 0) {
        // at 60 seconds, about 2 iterations per second
        // at 50 seconds, about 3 iterations per second
        // at 40 seconds, about 4 iterations per second
        // at 30 seconds, about 5 iterations per second
        // at 20 seconds, about 7 iterations per second
        // at 10 seconds, about 10 iterations per second
        // see graph: https://www.desmos.com/calculator/hai0oucjod
        let stepsPerSecond = 10.0 - length / 6.0;
        stepsPerSecond = Math.min(Math.max(stepsPerSecond, 0.5), 10.0);
        return (steps / stepsPerSecond);
    }
    // "data" seconds generated per second
    const total_step_seconds = RECENT_STEPSECONDS.map(x => x.stepSeconds).reduce((a, b) => a + b, 0.0)
    const total_elapsed = RECENT_STEPSECONDS.map(x => x.elapsed).reduce((a, b) => a + b, 0.0)
    const seconds_steps_per_second = total_step_seconds / total_elapsed;
    const estimate = length * steps / seconds_steps_per_second;
    return estimate;
}


/**
 * @typedef {{
 *      audio: Blob;
 *      source: string;
 *      init_noise_level: number;
 * }} InitAudioArgs
 */

/**
 * @typedef {{
 *      paste_from: number;
 *      paste_to: number;
 *      crop_from: number;
 *      mask_start: number;
 *      mask_end: number;
 *      softness_left: number;
 *      softness_right: number;
 *      marination: number;
 * }} MaskArgs
 */

/**
 * @typedef {{ 
*     positive_prompt: string | null,
*     negative_prompt: string | null,
*     cfg: number,
*     sigma_min: number,
*     sigma_max: number,
*     seed: number,
*     steps: number,
*     length: number,
*     init_audio: InitAudioArgs | null,
*     mask_args: MaskArgs | null
* }} PromptSettings
* Get the prompt settings from the controls on the page. Returns null if any of the prompt controls 
* contain invalid input.
* @returns {PromptSettings | null}
*/
function getPromptSettings() {
    const inputs = [
        cfg_input,
        sigma_min_input,
        sigma_max_input,
        seed_input,
        steps_input,
        length_input,
        init_noise_level_input,
        paste_from_input,
        paste_to_input,
        crop_from_input,
        mask_start_input,
        mask_end_input,
        softness_left_input,
        softness_right_input,
        marination_input,

    ];
    if (inputs.some(input => !input.checkValidity())) {
        return null;
    }
    
    let negative_prompt = null;
    if (negative_prompt_enable_checkbox.checked || negative_prompt_textarea.value != "") {
        negative_prompt = negative_prompt_textarea.value;
    }

    let init_audio_args = null;
    let init_audio_blob = getInitAudioBlob();
    if (init_audio_blob != null) {
        init_audio_args = {
            audio: init_audio_blob.audio,
            source: init_audio_blob.source,
            init_noise_level: parseFloat(init_noise_level_input.value)
        };
    }

    let mask_args = null;
    if (mask_args_checkbox.checked) {
        mask_args = {
            paste_from: parseFloat(paste_from_input.value),
            paste_to: parseFloat(paste_to_input.value),
            crop_from: parseFloat(crop_from_input.value),
            mask_start: parseFloat(mask_start_input.value),
            mask_end: parseFloat(mask_end_input.value),
            softness_left: parseFloat(softness_left_input.value),
            softness_right: parseFloat(softness_right_input.value),
            marination: parseFloat(marination_input.value),
        };
    }

   return {
       "positive_prompt": positive_prompt_textarea.value,
       "negative_prompt": negative_prompt,
       "cfg": parseFloat(cfg_input.value),
       "sigma_min": parseFloat(sigma_min_input.value),
       "sigma_max": parseFloat(sigma_max_input.value),
       "seed": parseInt(seed_input.value),
       "steps": parseInt(steps_input.value),
       "length": parseFloat(length_input.value),
       "init_audio": init_audio_args,
       "mask_args": mask_args,
   }
}

/**
 * @returns {BlobWithSource | null}
 */
function getInitAudioBlob() {
    switch (init_audio_dropdown.value) {
        case "off": return null;
        case "file": return UPLOADED_AUDIO;
        // Try to return latest playlist item. Otherwise, fallback to uploaded audio.
        case "wander": return getLatestPlaylistItemBlob() ?? UPLOADED_AUDIO;
        case "microphone": return null;
    }
    throw new Error(`Invalid dropdown setting ${init_audio_dropdown.value}`);
}
/**
* Build the request using the given settings.
* @param {PromptSettings} settings 
* @returns {{ url: URL, body: FormData }} The request
*/
function buildGenerationRequest(settings) {
    const body = new FormData();

    if (settings.positive_prompt != null) {
        body.append("positive_prompt", settings.positive_prompt);
    }

    if (settings.negative_prompt != null) {
        body.append("negative_prompt", settings.negative_prompt);
    }
    body.append("cfg_scale", settings.cfg.toString());
    body.append("sigma_min", settings.sigma_min.toString());
    body.append("sigma_max", settings.sigma_max.toString());

    body.append("seed", settings.seed.toString());
    body.append("steps", settings.steps.toString());
    body.append("length", settings.length.toString());

    if (settings.init_audio != null) {
        body.append("init_audio", settings.init_audio.audio);
        body.append("init_noise_level", settings.init_audio.init_noise_level.toString());
    }

    if (settings.mask_args != null) {
        body.append("paste_from", settings.mask_args.paste_from.toString());
        body.append("paste_to", settings.mask_args.paste_to.toString());
        body.append("crop_from", settings.mask_args.crop_from.toString());
        body.append("mask_start", settings.mask_args.mask_start.toString());
        body.append("mask_end", settings.mask_args.mask_end.toString());
        body.append("softness_left", settings.mask_args.softness_left.toString());
        body.append("softness_right", settings.mask_args.softness_right.toString());
        body.append("marination", settings.mask_args.marination.toString());
    }

    const url = new URL("/radio", window.location.toString());
    return {url, body};
}

/**
* The remaining amount of time in the buffer
* @returns {number} The amount of time remaining in the buffer. Zero if there is nothing left in the buffer
*/
function remainingBufferTime() {
   if (audioCtx.currentTime > LATEST_QUEUED_TIME) {
       return 0.0;
   }
   return LATEST_QUEUED_TIME - audioCtx.currentTime;
}

/**
* Returns the time of the latest queued audio. If there is no latest queued audio, then this is the current time.
* This should be used to achieve gapless audio queuing. 
* @returns {number} The current time or the latest queued time, whichever is later
*/
function getLatestQueuedOrNow() {
   if (audioCtx.currentTime > LATEST_QUEUED_TIME) {
       return audioCtx.currentTime;
   } else {
       return LATEST_QUEUED_TIME;
   }
}

/**
 * Returns the exact number of seconds that a generation of the given length would actually produce.
 * Generated audio not the same as the requested audio length because the latent vectors decode to blocks of 
 * 2048 samples. Hence, the audio length is always a multiple of 2048 samples.
 * @param {number} duration
 * @returns {number} 
 */
function getPreciseDuration(duration) {
    const MODEL_SAMPLE_RATE = 44100;
    const LATENT_BLOCK_SIZE = 2048;
    const numBlocks = Math.floor(duration * MODEL_SAMPLE_RATE / LATENT_BLOCK_SIZE) 
    const numSamples = numBlocks * LATENT_BLOCK_SIZE;
    const exactDuration = numSamples / MODEL_SAMPLE_RATE;
    return exactDuration;
}

// ##################
// # PLAYLIST QUEUE #
// ##################
/**
 * @typedef {"generating" | "queued" | "playing" | "done" | "expired"} PlaylistItemState
 */
class PlaylistItem extends HTMLElement {
    constructor() {
        super();
        this.buffer = null;
        this.queueTime = null;
        this.blob = null;
    }
    /**
     * Initialize the PlaylistItem in the "generating" state.
     * Returns the list element that was inserted into the queue.
     * @param {PromptSettings} promptSettings 
     */
    init(promptSettings) {
        this.dataset.queueState = "generating";
        this.promptSettings = promptSettings;
        this.innerText = this.text;
        this.url = null;
    }
    /**
     * @param {number} queueTime the actual time the audio was set to be queued up
     * @param {AudioBuffer} buffer The AudioBuffer of generated audio associated with this PlaylistItem. 
     */
    async setQueued(buffer, queueTime) {
        this.buffer = buffer;
        this.queueTime = queueTime;
        this.queueState = "queued";
        this.innerText = this.text + " | ";

        this.blob = getWavBlob(buffer);
        this.url = window.URL.createObjectURL(this.blob);

        const downloadLink = document.createElement("a");
        downloadLink.innerText = "[Download]";
        downloadLink.onclick = (event) => event.stopPropagation();
        downloadLink.href = this.url;
        downloadLink.download = `${this.promptSettings?.positive_prompt?.replace(".", ",")} ${this.promptSettings?.seed}`;
        this.appendChild(downloadLink)
    }
    setPlaying() {
        this.queueState = "playing";
    }
    setDone() {
        this.queueState = "done";
    }
    setExpired() {
        this.queueState = "expired";
        this.ontransitionend = (event) => {
            // note: ontransitionend fires once for each property that gets transitioned,
            // (in this case, like 5 times due to padding getting transitioned)
            // so we need to filter for the one we actually want.
            // note that the padding properties are actually split into 4 (there is no "padding" property by itself)
            if (event.propertyName == "background-color" && this.queueState == "expired") {
                removePlaylistItem(this);
            }
        };
    }

    /**
     * @returns {BlobWithSource | null}
     */
    get blobWithSource() {
        if (this.blob == null) {
            return null;
        }
        return {
            audio: this.blob,
            source: `${this.promptSettings?.positive_prompt} ${this.promptSettings?.seed} (@ ${this.queueTime?.toFixed(2)})`
        };
    }

    /**
     * The state of the item.
     * - generating - item has been queued up and a request was sent but the response has not returned yet
     * - queued - item has been queued up and the item has it's blob for it's generated audio
     * - playing - item is currently playing audio
     * - done - item is no longer playing audio, but the blob for it's generated audio is still valid
     * - expired - item is done playing and has been removed from the recent generations queue. the blob for it's generated audio is no longer valid
     * @returns {PlaylistItemState}
     */
    get queueState() {
        const state = this.dataset.queueState;
        const valid = state == "generating" || state == "queued" || state == "playing" || state == "done" || state == "expired";
        if (!valid) {
            throw new Error(`invalid state: ${state}`);
        }
        return state;
    }

    set queueState(state) {
        this.dataset.queueState = state;
    }

    /**
     * The text to display on the item
     */
    get text() {
        if (this.promptSettings == undefined) {
            return "";
        }
        let promptText = this.promptSettings.positive_prompt;
        if (this.promptSettings.negative_prompt != null) {
            promptText = `${this.promptSettings.positive_prompt} (negative: ${this.promptSettings.negative_prompt})`
        }
        /** @type {[string, string][]} */
        let tags = [
            ["seed", this.promptSettings.seed.toString()],
            ["steps", this.promptSettings.steps.toString()]
        ];

        if (this.promptSettings.init_audio != null) {
            tags.push(["init", this.promptSettings.init_audio.source]);
        }
        const tagText = `[${tags.map(([name, val]) => `${name} = ${val}`).join(", ")}]`

        let text = `${promptText} ${tagText}`;
        if (this.queueTime != undefined) {
            const startTime = this.queueTime.toFixed(1);
            const endTime = (this.queueTime + this.promptSettings.length).toFixed(1);
            text += ` @ t = ${startTime} to ${endTime}`; 
        }
        return text;    
    }
}
  

/**
 * Place a new item in the visual playlist queue. The item will start in 
 * the "generating" state.
 * Returns the list element that was inserted into the queue.
 * @param {PromptSettings} settings 
 * @returns {PlaylistItem} The element that was inserted.
 */
function pushQueueItem(settings) {
    const item = assertType(document.createElement("playlist-item"), PlaylistItem);
    item.init(settings);
    queueList.appendChild(item);
    RECENT_GENERATIONS.push(item);
    if (RECENT_GENERATIONS.length > MAX_RECENT_GENERATIONS) {
        expireOldestItem()
    }

    return item;
}
function expireOldestItem() {
    const items = RECENT_GENERATIONS
        .filter(item => item.queueState == "done")
        .sort((a, b) => assertExists(a.queueTime) - assertExists(b.queueTime));
    if (items.length > 0) {
        items[0].setExpired();
    }
}

/**
 * Get the latest item in the 
 * @returns {BlobWithSource | null}
 */
function getLatestPlaylistItemBlob() {
    let doneGenerations = RECENT_GENERATIONS.findLast(item => item.blob != null);
    if (doneGenerations != undefined) {
        return doneGenerations.blobWithSource;
    } else {
        return null;
    }
}

/**
 * Remove an existing item in the visual playlist queue.
 * @param {PlaylistItem} playlistItem the item to remove 
 */
function removePlaylistItem(playlistItem) {
    // Revoke the blob URL so that it doesn't stay around forever.
    if (playlistItem.url != null) {
        window.URL.revokeObjectURL(playlistItem.url);
    }
    const index = RECENT_GENERATIONS.indexOf(playlistItem);
    RECENT_GENERATIONS.splice(index, 1)
    playlistItem.parentElement?.removeChild(playlistItem);
}

function updateQueue() {
    const items = queueList.querySelectorAll("playlist-item");

    for (const theItem of items) {
        const item = assertType(theItem, PlaylistItem);

        if (item.queueState == "queued" || item.queueState == "playing") {
            const queueTime = assertExists(item.queueTime);
            const length = assertExists(item.promptSettings).length;
    
            const currentTime = audioCtx.currentTime;
            if (currentTime > queueTime + length && item.queueState == "playing") {
                item.setDone();
            } else if (currentTime > queueTime && item.queueState == "queued") {
                item.setPlaying();
            }
        }
    }
}


// ################
// # WAV DOWNLOAD #
// ################

/**
 * @param {AudioBuffer} buffer 
 * @returns {Blob} the audio buffer encoded as a wav file
 */
function getWavBlob(buffer) {
    let header = getWavHeader(buffer);
    let body = getWavBody(buffer);
    let blob = new Blob([header, body], { 'type': 'audio/wav' });
    return blob;
}

/**
 * Generate a WAV header from the given AudioBuffer. The WAV header
 * is set up to accept float32 audio at the given sample rate and channel
 * count of the input buffer.
 * @param {AudioBuffer} buffer 
 * @returns {Int16Array} the wav header
 */
function getWavHeader(buffer) {
    // adapted from https://gist.github.com/asanoboy/3979747
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numSamples = buffer.length;
    const BITS_PER_SAMPLE = 32; // float32
    const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
    const HEADER_SIZE = 23;
    const TOTAL_BYTES = numSamples * numChannels * BYTES_PER_SAMPLE;
    const array = new Int16Array(HEADER_SIZE);
    array[0] = 0x4952; // "RI"
    array[1] = 0x4646; // "FF"

    array[2] = (TOTAL_BYTES + 15) & 0x0000ffff; // RIFF size
    array[3] = ((TOTAL_BYTES + 15) & 0xffff0000) >> 16; // RIFF size

    array[4] = 0x4157; // "WA"
    array[5] = 0x4556; // "VE"

    array[6] = 0x6d66; // "fm"
    array[7] = 0x2074; // "t "

    array[8] = 0x0012; // fmt chunksize: 18
    array[9] = 0x0000; //

    array[10] = 0x0003; // format tag : 3 (float32)
    array[11] = numChannels; // channels: 2

    array[12] = sampleRate & 0x0000ffff; // sample per sec
    array[13] = (sampleRate & 0xffff0000) >> 16; // sample per sec

    array[14] = (BYTES_PER_SAMPLE * numChannels * sampleRate) & 0x0000ffff; // byte per sec
    array[15] = ((BYTES_PER_SAMPLE * numChannels * sampleRate) & 0xffff0000) >> 16; // byte per sec

    array[16] = numChannels * BYTES_PER_SAMPLE; // block align
    array[17] = BITS_PER_SAMPLE; // bits per sample (32 bits for float)
    array[18] = 0x0000; // cb size
    array[19] = 0x6164; // "da"
    array[20] = 0x6174; // "ta"
    array[21] = (TOTAL_BYTES) & 0x0000ffff; // data size[byte]
    array[22] = ((TOTAL_BYTES) & 0xffff0000) >> 16; // data size[byte] 
    return array;
}

/**
 * Generate the WAV body from the AudioBuffer. The audio is encoded
 * as interleaved float32 data. 
 * @param {AudioBuffer} buffer
 * @returns {Float32Array} the WAV body
 */
function getWavBody(buffer) {
    // adapted from https://gist.github.com/asanoboy/3979747
    const numChannels = buffer.numberOfChannels;
    const numSamples = buffer.length;

    const array = new Float32Array(numSamples * numChannels);

    for (let channel_i = 0; channel_i < numChannels; channel_i++) {
        const channel = buffer.getChannelData(channel_i);
        for (let sample_i = 0; sample_i < channel.length; sample_i++) {
            const sample = channel[sample_i];
            array[channel_i + sample_i * numChannels] = sample; 
        }
    }

    return array
}


// ###########################
// # UI (NON-PLAYLIST QUEUE) #
// ###########################
function updateUI() {
    setRemainingBufferDisplay();
    setCurrentTimeDisplay();
    updateQueue();
}

function setEstimatedTimeDisplay() {
    const settings = getPromptSettings();
    if (settings != null) {
        estimated_time_display.innerText = estimatedGenerationTime(settings.steps, settings.length).toFixed(1)
    }
}

function setRemainingBufferDisplay() {
    remaining_buffer_display.innerText = remainingBufferTime().toFixed(1);
}

function setCurrentTimeDisplay() {
    current_time_display.innerText = audioCtx.currentTime.toFixed(1);
}

/**
 * @param {number} steps
 * @param {number} length
 * @param {number} elapsed 
 */
function recordGenerationStats(steps, length, elapsed) {
    const item = {
        stepSeconds: steps * length,
        elapsed
    };
    if (RECENT_STEPSECONDS.length < 5) {
        RECENT_STEPSECONDS.push(item)
    } else {
        RECENT_STEPSECONDS[RECENT_STEPSECONDS_INDEX] = item;
        RECENT_STEPSECONDS_INDEX = (RECENT_STEPSECONDS_INDEX + 1) % 5;
    }
}

/**
 * Set volume from the volume slider
 */
function setVolumeFromSlider() {
    const new_vol = parseFloat(volume_slider.value) * parseFloat(volume_slider.value);
    gainNode.gain.value = new_vol;
    volume_slider_display.innerText = `${(new_vol * 100.0).toFixed(0)}%`;
}


// #####################
// # UTILITY FUNCTIONS #
// #####################
/**
 * Constructor type, such as "HTMLElement" 
 * @template T
 * @typedef {new (...args: any[]) => T} Constructor
 */

/**
 * @template T
 * @param {string} id 
 * @param {Constructor<T>} type 
 * @returns {T}
 */
function getElementTyped(id, type) {
    const element = document.getElementById(id);
    if (element == null) {
        throw new Error(`Could not find HTMLElement with id ${id}`);
    }
    return assertType(element, type);
}

/**
 * Asserts that a variable is not null and not undefined. If it is null or undefined, an error is thrown.
 * @template T
 * @param {T | null | undefined} x 
 * @returns {T}
 */
function assertExists(x) {
    if (x === null) {
        throw new Error("Expected input to be non-null.");
    }
    if (x === undefined) {
        throw new Error("Expected input to be not undefined.");
    }
    return x;
}

/**
 * @template T
 * @param {any} element 
 * @param {Constructor<T>} type 
 * @returns {T}
 */
function assertType(element, type) {
    if (!(element instanceof type)) {
        throw new Error(`Expected input to be of type ${type}. Got ${element.constructor.name}.`)
    }
    return element;
}

/**
 * The destination audio node. This is so that I can attach additional things like GainNodes as an effect chain
 * and have everyone point to the same destination.
 * @returns {AudioNode} The destination audio node.
 */
function getDestinationNode() {
    return gainNode;
}


// ########
// # MAIN #
// ########
let IS_PLAYING = false;
let INFLIGHT_GENERATIONS = 0;

// The time, in seconds, of the latest queued up buffer.
let LATEST_QUEUED_TIME = 0.0

/** @type {{ elapsed: number, stepSeconds: number }[]} */
let RECENT_STEPSECONDS = [];
let RECENT_STEPSECONDS_INDEX = 0;

/** @type {PlaylistItem[]} */
let RECENT_GENERATIONS = [];
const MAX_RECENT_GENERATIONS = 5;


/** @typedef {{ audio: Blob, source: string }} BlobWithSource */
/** @type {BlobWithSource | null} */
let UPLOADED_AUDIO = null;

customElements.define("playlist-item", PlaylistItem);

const audioCtx = new window.AudioContext();
const gainNode = audioCtx.createGain();
gainNode.connect(audioCtx.destination);

// Set up HTML elements
const positive_prompt_textarea = getElementTyped("positive_prompt", HTMLTextAreaElement);
const negative_prompt_textarea = getElementTyped("negative_prompt", HTMLTextAreaElement);
const negative_prompt_enable_checkbox = getElementTyped("negative_prompt_enable", HTMLInputElement);

const cfg_input = getElementTyped("cfg", HTMLInputElement);
const sigma_min_input = getElementTyped("sigma_min", HTMLInputElement);
const sigma_max_input = getElementTyped("sigma_max", HTMLInputElement);

const seed_input = getElementTyped("seed", HTMLInputElement);
const increment_seed_checkbox = getElementTyped("seed_increment", HTMLInputElement);

const steps_input = getElementTyped("steps", HTMLInputElement);
const length_input = getElementTyped("length", HTMLInputElement);

const volume_slider = getElementTyped("volume", HTMLInputElement);
const volume_slider_display = getElementTyped("volume_slider_display", HTMLSpanElement);

const play_button = getElementTyped("play", HTMLButtonElement);

const estimated_time_display = getElementTyped("estimated_time_display", HTMLSpanElement)
const remaining_buffer_display = getElementTyped("remaining_buffer_display", HTMLSpanElement)
const current_time_display = getElementTyped("current_time_display", HTMLSpanElement)

const init_audio_upload_input = getElementTyped("init_audio_upload", HTMLInputElement);
const init_audio_dropdown = getElementTyped("init_audio_dropdown", HTMLSelectElement);
const init_noise_level_input = getElementTyped("init_noise_level", HTMLInputElement);

const mask_args_checkbox = getElementTyped("mask_args_checkbox", HTMLInputElement);
const paste_from_input = getElementTyped("paste_from", HTMLInputElement);
const paste_to_input = getElementTyped("paste_to", HTMLInputElement);
const crop_from_input = getElementTyped("crop_from", HTMLInputElement);
const mask_start_input = getElementTyped("mask_start", HTMLInputElement);
const mask_end_input = getElementTyped("mask_end", HTMLInputElement);
const softness_left_input = getElementTyped("softness_left", HTMLInputElement);
const softness_right_input = getElementTyped("softness_right", HTMLInputElement);
const marination_input = getElementTyped("marination", HTMLInputElement);

const queueList = getElementTyped("playlist", HTMLElement);

// Event Handlers
play_button.onclick = async (_) => {
    IS_PLAYING = !IS_PLAYING;
    if (IS_PLAYING) {
        play_button.innerText = "Stop";
    } else {
        play_button.innerText = "Play";
    }
};

init_audio_upload_input.onchange = (_) => {
    const files = assertExists(init_audio_upload_input.files);
    if (files.length > 0) {
        UPLOADED_AUDIO = {
            audio: files[0],
            source: files[0].name
        };
    }
}

volume_slider.oninput = (_) => setVolumeFromSlider();

steps_input.onchange = (_) => setEstimatedTimeDisplay();

length_input.onchange = (_) => setEstimatedTimeDisplay();

setInterval(queueIfNeeded, 1000);
setInterval(updateUI, 100);

updateUI();
setVolumeFromSlider();