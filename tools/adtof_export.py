"""
One-time conversion of the ADTOF Frame_RNN drum model (PyTorch port by
xavriley/ADTOF-pytorch, weights CC BY-NC-SA 4.0 by Zehren et al.) to ONNX
for in-browser inference, plus reference outputs to check the TypeScript
preprocessing and runtime against.

usage: python -I tools/adtof_export.py <ADTOF-pytorch checkout> <out dir> [ref audio ...]
"""
import json
import sys
from pathlib import Path

repo = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
refs = [Path(p).resolve() for p in sys.argv[3:]]
sys.path.insert(0, str(repo / "src"))

import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402
import torch  # noqa: E402
from adtof_pytorch.model import (  # noqa: E402
    calculate_n_bins,
    create_frame_rnn_model,
    load_pytorch_weights,
)
from adtof_pytorch.audio import process_audio_file  # noqa: E402

out.mkdir(parents=True, exist_ok=True)
n_bins = calculate_n_bins()
model = create_frame_rnn_model(n_bins)
model.eval()
model = load_pytorch_weights(model, str(repo / "data" / "adtof_frame_rnn_pytorch_weights.pth"), strict=True)
print("n_bins", n_bins, "params", sum(p.numel() for p in model.parameters()))



class Cnn(torch.nn.Module):
    """conv blocks only: receptive field is ±4 frames, so it can run in chunks exactly"""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):  # [1, T, F, 1] -> [1, T, 640]
        b, t = x.shape[0], x.shape[1]
        x = x.permute(0, 3, 1, 2)
        for blk in self.m.cnn_blocks:
            x = blk(x)
        x = x.permute(0, 2, 3, 1)
        return x.reshape(b, t, x.shape[2] * x.shape[3])


class Rnn(torch.nn.Module):
    """recurrent layers + output: run over the whole song at once"""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):  # [1, T, 640] -> [1, T, 5]
        for gru in self.m.gru_layers:
            x, _ = gru(x)
        return torch.sigmoid(self.m.output_layer(x))


def export(mod, dummy, path, inp, outp):
    torch.onnx.export(mod, (dummy,), str(path), input_names=[inp], output_names=[outp],
                      dynamic_axes={inp: {1: "time"}, outp: {1: "time"}}, opset_version=17, dynamo=False)
    print("onnx", path.name, path.stat().st_size, "bytes")


cnn, rnn = Cnn(model).eval(), Rnn(model).eval()
export(cnn, torch.randn(1, 300, n_bins, 1), out / "adtof-cnn.onnx", "spec", "feat")
export(rnn, torch.randn(1, 300, cnn(torch.randn(1, 10, n_bins, 1)).shape[2]), out / "adtof-rnn.onnx", "feat", "act")

s_cnn = ort.InferenceSession(str(out / "adtof-cnn.onnx"), providers=["CPUExecutionProvider"])
s_rnn = ort.InferenceSession(str(out / "adtof-rnn.onnx"), providers=["CPUExecutionProvider"])
for ref in refs:
    spec, _ = process_audio_file(str(ref))  # [T, F, 1]
    x = torch.from_numpy(spec).float().unsqueeze(0)
    with torch.no_grad():
        pt = model(x).numpy()[0]
    feat = s_cnn.run(None, {"spec": x.numpy()})[0]
    ox = s_rnn.run(None, {"feat": feat})[0][0]
    print(f"{ref.name}: T={spec.shape[0]} torch-vs-onnx max|diff|={np.abs(pt - ox).max():.2e}")
    stem = out / ref.stem.replace(" ", "_")
    spec[:, :, 0].astype("<f4").tofile(f"{stem}.spec.f32")
    pt.astype("<f4").tofile(f"{stem}.act.f32")
    json.dump({"frames": int(spec.shape[0]), "bins": int(spec.shape[1]), "classes": int(pt.shape[1])}, open(f"{stem}.json", "w"))
