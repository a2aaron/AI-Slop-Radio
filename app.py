from os import PathLike
import flask
from flask import request

import io
from typing import Any, BinaryIO, Literal, Union

import json
import torch
import torchaudio

import einops
import stable_audio_tools as sd_tools
import stable_audio_tools.models.utils as sd_tools_util
import stable_audio_tools.inference.generation as sd_tools_generate

# TYPES
ModelConfig = Any
DeviceStr = Literal["cuda", "cpu"]
ConditioningDict = dict
Model = Any
AudioTensor = torch.Tensor

# CONSTANTS
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_CONFIG_PATH = "C:/Users/a2aar/dev/Python/realtime-neuralnets/stable_audio_open_1.0_config.json"
MODEL_CKPT_PATH = "C:/Users/a2aar/dev/ComfyUI/ComfyUI_windows_portable/ComfyUI/models/checkpoints/stable_audio_open_1.0.safetensors"
LENGTH = 10.0
STEPS = 20
CHANNELS = 2
BYTES_PER_CHANNEL = 4 # float32 format used for output stream
VOLUME = 0.2
INIT_SEED = 0
SAMPLE_RATE = 44100
SAMPLE_SIZE = round(LENGTH * SAMPLE_RATE) # MODEL_CONFIG["sample_size"]

# FLASK ROUTES
app = flask.Flask(__name__)

@app.route("/")
def main():
    return flask.render_template("main.html")

@app.route("/radio")
def radio():
    global INIT_SEED
    prompt = request.args.get('prompt', '') or "piano"
    generated_audio = run_model(seed=INIT_SEED, prompt=prompt)
    
    buffer = io.BytesIO()
    write_to_file(buffer, generated_audio)
    out_bytes = buffer.getvalue()
    
    INIT_SEED += 1
    return out_bytes, {"Content-Type": "audio/wav"}    

# GENERATION
def load_model_config(model_config_path: str) -> ModelConfig:
    with open(model_config_path) as f:
        return json.load(f)

def load_model(model_config: ModelConfig, model_ckpt_path: str, device: DeviceStr) -> Model:
    model = sd_tools.create_model_from_config(model_config)
    model.load_state_dict(sd_tools_util.load_ckpt_state_dict(model_ckpt_path))
    model = model.to(device)
    return model

# Returns a tensor of shape [2, SAMPLE_SIZE]
def run_model(prompt: str, seed: int) -> AudioTensor:
    # Set up text and timing conditioning
    CONDITIONING = [{
        "prompt": prompt,
        "seconds_start": 0, 
        "seconds_total": LENGTH
    }]

    # Generate stereo audio
    output = sd_tools_generate.generate_diffusion_cond(
        MODEL,
        steps=STEPS,
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
    output = output.to(torch.float32).div(max_value).clamp(-1, 1) * VOLUME
    return output

# WAV WRITING
def write_to_file(output_file: Union[BinaryIO, str, PathLike], audio: AudioTensor):
    # convert to int16, and save to file
    audio = audio.mul(32767).to(torch.int16).cpu()
    torchaudio.save(output_file, audio, SAMPLE_RATE, format="wav")

# Load model
print("Loading config")
MODEL_CONFIG = load_model_config(MODEL_CONFIG_PATH)

print("Loading model")
MODEL = load_model(MODEL_CONFIG, MODEL_CKPT_PATH, DEVICE)
print("Model loaded")

