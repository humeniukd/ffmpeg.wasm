const AUDIO_CONSTRAINTS = {
    sampleRate: 44100,
    echoCancellation: false,
    autoGainControl: false,
    noiseSuppression: false
}

const FLUSH_TIMEOUT_MS = 500;

export class Recorder {
    buffers = [];

    length = 0;
    channels = 0;
    started = false;
    ondataavailable;
    ctx;
    mediaStream;
    sourceNode;
    gainNode;
    recordingNode;

    _resolveFlush;
    _flushTimer;

    constructor(onPermissionDenied, maxRecordingTime = Infinity) {
        this.onPermissionDenied = onPermissionDenied;
        this.maxRecordingTime = maxRecordingTime;
    }

    get context() {
        if (!this.ctx)
            this.ctx = new AudioContext();
        return this.ctx
    }

    async setupRecordingWorkletNode(processorOptions) {
        let node;
        try {
            node = new AudioWorkletNode(this.context, 'recording', { processorOptions });
        } catch {
            await this.context.audioWorklet.addModule(new URL("./recording.js", import.meta.url));
            return new AudioWorkletNode(this.context, 'recording', { processorOptions });
        }
        return node;
    }

    async openStream() {
        if (this.context.state === 'suspended')
            await this.context.resume();

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: { ...AUDIO_CONSTRAINTS },
            })

            this.sourceNode = new MediaStreamAudioSourceNode(this.context, { mediaStream: this.mediaStream });
            this.gainNode = new GainNode(this.context);

            const recordingProperties = {
                maxRecordingTime: this.maxRecordingTime,
                numberOfChannels: this.sourceNode.channelCount,
                sampleRate: this.context.sampleRate
            };

            this.recordingNode = await this.setupRecordingWorkletNode(recordingProperties);

            const port = this.recordingNode.port;

            port.onmessage = (event) => {
                if (event.data.message !== 'SHARE_RECORDING_BUFFER')
                    return;

                const { payload, channels, last } = event.data;

                if (channels)
                    this.channels = channels;

                if (payload.length) {
                    this.buffers.push(payload);
                    this.length += payload.length;
                }

                if (!last)
                    return;

                if (this._resolveFlush)
                    this._settleFlush();          // the tail of a stop() we are awaiting
                else if (this.started)
                    this._finish();               // the worklet hit maxRecordingFrames on its own
            };

            this.gainNode.gain.value = 0;

            this.sourceNode.connect(this.recordingNode)
            .connect(this.gainNode)
            .connect(this.context.destination);
        } catch (e) {
            console.log('asdf', e);
            this.onPermissionDenied()
            return undefined
        }
    }

    start() {
        if (!this.started) {
            this.started = true;
            this.recordingNode.port.postMessage({
                message: 'UPDATE_RECORDING_STATE',
                payload: true,
            });
        }
    }

    concatBuffers() {
        const batch = new Float32Array(this.length);
        let offset = 0;
        for (let i = 0; i < this.buffers.length; i++) {
            batch.set(this.buffers[i], offset);
            offset += this.buffers[i].length;
        }
        return batch
    }

    getActiveDeviceId() {
        return this.mediaStream?.getTracks()[0]?.getSettings().deviceId;
    }

    reset() {
        this.mediaStream?.getAudioTracks()[0].stop();

        if (this.recordingNode)
            this.sourceNode?.disconnect(this.recordingNode);

        if (this.gainNode)
            this.recordingNode?.disconnect(this.gainNode);

        if (this.ctx) {
            this.gainNode?.disconnect(this.ctx.destination);
            return this.ctx.suspend();
        }
    }

    _settleFlush() {
        clearTimeout(this._flushTimer);
        this._flushTimer = undefined;

        const resolve = this._resolveFlush;
        this._resolveFlush = undefined;
        resolve?.();
    }

    _finish() {
        this.started = false;

        this.ondataavailable(
            this.concatBuffers(),
            this.channels || this.sourceNode.channelCount,
            this.context.sampleRate
        );

        this.buffers = [];
        this.length = 0;
    }

    // Ask the worklet to stop and wait for it to hand back the trailing partial
    // buffer before concatenating, otherwise up to publishInterval frames are lost.
    async stop() {
        if (!this.started) return;

        await new Promise((resolve) => {
            this._resolveFlush = resolve;
            this._flushTimer = setTimeout(() => this._settleFlush(), FLUSH_TIMEOUT_MS);

            this.recordingNode.port.postMessage({
                message: 'UPDATE_RECORDING_STATE',
                payload: false,
            });
        });

        if (this.started)
            this._finish();
    }
}
