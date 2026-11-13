import { pipeline, env } from "@huggingface/transformers";
import { readFileSync } from "node:fs";
const wav = (f) => { const b = readFileSync(f); const pcm = new Int16Array(b.buffer, b.byteOffset + 44, (b.length - 44) / 2); return Float32Array.from(pcm, (v) => v / 32768); };
const t0 = Date.now();
const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", { dtype: "q8" });
console.log("model loaded in", ((Date.now() - t0) / 1000).toFixed(1), "s");
for (const f of ["hey.wav", "noise-talk.wav"]) {
  const t = Date.now();
  const out = await asr(wav("C:/Users/nagan/AppData/Local/Temp/claude/37525a4e85f9616e/1e6f5515-7324-4aa0-acea-b1b984407c4d/scratchpad/" + f));
  console.log(f.padEnd(15), ((Date.now() - t) / 1000).toFixed(1) + "s", JSON.stringify(out.text));
}
