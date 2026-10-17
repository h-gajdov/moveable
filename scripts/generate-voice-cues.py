"""Generate the spoken planner hints with OmniVoice (k2-fsa/OmniVoice).

The text comes from the `voiceCues` section of each locale file, so the audio
always says what the UI string says. Output: frontend/public/audio/cues/<lang>/<key>.mp3.

One voice is designed once (English, voice-design mode) and then cloned for
every clip, so all three languages sound like the same speaker.

Needs an environment with `omnivoice` installed, e.g.
    ~/tts-trainer/data/omnivoice-env/bin/python scripts/generate-voice-cues.py
Re-run after changing a `voiceCues` string; `--only chooseStart` limits it to one key.
"""

import argparse
import json
from pathlib import Path

import soundfile as sf
import torch
from omnivoice import OmniVoice

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "frontend/src/i18n/locales"
OUT = ROOT / "frontend/public/audio/cues"
LANGUAGES = ("mk", "sq", "en")
SAMPLE_RATE = 24000

VOICE = "female, middle-aged, moderate pitch"
VOICE_TEXT = "Hello. I will tell you what to choose next, one step at a time."


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--model", default="k2-fsa/OmniVoice")
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--only", nargs="*", help="cue keys to regenerate (default: all)")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    dtype = torch.float16 if args.device.startswith("cuda") else torch.float32
    model = OmniVoice.from_pretrained(args.model, device_map=args.device, dtype=dtype)

    torch.manual_seed(args.seed)
    voice = model.generate(text=VOICE_TEXT, language="en", instruct=VOICE)[0]
    prompt = model.create_voice_clone_prompt(
        ref_audio=(torch.from_numpy(voice).unsqueeze(0), SAMPLE_RATE), ref_text=VOICE_TEXT
    )

    for lang in LANGUAGES:
        cues = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))["voiceCues"]
        (OUT / lang).mkdir(parents=True, exist_ok=True)
        for key, text in cues.items():
            if args.only and key not in args.only:
                continue
            torch.manual_seed(args.seed)
            audio = model.generate(text=text, language=lang, voice_clone_prompt=prompt)[0]
            path = OUT / lang / f"{key}.mp3"
            sf.write(path, audio, SAMPLE_RATE, format="MP3")
            print(f"{path.relative_to(ROOT)}  {len(audio) / SAMPLE_RATE:.1f}s  {text}")


if __name__ == "__main__":
    main()
