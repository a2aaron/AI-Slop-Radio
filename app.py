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
    positive_prompt = request.args.get('positive_prompt', 'piano')
    negative_prompt = request.args.get('negative_prompt', None)
    length = request.args.get('length', 10.0, type=float)
    steps = request.args.get('steps', 20, type=int)
    seed = request.args.get('seed', 0, type=int)
    sigma_min = request.args.get('sigma_min', 0.3, type=float)
    sigma_max = request.args.get('sigma_max', 500, type=float)
    cfg_scale = request.args.get('cfg_scale', 6.0, type=float)
    sampler_type = request.args.get('sampler_type', "dpmpp-3m-sde")
    generated_audio = run_model(
        positive_prompt=positive_prompt,
        negative_prompt=negative_prompt,
        length=length,
        steps=steps,
        seed=seed,
        sigma_min=sigma_min,
        sigma_max=sigma_max,
        cfg_scale=cfg_scale,
        sampler_type=sampler_type
    )
    
    volume = request.args.get('volume', VOLUME, type=float)
    generated_audio = generated_audio * volume

    buffer = io.BytesIO()
    write_to_file(buffer, generated_audio)
    out_bytes = buffer.getvalue()
    
    if "debug_save" in request.args:
        write_to_file(f"out_{positive_prompt}_{seed}.wav", generated_audio)

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
def run_model(positive_prompt: str,
              negative_prompt: str | None, 
              length: float,
              steps: int,
              seed: int,
              cfg_scale: float,
              sigma_min: 0.3,
              sigma_max: 500,
              sampler_type: str) -> AudioTensor:
    
    sample_size = round(length * SAMPLE_RATE)
    # Set up text and timing conditioning
    positive_conditioning = [{
        "prompt": positive_prompt,
        "seconds_start": 0, 
        "seconds_total": LENGTH
    }]
    negative_conditioning = [{
        "prompt": negative_prompt,
        "seconds_start": 0, 
        "seconds_total": LENGTH
    }] if negative_prompt is not None else None

    # Generate stereo audio
    output = sd_tools_generate.generate_diffusion_cond(
        MODEL,
        steps=steps,
        cfg_scale=cfg_scale,
        conditioning=positive_conditioning,
        negative_conditioning=negative_conditioning,
        sample_size=sample_size,
        sigma_min=sigma_min,
        sigma_max=sigma_max,
        sampler_type=sampler_type,
        device=DEVICE,
        seed=seed,
        batch_size=1
    )

    # Rearrange audio batch to a single sequence
    output = einops.rearrange(output, "b d n -> d (b n)")

    # Peak normalize, clip, 
    max_value = torch.max(torch.abs(output))
    output = output.to(torch.float32).div(max_value).clamp(-1, 1)
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

