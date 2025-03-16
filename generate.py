from typing import Any, Literal, TypeVar, TypedDict

import stable_audio_tools.inference.generation as sd_tools_generate
import einops
import torch

# TYPES
T = TypeVar("T")
ModelConfig = Any
DeviceStr = Literal["cuda", "cpu"]
Model = Any
ConditioningDict = dict
AudioTensor = torch.Tensor

class MaskArgs(TypedDict):
    pastefrom: float
    pasteto: float
    cropfrom: float
    maskstart: float
    maskend: float
    softnessL: float
    softnessR: float
    marination: float


# Returns a tensor of shape [2, SAMPLE_SIZE]
def run_model(
              model: Model,
              device: DeviceStr,
              positive_prompt: str,
              negative_prompt: str | None, 
              length: float,
              sample_rate: int,
              steps: int,
              seed: int,
              cfg_scale: float,
              sigma_min: float,
              sigma_max: float,
              sampler_type: str,
              init_audio_args: tuple[AudioTensor, int, float] | None,
              mask_args: MaskArgs | None) -> AudioTensor:
    
    sample_size = round(length * sample_rate)
    # Set up text and timing conditioning
    positive_conditioning = [{
        "prompt": positive_prompt,
        "seconds_start": 0,
        "seconds_total": length
    }]
    negative_conditioning = [{
        "prompt": negative_prompt,
        "seconds_start": 0, 
        "seconds_total": length
    }] if negative_prompt is not None else None

    init_audio = None
    init_noise_level = None
    if init_audio_args is not None:
        (audio, sample_rate, noise_level) = init_audio_args
        init_audio = (sample_rate, audio)
        init_noise_level = noise_level

    # Generate stereo audio
    output = sd_tools_generate.generate_diffusion_cond(
        model,
        steps=steps,
        cfg_scale=cfg_scale,
        conditioning=positive_conditioning,
        negative_conditioning=negative_conditioning,
        sample_size=sample_size,
        sigma_min=sigma_min,
        sigma_max=sigma_max,
        sampler_type=sampler_type,
        device=device,
        seed=seed,
        batch_size=1,
        init_audio=init_audio,
        init_noise_level=init_noise_level,
        mask_args=mask_args
    )

    # Rearrange audio batch to a single sequence
    output = einops.rearrange(output, "b d n -> d (b n)")

    # Peak normalize, clip, 
    max_value = torch.max(torch.abs(output))
    output = output.to(torch.float32).div(max_value).clamp(-1, 1)
    return output
