// AudioWorklet processor for rq3.html: reports the worklet global scope's sampleRate to the page.
registerProcessor('fproot-rate', class extends AudioWorkletProcessor {
  constructor() { super(); this.port.postMessage(sampleRate); }   // AudioWorkletGlobalScope.sampleRate
  process() { return false; }
});
