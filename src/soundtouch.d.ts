declare module 'soundtouchjs' {
  export class SoundTouch {
    constructor();
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
    clear(): void;
  }
  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
    buffer: AudioBuffer;
    position: number;
  }
  export class SimpleFilter {
    constructor(source: WebAudioBufferSource, pipe: SoundTouch, onEnd?: () => void);
  }
  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize?: number, onEnd?: () => void);
    node: AudioNode;
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
    timePlayed: number;
    duration: number;
    percentagePlayed: number;
    connect(toNode: AudioNode): void;
    disconnect(): void;
    on(eventName: string, cb: (detail: unknown) => void): void;
    off(eventName?: string): void;
  }
  export function getWebAudioNode(
    context: AudioContext,
    filter: unknown,
    sourcePositionCallback?: (pos: number) => void,
    bufferSize?: number,
  ): AudioNode;
}
