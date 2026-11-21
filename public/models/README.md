# Drum transcription model: not MIT

`adtof-cnn.onnx` and `adtof-rnn.onnx` are the **ADTOF Frame_RNN** drum
transcription model.

- **Authors:** Mickaël Zehren, Marco Alunno and Paolo Bientinesi, "High-Quality
  and Reproducible Automatic Drum Transcription from Crowdsourced Data",
  *Signals* 2023.
- **Source:** https://github.com/MZehren/ADTOF, through the PyTorch port by
  Xavier Riley, https://github.com/xavriley/ADTOF-pytorch.
- **License:** Creative Commons Attribution-NonCommercial-ShareAlike 4.0
  International (CC BY-NC-SA 4.0),
  https://creativecommons.org/licenses/by-nc-sa/4.0/. **Non-commercial use
  only.** Anything made from these files carries the same license.
- **Changes:** the published weights were converted to ONNX and split into a
  convolutional part and a recurrent part (`tools/adtof_export.py`). The
  weights themselves are unchanged.

The MIT license in the repository root does not apply to these two files.
