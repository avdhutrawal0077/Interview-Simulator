/**
 * public/pcm-worklet.js
 * ─────────────────────
 * AudioWorklet processor that runs in the browser's real-time audio thread.
 *
 * Responsibilities:
 *  1. Accept any AudioContext sample rate (44.1 kHz / 48 kHz) and resample
 *     to 16 kHz using a simple linear downsample (every Nth sample).
 *  2. Convert Float32 [-1, 1] → Int16 PCM [-32768, 32767].
 *  3. Accumulate output into 512-sample (32 ms @ 16 kHz) frames.
 *  4. Transfer each complete frame to the main thread via postMessage with
 *     a transferable ArrayBuffer (zero-copy).
 *  5. Honour a `muted` flag: when muted, frames are discarded (not sent).
 *
 * The main thread registers this via:
 *   audioCtx.audioWorklet.addModule('/pcm-worklet.js')
 *   const node = new AudioWorkletNode(audioCtx, 'pcm-processor')
 *   node.port.onmessage = (e) => sendOverWebSocket(e.data)
 *   node.port.postMessage({ type: 'mute' })   // or 'unmute'
 */

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    // Resample ratio: input rate → 16 kHz
    this._ratio = sampleRate / 16000;
    this._phase = 0.0;          // fractional accumulator for resampler

    // 32 ms output frame = 512 samples at 16 kHz
    this._TARGET_FRAME = 512;
    this._outBuf = new Int16Array(this._TARGET_FRAME);
    this._outPos = 0;

    this._muted = false;

    // Listen for control messages from the main thread
    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'mute')   this._muted = true;
      if (msg.type === 'unmute') this._muted = false;
    };
  }

  /**
   * Called by the browser audio thread for each render quantum (~128 samples).
   * @param {Float32Array[][]} inputs  - inputs[0][0] = mono mic channel
   */
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    // Walk through input samples and down-sample to 16 kHz
    for (let i = 0; i < channel.length; i++) {
      // Advance phase by 1 input sample
      this._phase += 1;

      if (this._phase >= this._ratio) {
        this._phase -= this._ratio;

        // Convert float32 → int16
        const sample = Math.max(-1, Math.min(1, channel[i]));
        const pcm16 = sample < 0
          ? Math.max(-32768, Math.round(sample * 32768))
          : Math.min( 32767, Math.round(sample * 32767));

        if (!this._muted) {
          this._outBuf[this._outPos++] = pcm16;
        } else {
          this._outPos++;   // advance position so frame length stays accurate
        }

        // Flush when a complete 32 ms frame is ready
        if (this._outPos >= this._TARGET_FRAME) {
          const frame = this._muted
            ? new Int16Array(this._TARGET_FRAME)  // silence frame
            : this._outBuf.slice(0);              // copy of filled frame

          if (!this._muted) {
            // Transfer ownership (zero-copy) of the underlying buffer
            const transfer = frame.buffer;
            this.port.postMessage(transfer, [transfer]);
          }

          // Reset output buffer
          this._outBuf = new Int16Array(this._TARGET_FRAME);
          this._outPos = 0;
        }
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor('pcm-processor', PcmProcessor);
