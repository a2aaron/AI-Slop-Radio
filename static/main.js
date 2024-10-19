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
 * @returns {number} The estimated amount of time, in seconds, that it takes to generate the next batch of audio.
 */
function estimatedGenerationTime() {
    const steps = parseInt(steps_input.value);
    const length = parseFloat(length_input.value);
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

/**
 * Queues up audio as needed. This should be called intermittently
 */
async function queueIfNeeded() {
    if (!IS_PLAYING) {
        return;
    }


    const enoughBuffer = remainingBufferTime() > estimatedGenerationTime() * 1.1 ;
    if (!enoughBuffer && !ALREADY_FETCHING) {
        console.log("Requesting at remaining buffer: ", remainingBufferTime());
        ALREADY_FETCHING = true;
        const promptUrl = getPromptUrl();
        const sourceNode = await getAudioBufferSourceNode(promptUrl);
        queueAudio(sourceNode);
        seed_input.value = (parseInt(seed_input.value) + 1).toString();
        ALREADY_FETCHING = false;
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

/**
 * Build the radio URL along with it's parameters using the controls on the page.
 * @returns {URL} The prompt URL
 */
function getPromptUrl() {
    const radio_url = new URL("/radio", window.location.toString());
    
    radio_url.searchParams.set("positive_prompt", positive_prompt_textarea.value);
    const negative_prompt = negative_prompt_textarea.value;
    if (negative_prompt_enable_checkbox.checked || negative_prompt != "") {
        radio_url.searchParams.set("negative_prompt", negative_prompt);
    }
    radio_url.searchParams.set("cfg", cfg_input.value);
    radio_url.searchParams.set("sigma_min", sigma_min_input.value);
    radio_url.searchParams.set("sigma_max", sigma_max_input.value);

    radio_url.searchParams.set("seed", seed_input.value);
    radio_url.searchParams.set("steps", steps_input.value);
    radio_url.searchParams.set("length", length_input.value);

    if (save_to_disk_checkbox.checked) {
        radio_url.searchParams.set("debug_save", "true");
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

let IS_PLAYING = false;
let ALREADY_FETCHING = false;


const positive_prompt_textarea = getElementTyped("positive_prompt", HTMLTextAreaElement);
const negative_prompt_textarea = getElementTyped("negative_prompt", HTMLTextAreaElement);
const negative_prompt_enable_checkbox = getElementTyped("negative_prompt_enable", HTMLInputElement);

const cfg_input = getElementTyped("cfg", HTMLInputElement);
const sigma_min_input = getElementTyped("sigma_min", HTMLInputElement);
const sigma_max_input = getElementTyped("sigma_max", HTMLInputElement);

const seed_input = getElementTyped("seed", HTMLInputElement);
const steps_input = getElementTyped("steps", HTMLInputElement);
const length_input = getElementTyped("length", HTMLInputElement);

const volume_slider = getElementTyped("volume", HTMLInputElement);
const volume_slider_display = getElementTyped("volume_slider_display", HTMLSpanElement);

const save_to_disk_checkbox = getElementTyped("debug_save", HTMLInputElement);
const play_button = getElementTyped("play", HTMLButtonElement);

const estimated_time_display = getElementTyped("estimated_time_display", HTMLSpanElement)
const remaining_buffer_display = getElementTyped("remaining_buffer_display", HTMLSpanElement)

play_button.onclick = async (event) => {
    IS_PLAYING = !IS_PLAYING;
    if (IS_PLAYING) {
        play_button.innerText = "Stop";
    } else {
        play_button.innerText = "Play";
    }
};

volume_slider.oninput = (event) => {
    setVolumeFromSlider();
}

steps_input.onchange = (event) => {
    setEstimatedTimeDisplay();
}

length_input.onchange = (event) => {
    setEstimatedTimeDisplay();
}

setVolumeFromSlider();
setEstimatedTimeDisplay();
setRemainingBuffer();

setInterval(queueIfNeeded, 1000);

function setEstimatedTimeDisplay() {
    estimated_time_display.innerText = estimatedGenerationTime().toFixed(1)
}

setInterval(setRemainingBuffer, 100);
function setRemainingBuffer() {
    remaining_buffer_display.innerText = remainingBufferTime().toFixed(1);
}