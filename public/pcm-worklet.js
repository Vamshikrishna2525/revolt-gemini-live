class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = (options?.processorOptions?.targetRate) || 16000;
    this.inRate = sampleRate;
    this.ratio = this.inRate / this.targetRate;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    const src = channel;
    const resampled = new Float32Array(Math.floor(src.length / this.ratio));
    for (let i = 0; i < resampled.length; i++) {
      const t = i * this.ratio;
      const i0 = Math.floor(t);
      const i1 = Math.min(i0 + 1, src.length - 1);
      const frac = t - i0;
      resampled[i] = src[i0] * (1 - frac) + src[i1] * frac;
    }
    const pcm = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      let s = Math.max(-1, Math.min(1, resampled[i]));
      pcm[i] = (s * 0x7fff) | 0;
    }
    this.port.postMessage({ type: 'pcm', payload: pcm.buffer }, [pcm.buffer]);
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
