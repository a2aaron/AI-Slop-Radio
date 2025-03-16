from os import PathLike
import flask
from flask import Request, request

import io
from typing import Any, BinaryIO, Literal, TypeVar, TypedDict, Union

import json
import torch
import torchaudio

import stable_audio_tools as sd_tools
import stable_audio_tools.models.utils as sd_tools_util

import generate
from generate import AudioTensor, DeviceStr, MaskArgs, Model, ModelConfig

# CONSTANTS
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_CONFIG_PATH = "C:/Users/a2aar/dev/Python/realtime-neuralnets/stable_audio_open_1.0_config.json"
MODEL_CKPT_PATH = "C:/Users/a2aar/dev/ComfyUI/ComfyUI_windows_portable/ComfyUI/models/checkpoints/stable_audio_open_1.0.safetensors"
LENGTH = 10.0
STEPS = 20
CHANNELS = 2
BYTES_PER_CHANNEL = 4 # float32 format used for output stream
VOLUME = 1.0
INIT_SEED = 0
SAMPLE_RATE = 44100
SAMPLE_SIZE = round(LENGTH * SAMPLE_RATE) # MODEL_CONFIG["sample_size"]
SIGMA_MIN = 0.3
SIGMA_MAX = 500
CFG_SCALE = 6.0
INIT_NOISE_LEVEL = 1.0
SAMPLER_TYPE = "dpmpp-3m-sde"
# FLASK ROUTES
app = flask.Flask(__name__)

@app.route("/")
def main():
    return flask.render_template("main.html")

@app.route("/radio", methods=["POST"])
def radio():
    positive_prompt = request.form.get('positive_prompt', 'piano')
    negative_prompt = request.form.get('negative_prompt', None)
    length = request.form.get('length', LENGTH, type=float)
    steps = request.form.get('steps', STEPS, type=int)
    seed = request.form.get('seed', INIT_SEED, type=int)
    sigma_min = request.form.get('sigma_min', SIGMA_MIN, type=float)
    sigma_max = request.form.get('sigma_max', SIGMA_MAX, type=float)
    cfg_scale = request.form.get('cfg_scale', CFG_SCALE, type=float)
    sampler_type = request.form.get('sampler_type', SAMPLER_TYPE)

    mask_args = get_mask_args(request)
    print(mask_args)
    
    init_audio = try_get_init_audio(request)

    generated_audio = generate.run_model(
        model=MODEL,
        device=DEVICE,
        positive_prompt=positive_prompt,
        negative_prompt=negative_prompt,
        length=length,
        sample_rate=SAMPLE_RATE,
        steps=steps,
        seed=seed,
        sigma_min=sigma_min,
        sigma_max=sigma_max,
        cfg_scale=cfg_scale,
        sampler_type=sampler_type,
        mask_args=mask_args,
        init_audio_args=init_audio,
    )
    
    volume = request.form.get('volume', VOLUME, type=float)
    generated_audio = generated_audio * volume

    buffer = io.BytesIO()
    write_to_file(buffer, generated_audio)
    out_bytes = buffer.getvalue()
    
    return out_bytes, {"Content-Type": "audio/wav"} 


def get_mask_args(request: Request):
    def get(request: Request, key: str) -> float:
        x = request.form.get(key, type=float)
        if x is None:
            raise ValueError(f"Expected {key} to be parseable as float. Got {request.form.get(key)} instead.")
        return x

    keys = [
        'paste_from',
        'paste_to',
        'crop_from',
        'softness_right',
        'softness_left',
        'mask_start',
        'mask_end',
        'marination',
    ]

    if all(key in request.form for key in keys):
        mask_args: MaskArgs = {
            'pastefrom': get(request, 'paste_from'),
            'pasteto': get(request, 'paste_to'),
            'cropfrom': get(request, 'crop_from'),
            'softnessR': get(request, 'softness_right'),
            'softnessL': get(request, 'softness_left'),
            'maskstart': get(request, 'mask_start'),
            'maskend': get(request, 'mask_end'),
            'marination': get(request, 'marination'),
        }
        return mask_args   
    return None

def try_get_init_audio(request: flask.Request) -> tuple[AudioTensor, int, float] | None:
    if 'init_audio' not in request.files:
        return None
    print("init_audio included!")
    file = request.files['init_audio']
    try:
        (audio, sample_rate) = torchaudio.load(file.stream)
        init_noise_level = request.form.get('init_noise_level', INIT_NOISE_LEVEL, type=float)
        return audio, sample_rate, init_noise_level
    except Exception as err:
        print("Couldn't parse input file:", err)
        return None

# GENERATION
def load_model_config(model_config_path: str) -> ModelConfig:
    with open(model_config_path) as f:
        return json.load(f)

def load_model(model_config: ModelConfig, model_ckpt_path: str, device: DeviceStr) -> Model:
    model = sd_tools.create_model_from_config(model_config)
    model.load_state_dict(sd_tools_util.load_ckpt_state_dict(model_ckpt_path))
    model = model.to(device)
    return model

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

