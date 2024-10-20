let IS_PLAYING = false;
let ALREADY_FETCHING = false;

/** @type {{ elapsed: number, stepSeconds: number }[]} */
let RECENT_STEPSECONDS = [];
let RECENT_STEPSECONDS_INDEX = 0;
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
 * Queues up audio as needed. This should be called intermittently
 */
async function queueIfNeeded() {
    if (!IS_PLAYING) {
        return;
    }


    const settings = getPromptSettings();
    if (settings != null) {
        const minimumBuffer = estimatedGenerationTime(settings.steps, settings.length) * 1.25 + 2.0;
        const enoughBuffer = remainingBufferTime() > minimumBuffer;
        if (!enoughBuffer && !ALREADY_FETCHING) {
            ALREADY_FETCHING = true;
            const promptUrl = getRadioUrl(settings);
            const { node, elapsed } = await getAudioBufferSourceNode(promptUrl);
            console.log(`Took ${elapsed} seconds to generate audio`);
            queueAudio(node);
            recordGenerationStats(settings, elapsed);
            setEstimatedTimeDisplay()
    
            seed_input.value = (parseInt(seed_input.value) + 1).toString();
            ALREADY_FETCHING = false;
        }
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
 * @typedef {{ 
 *     positive_prompt: string | null;
 *     negative_prompt: string | null;
 *     cfg: number;
 *     sigma_min: number;
 *     sigma_max: number;
 *     seed: number;
 *     steps: number;
 *     length: number;
 *     debug_save: boolean; 
 * }} PromptSettings 
 * @returns {PromptSettings | null}
 */
function getPromptSettings() {
    let negative_prompt = null;
    if (negative_prompt_enable_checkbox.checked || negative_prompt_textarea.value != "") {
        negative_prompt = negative_prompt_textarea.value;
    }

    if (!cfg_input.checkValidity() || 
        !sigma_min_input.checkValidity() ||
        !sigma_max_input.checkValidity() ||
        !seed_input.checkValidity() ||
        !steps_input.checkValidity() ||
        !length_input.checkValidity()) {
        return null;
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
        "debug_save": save_to_disk_checkbox.checked,
    }
}

/**
 * Build the radio URL along with it's parameters using the controls on the page.
 * @param {PromptSettings} settings 
 * @returns {URL} The prompt URL
 */
function getRadioUrl(settings) {
    const radio_url = new URL("/radio", window.location.toString());
    if (settings.positive_prompt != null) {
        radio_url.searchParams.set("positive_prompt", settings.positive_prompt);
    }
    if (settings.negative_prompt != null) {
        radio_url.searchParams.set("negative_prompt", settings.negative_prompt);
    }
    radio_url.searchParams.set("cfg_scale", settings.cfg.toString());
    radio_url.searchParams.set("sigma_min", settings.sigma_min.toString());
    radio_url.searchParams.set("sigma_max", settings.sigma_max.toString());

    radio_url.searchParams.set("seed", settings.seed.toString());
    radio_url.searchParams.set("steps", settings.steps.toString());
    radio_url.searchParams.set("length", settings.length.toString());

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
    audioBufferSourceNode.start(queueTime);
    LATEST_QUEUED_TIME = queueTime + duration;
}

/**
 * Create an AudioBufferSourceNode from the given URL.
 * @param {URL} url The radio URL endpoint. This is what is fetched from to download the audio. 
 * @returns {Promise<{node: AudioBufferSourceNode, elapsed: number}>} An AudioBufferSourceNode containing the generated audio
 */
async function getAudioBufferSourceNode(url) {
    const now = Date.now();
    const arrayBuffer = await fetch(url).then((res) => res.arrayBuffer());
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const node = audioCtx.createBufferSource();
    node.buffer = audioBuffer

    node.connect(getDestinationNode());
    const elapsed = Date.now() - now;
    return {
        node,
        elapsed: elapsed / 1000.0,
    };
}

const audioCtx = new window.AudioContext();
const gainNode = audioCtx.createGain();
gainNode.connect(audioCtx.destination);


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
    const settings = getPromptSettings();
    if (settings != null) {
        estimated_time_display.innerText = estimatedGenerationTime(settings.steps, settings.length).toFixed(1)
    }
}

setInterval(setRemainingBuffer, 100);
function setRemainingBuffer() {
    remaining_buffer_display.innerText = remainingBufferTime().toFixed(1);
}

/**
 * @param {PromptSettings} settings 
 * @param {number} elapsed 
 */
function recordGenerationStats(settings, elapsed) {
    const item = {
        stepSeconds: settings.steps * settings.length,
        elapsed
    };
    if (RECENT_STEPSECONDS.length < 10) {
        RECENT_STEPSECONDS.push(item)
    } else {
        RECENT_STEPSECONDS[RECENT_STEPSECONDS_INDEX] = item;
        RECENT_STEPSECONDS_INDEX = (RECENT_STEPSECONDS_INDEX + 1) % 10;
    }
}
