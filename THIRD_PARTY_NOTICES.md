# Third-party notices

Jam Like a Legend's own source code is MIT licensed, copyright © 2026 Attune
LLC (see [LICENSE](LICENSE)). It includes or uses the work below, each under
its own license.

## In this repository

### ADTOF Frame_RNN drum transcription model

- Files: `public/models/adtof-cnn.onnx`, `public/models/adtof-rnn.onnx`
- By Mickaël Zehren, Marco Alunno and Paolo Bientinesi ("High-Quality and
  Reproducible Automatic Drum Transcription from Crowdsourced Data", *Signals*
  2023), https://github.com/MZehren/ADTOF, through the PyTorch port by Xavier
  Riley, https://github.com/xavriley/ADTOF-pytorch
- License: **CC BY-NC-SA 4.0, non-commercial use only**,
  https://creativecommons.org/licenses/by-nc-sa/4.0/
- Changes: converted to ONNX and split into a convolutional part and a
  recurrent part; the weights are unchanged.

Because of this model, the app as shipped is for non-commercial use. Before it
is sold or used commercially, the model has to be replaced or licensed.

## Downloaded when the app runs

### Demucs v4 (`htdemucs_ft`, drums model)

- By Meta Platforms, Inc., https://github.com/facebookresearch/demucs, MIT
  license
- ONNX export (`htdemucs_ft_drums_safe16.onnx`) by monteslu,
  https://huggingface.co/monteslu/htdemucs-ft-webgpu
- Not stored in this repository: the app downloads it the first time a song is
  imported with drum separation on, and checks it against a SHA-256.

## Libraries in the built app

| Library | Used for | License |
|---|---|---|
| [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) | changing a song's tempo without changing its pitch | LGPL-2.1 |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | running both models in the browser | MIT |
| [React](https://github.com/facebook/react) and React DOM | the interface | MIT |
| [Geist and Geist Mono](https://github.com/vercel/geist-font), packaged by Fontsource | the typefaces | SIL Open Font License 1.1 |

SoundTouchJS is used unmodified as an npm dependency; its source is available
from the link above.

## Methods reimplemented here

No files from these projects are included; the TypeScript in
`src/engine/chart/` is this project's own implementation of the same methods.

- **madmom** (CPJKU, https://github.com/CPJKU/madmom): the log-filtered
  spectrogram the drum model was trained on and the peak picking it is read
  with (`adtofSpec.ts`, `adtof.ts`).
- **Demucs**: its spectrogram and inverse (`demucs.ts`).
- **Daniel P. W. Ellis, "Beat Tracking by Dynamic Programming"** (2007): the
  beat tracker (`beats.ts`).
