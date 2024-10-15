import io
from typing import Any, Generator, Iterator, Literal

import json
import torch
import torchaudio
import pyaudio
import time
import timeit

import einops
import stable_audio_tools as sd_tools
import stable_audio_tools.models.utils as sd_tools_util
import stable_audio_tools.inference.generation as sd_tools_generate

ModelConfig = Any
DeviceStr = Literal["cuda", "cpu"]
ConditioningDict = dict
Model = Any
AudioTensor = torch.Tensor

def load_model_config(model_config_path: str) -> ModelConfig:
    with open(model_config_path) as f:
        return json.load(f)

def load_model(model_config: ModelConfig, model_ckpt_path: str, device: DeviceStr) -> Model:
    model = sd_tools.create_model_from_config(model_config)
    model.load_state_dict(sd_tools_util.load_ckpt_state_dict(model_ckpt_path))
    model = model.to(device)
    return model

def compute_num_samples(sample_rate: int, length: float) -> int:
    return round(length * sample_rate)

# Returns a tensor of shape [2, SAMPLE_SIZE]
def generate(seed: int) -> AudioTensor:
    # Generate stereo audio
    output = sd_tools_generate.generate_diffusion_cond(
        MODEL,
        steps=20,
        cfg_scale=6,
        conditioning=CONDITIONING,
        sample_size=SAMPLE_SIZE,
        sigma_min=0.3,
        sigma_max=500,
        sampler_type="dpmpp-3m-sde",
        device=DEVICE,
        seed=seed,
    )

    # Rearrange audio batch to a single sequence
    output = einops.rearrange(output, "b d n -> d (b n)")

    # Peak normalize, clip, 
    max_value = torch.max(torch.abs(output))
    output = output.to(torch.float32).div(max_value).clamp(-1, 1)
    return output

def write_to_file(output_file: str, audio: AudioTensor):
    # convert to int16, and save to file
    audio = audio.mul(32767).to(torch.int16).cpu()
    torchaudio.save(output_file, audio, SAMPLE_RATE)

def get_bytes_to_write(frame_count, channels, bytes_per_channel):
    return frame_count * channels * bytes_per_channel

def audio_tensor_to_bytes(audio: AudioTensor) -> bytes:
    audio = audio.transpose(0, 1) # Rearrange from [2, N] to [N, 2]. (effectively, [[L L L], [R R R]] to [[L R], [L R], [L R]])
    audio = audio.flatten() # Flatten from [N, 2] to [2N] ([[L R], [L R], [L R]] to [L R L R L R])
        
    buffer = io.BytesIO()
    torch.save(audio, buffer)
    return buffer.getvalue()

# Define callback for playback (1)
def pyaudio_callback(in_data, frame_count, time_info, status):
    bytes_to_write = get_bytes_to_write(frame_count, CHANNELS, BYTES_PER_CHANNEL)
    
    data = OUTPUT_ITER.next_bytes(bytes_to_write)
    if len(data) != bytes_to_write:
        print("not enough data written for callback. stream will exit: ", len(data), bytes_to_write)
    return (data, pyaudio.paContinue)

def next_generator(seed: int) -> Iterator[int]:
    while True:
        yield generate(seed)
        seed += 1

class AudioIter:
    def __init__(self) -> None:
        self.cursor = 0
        self.audio = bytearray()

    def enqueue(self, audio: AudioTensor):
        audio_bytes = audio_tensor_to_bytes(audio)
        self.audio.extend(audio_bytes)

    def next_bytes(self, n: int) -> bytes:
        start = self.cursor
        end = (self.cursor + n)
        self.cursor += n
        return bytes(self.audio[start : end])

    def remaining_bytes(self) -> int:
        return len(self.audio) - self.cursor

    def remaining_samples(self) -> int:
        return self.remaining_bytes() / (CHANNELS * BYTES_PER_CHANNEL)

    def remaining_time(self) -> float:
        return float(self.remaining_samples()) / float(SAMPLE_RATE)

if __name__ == "__main__":
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    MODEL_CONFIG_PATH = "C:/Users/a2aar/dev/Python/realtime-neuralnets/stable_audio_open_1.0_config.json"
    MODEL_CKPT_PATH = "C:/Users/a2aar/dev/ComfyUI/ComfyUI_windows_portable/ComfyUI/models/checkpoints/stable_audio_open_1.0.safetensors"
    LENGTH = 10.0

    CHANNELS = 2
    BYTES_PER_CHANNEL = 4 # float32 format used for output stream

    # Load model
    print("Loading config")
    MODEL_CONFIG = load_model_config(MODEL_CONFIG_PATH)
    print("Loading model")
    MODEL = load_model(MODEL_CONFIG, MODEL_CKPT_PATH, DEVICE)

    SAMPLE_RATE = MODEL_CONFIG["sample_rate"]
    SAMPLE_SIZE = compute_num_samples(SAMPLE_RATE, LENGTH) # MODEL_CONFIG["sample_size"]

    # Set up text and timing conditioning
    CONDITIONING = [{
        "prompt": "piano",
        "seconds_start": 0, 
        "seconds_total": LENGTH
    }]
    
    INIT_SEED = 0

    generator = next_generator(INIT_SEED)

    print("Generating initial buffer...")
    OUTPUT_ITER = AudioIter()
    OUTPUT_ITER.enqueue(next(generator))
    OUTPUT_ITER.enqueue(next(generator))
    OUTPUT_ITER.enqueue(next(generator))
    # Instantiate PyAudio and initialize PortAudio system resources (2)
    p = pyaudio.PyAudio()

    # Open stream using callback (3)
    stream = p.open(format=pyaudio.paFloat32,
                    channels=CHANNELS,
                    rate=SAMPLE_RATE,
                    output=True,
                    stream_callback=pyaudio_callback)
    


    # Wait for stream to finish (4)
    while stream.is_active():
        time.sleep(0.1)
        if OUTPUT_ITER.remaining_time() < 30.0:
            start = time.time()
            OUTPUT_ITER.enqueue(next(generator))
            total_time = time.time() - start
            print(f"enqueued new generation (in {total_time} seconds)")
        # print(OUTPUT_ITER.remaining_time(), OUTPUT_ITER.remaining_samples(), OUTPUT_ITER.remaining_bytes())

    # Close the stream (5)
    stream.close()

    # Release PortAudio system resources (6)
    p.terminate()

    write_to_file("output.wav", OUTPUT)

