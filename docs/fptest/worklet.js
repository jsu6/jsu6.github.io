registerProcessor('probe', class extends AudioWorkletProcessor {
  constructor() { super(); this.sent = false; this.port.postMessage({kind: 'ctor', sampleRate: sampleRate}); }
  process() {
    if (!this.sent) { this.sent = true; this.port.postMessage({kind: 'process', currentTime: currentTime}); }
    return true;
  }
});
