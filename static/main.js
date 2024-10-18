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
    if (!(element instanceof type)) {
        throw new Error(`Expected HTMLElement with id ${id} to be of type ${type}. Got ${element.constructor.name}.`)
    }
    return element;
}

/**
 * Asserts that a variable is not null. If it is null, an error is thrown.
 * @template T
 * @param {T | null} x 
 * @returns {T}
 */
function assertNotNull(x) {
    if (x == null) {
        throw new Error("Expected input to be non-null.")
    }
    return x;
}

/**
 * The destination audio node. This is so that I can attach additional things like GainNodes as an effect chain
 * and have everyone point to the same destination.
 * @returns {AudioNode} The destination audio node.
 */
function getDestinationNode() {
    return gainNode;
}

/**
 * Queues up audio as needed. This should be called intermittently
 */
async function queueIfNeeded() {
    if (!IS_PLAYING) {
        return;
    }
    const enoughBuffer = remainingBufferTime() > MAX_BUFFER;

    if (!enoughBuffer && !ALREADY_FETCHING) {
        ALREADY_FETCHING = true;
        const promptUrl = getPromptUrl();
        const sourceNode = await getAudioBufferSourceNode(promptUrl);
        queueAudio(sourceNode);
        seed_input.value = (parseInt(seed_input.value) + 1).toString();
        ALREADY_FETCHING = false;
    }
}

/**
 * Build the radio URL along with it's parameters using the controls on the page.
 * @returns {URL} The prompt URL
 */
function getPromptUrl() {
    const radio_url = new URL("/radio", window.location.toString());
    radio_url.searchParams.set("length", "10.0");
    
    const seed = seed_input.value;
    radio_url.searchParams.set("seed", seed);
    
    const positive_prompt = positive_prompt_textarea.value;
    radio_url.searchParams.set("positive_prompt", positive_prompt);

    const negative_prompt = negative_prompt_textarea.value;
    const negative_prompt_enable = negative_prompt_enable_checkbox.checked;
    if (negative_prompt_enable) {
        radio_url.searchParams.set("negative_prompt", negative_prompt);
    }
    return radio_url;
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

// The time, in seconds, of the latest queued up buffer.
let LATEST_QUEUED_TIME = 0.0
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
 * Queue up the given source node to play. If the queue is empty, it plays immediately.
 * @param {AudioBufferSourceNode} audioBufferSourceNode The node to queue up
 */
function queueAudio(audioBufferSourceNode) {
    const buffer = assertNotNull(audioBufferSourceNode.buffer);
    const duration = buffer.duration;
    const queueTime = getLatestQueuedOrNow();
    console.log(`Queuing audio at ${queueTime}. Remaining buffer time: ${remainingBufferTime()}`);
    audioBufferSourceNode.start(queueTime);
    LATEST_QUEUED_TIME = queueTime + duration;
}

/**
 * Create an AudioBufferSourceNode from the given URL.
 * @param {URL} url The radio URL endpoint. This is what is fetched from to download the audio. 
 * @returns {Promise<AudioBufferSourceNode>} An AudioBufferSourceNode containing the generated audio
 */
async function getAudioBufferSourceNode(url) {
    const arrayBuffer = await fetch(url).then((res) => res.arrayBuffer());
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer

    source.connect(getDestinationNode());
    return source;
}

const audioCtx = new window.AudioContext();
const gainNode = audioCtx.createGain();
gainNode.connect(audioCtx.destination);

const MAX_BUFFER = 10.0;
let IS_PLAYING = false;
let ALREADY_FETCHING = false;

const play_button = getElementTyped("play", HTMLButtonElement);
const positive_prompt_textarea = getElementTyped("positive_prompt", HTMLTextAreaElement);
const negative_prompt_textarea = getElementTyped("negative_prompt", HTMLTextAreaElement);
const negative_prompt_enable_checkbox = getElementTyped("negative_prompt_enable", HTMLInputElement);
const seed_input = getElementTyped("seed", HTMLInputElement);
const volume_slider = getElementTyped("volume", HTMLInputElement);
const volume_slider_display = getElementTyped("volume_slider_display", HTMLSpanElement);


play_button.onclick = async (event) => {
    IS_PLAYING = !IS_PLAYING;
    if (IS_PLAYING) {
        play_button.innerText = "Stop";
    } else {
        play_button.innerText = "Play";
    }
};

volume_slider.oninput = (event) => {
    const new_vol = parseFloat(volume_slider.value) * parseFloat(volume_slider.value);
    gainNode.gain.value = new_vol;
    volume_slider_display.innerText = `${(new_vol * 100.0).toFixed(0)}%`;
}

setInterval(queueIfNeeded, 1000);