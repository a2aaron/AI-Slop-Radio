function getDestinationNode() {
    return gainNode;
}

async function queueIfNeeded() {
    if (!IS_PLAYING) {
        return;
    }
    const enoughBuffer = remainingBufferTime() > MAX_BUFFER;

    if (!enoughBuffer && !ALREADY_FETCHING) {
        ALREADY_FETCHING = true;
        await queueFromPrompt();
        ALREADY_FETCHING = false;
    }
}

async function queueFromPrompt() {
    const radio_url = new URL("/radio", window.location);
    radio_url.searchParams.set("length", 10.0);
    radio_url.searchParams.set("seed", 0);
    
    const positive_prompt = positive_prompt_textarea.value;
    radio_url.searchParams.set("positive_prompt", positive_prompt);

    const negative_prompt = negative_prompt_textarea.value;
    const negative_prompt_enable = negative_prompt_enable_checkbox.checked;
    if (negative_prompt_enable) {
        radio_url.searchParams.set("negative_prompt", negative_prompt);
    }
    sourceNode = await getAudioBufferSourceNode(radio_url);
    queueAudio(sourceNode);
}

// The remaining amount of time in the buffer
function remainingBufferTime() {
    if (audioCtx.currentTime > LATEST_QUEUED_TIME) {
        return 0.0;
    }
    return LATEST_QUEUED_TIME - audioCtx.currentTime;
}

// The time, in seconds, of the latest queued up buffer.
let LATEST_QUEUED_TIME = 0.0
// Gets the latest queued time or the current time, which ever is later.
// This should be used to achieve gapless queuing of audio.
function getLatestQueuedOrNow() {
    if (audioCtx.currentTime > LATEST_QUEUED_TIME) {
        return audioCtx.currentTime;
    } else {
        return LATEST_QUEUED_TIME;
    }
}

// Queue up the given source node to play. If the queue is empty, it plays immediately.
function queueAudio(audioBufferSourceNode) {
    const duration = audioBufferSourceNode.buffer.duration;
    const queueTime = getLatestQueuedOrNow();
    console.log(`Queuing audio at ${queueTime}. Remaining buffer time: ${remainingBufferTime()}`);
    audioBufferSourceNode.start(queueTime);
    LATEST_QUEUED_TIME = queueTime + duration;
}

// Create an AudioBufferSourceNode from the given URL.
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

const play_button = document.getElementById("play");
const positive_prompt_textarea = document.getElementById("positive_prompt");
const negative_prompt_textarea = document.getElementById("negative_prompt");
const negative_prompt_enable_checkbox = document.getElementById("negative_prompt_enable");
const volume_slider = document.getElementById("volume");
const volume_slider_display = document.getElementById("volume_slider_display");

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