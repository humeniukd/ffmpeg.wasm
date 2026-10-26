// eslint-disable-next-line no-undef
class Recording extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.sampleRate = options?.processorOptions?.sampleRate;
    const maxRecordingTime = options?.processorOptions?.maxRecordingTime;

    if (isNaN(this.sampleRate))
      throw new SyntaxError('sampleRate');

    this.maxRecordingFrames = this.sampleRate * maxRecordingTime;

    this.recordedFrames = 0;
    this.isRecording = false;

    this.publishInterval = 512;

    // Sized on the first render quantum, once the real channel count is known.
    this.channels = 0;
    this.framesInBuffer = 0;
    this._recordingBuffer = new Float32Array(0);

    this.port.onmessage = (event) => {
      if (event.data.message !== 'UPDATE_RECORDING_STATE')
        return;

      const isRecording = event.data.payload;

      if (isRecording === this.isRecording)
        return;

      this.isRecording = isRecording;

      if (isRecording) {
        // Start on a clean buffer: the write offset must not carry over.
        this.framesInBuffer = 0;
        this.recordedFrames = 0;
      } else {
        // Flush the tail so the last partial buffer is not dropped. Always
        // publish, even when empty.
        this.publish();
        this.framesInBuffer = 0;
      }
    };
  }

  publish(last) {
    this.port.postMessage({
      message: 'SHARE_RECORDING_BUFFER',
      payload: this._recordingBuffer.slice(0, this.framesInBuffer * this.channels),
      channels: this.channels,
      last
    });
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    const channels = input.length;

    // The input is legitimately empty before the source connects and while it
    // is disconnected; returning false here would retire the processor for good.
    if (!channels)
      return true;

    const quantum = input[0].length;

    if (channels !== this.channels) {
      this.channels = channels;
      this._recordingBuffer = new Float32Array(this.publishInterval * channels);
      this.framesInBuffer = 0;
    }

    for (let i = 0; i < quantum; i++) {
      const base = (this.framesInBuffer + i) * channels;

      for (let ch = 0; ch < channels; ch++) {
        const s = input[ch][i];

        if (this.isRecording)
          this._recordingBuffer[base + ch] = s;

        if (output[ch])
          output[ch][i] = s;
      }
    }

    // The write offset only advances while recording, otherwise a recording
    // started mid-cycle would begin at a stale offset.
    if (!this.isRecording)
      return true;

    this.framesInBuffer += quantum;
    this.recordedFrames += quantum;

    const reachedMax = this.recordedFrames >= this.maxRecordingFrames;

    // Publish once the buffer is full, before the next quantum would overrun it.
    if (this.framesInBuffer >= this.publishInterval || reachedMax) {
      this.publish(reachedMax);
      this.framesInBuffer = 0;
    }

    if (reachedMax)
      this.isRecording = false;

    return true;
  }
}

registerProcessor('recording', Recording);
