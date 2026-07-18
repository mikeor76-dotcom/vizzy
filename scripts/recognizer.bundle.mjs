// node_modules/node-shazam/dist/esm/fft.js
class ComplexNumber {
  constructor(real, imag) {
    this.real = real;
    this.imag = imag;
  }
  static add(a, b) {
    return new ComplexNumber(a.real + b.real, a.imag + b.imag);
  }
  static subtract(a, b) {
    return new ComplexNumber(a.real - b.real, a.imag - b.imag);
  }
  static multiply(a, b) {
    return new ComplexNumber(a.real * b.real - a.imag * b.imag, a.real * b.imag + a.imag * b.real);
  }
}
function fft(input) {
  const N = input.length;
  if (N <= 1) {
    return input;
  }
  const even = fft(input.filter((_, index) => index % 2 === 0));
  const odd = fft(input.filter((_, index) => index % 2 === 1));
  const twiddleFactors = Array.from({
    length: N
  }, (_, k) => {
    const angle = -2 * Math.PI * k / N;
    return new ComplexNumber(Math.cos(angle), Math.sin(angle));
  });
  const result = [];
  for (let k = 0;k < N / 2; k++) {
    const t = ComplexNumber.multiply(twiddleFactors[k], odd[k]);
    const add = ComplexNumber.add(even[k], t);
    const subtract = ComplexNumber.subtract(even[k], t);
    result[k] = add;
    result[k + N / 2] = subtract;
  }
  return result;
}

// node_modules/node-shazam/dist/esm/signatures.js
import { Buffer } from "buffer";
var crc32 = function(str) {
  let c;
  const crcTable = [];
  for (let n = 0;n < 256; n++) {
    c = n;
    for (let k = 0;k < 8; k++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    crcTable[n] = c;
  }
  let crc = 0 ^ -1;
  for (let i = 0;i < str.length; i++) {
    crc = crc >>> 8 ^ crcTable[(crc ^ str[i]) & 255];
  }
  return (crc ^ -1) >>> 0;
};
var FrequencyBand;
(function(FrequencyBand2) {
  FrequencyBand2[FrequencyBand2["_0_250"] = -1] = "_0_250";
  FrequencyBand2[FrequencyBand2["_250_520"] = 0] = "_250_520";
  FrequencyBand2[FrequencyBand2["_520_1450"] = 1] = "_520_1450";
  FrequencyBand2[FrequencyBand2["_1450_3500"] = 2] = "_1450_3500";
  FrequencyBand2[FrequencyBand2["_3500_5500"] = 3] = "_3500_5500";
})(FrequencyBand || (FrequencyBand = {}));
var SampleRate;
(function(SampleRate2) {
  SampleRate2[SampleRate2["_8000"] = 1] = "_8000";
  SampleRate2[SampleRate2["_11025"] = 2] = "_11025";
  SampleRate2[SampleRate2["_16000"] = 3] = "_16000";
  SampleRate2[SampleRate2["_32000"] = 4] = "_32000";
  SampleRate2[SampleRate2["_44100"] = 5] = "_44100";
  SampleRate2[SampleRate2["_48000"] = 6] = "_48000";
})(SampleRate || (SampleRate = {}));
var DATA_URI_PREFIX = "data:audio/vnd.shazam.sig;base64,";

class FrequencyPeak {
  constructor(fftPassNumber, peakMagnitude, correctedPeakFrequencyBin, sampleRateHz) {
    this.fftPassNumber = fftPassNumber;
    this.peakMagnitude = peakMagnitude;
    this.correctedPeakFrequencyBin = correctedPeakFrequencyBin;
    this.sampleRateHz = sampleRateHz;
  }
  getFrequencyHz() {
    return this.correctedPeakFrequencyBin * (this.sampleRateHz / 2 / 1024 / 64);
  }
  getAmplitudePcm() {
    return Math.sqrt(Math.exp((this.peakMagnitude - 6144) / 1477.3) * (1 << 17) / 2) / 1024;
  }
  getSeconds() {
    return this.fftPassNumber * 128 / this.sampleRateHz;
  }
}
var readUint32 = (data) => {
  return data[0] >> 24 | data[1] >> 16 | data[2] >> 8 | data[3];
};
var padTo32 = (data) => new Uint8Array([...data, ...Array(4 - data.length).fill(0)]);
var readInt32 = (data) => new Int32Array(data)[0];
var writeUint32 = (e) => [e & 255, e >> 8 & 255, e >> 16 & 255, e >> 24 & 255];
var writeInt32 = (e) => {
  const q = new DataView(new ArrayBuffer(4), 0);
  q.setInt32(0, e, true);
  return new Uint8Array(q.buffer);
};
var writeInt16 = (e) => {
  const q = new DataView(new ArrayBuffer(2), 0);
  q.setInt16(0, e, true);
  return new Uint8Array(q.buffer);
};
function readRawSignatureHeader(read) {
  const _readUint32 = () => readUint32(read(4));
  const clear = (e) => Array(e).fill(0).map(readUint32);
  const magic1 = _readUint32(), crc322 = _readUint32(), sizeMinusHeader = _readUint32(), magic2 = _readUint32(), _a = clear(3), shiftedSampleRateId = _readUint32(), _b = clear(2), numberSamplesPlusDividedSampleRate = _readUint32(), fixedValue = _readUint32();
  return { magic1, crc32: crc322, sizeMinusHeader, magic2, shiftedSampleRateId, numberSamplesPlusDividedSampleRate, fixedValue };
}
function writeRawSignatureHeader(rsh) {
  const buffer = [];
  const _writeUint32 = (e) => buffer.push(...writeUint32(e));
  _writeUint32(rsh.magic1);
  _writeUint32(rsh.crc32);
  _writeUint32(rsh.sizeMinusHeader);
  _writeUint32(rsh.magic2);
  _writeUint32(0);
  _writeUint32(0);
  _writeUint32(0);
  _writeUint32(rsh.shiftedSampleRateId);
  _writeUint32(0);
  _writeUint32(0);
  _writeUint32(rsh.numberSamplesPlusDividedSampleRate);
  _writeUint32(rsh.fixedValue);
  return new Uint8Array(buffer);
}

class DecodedMessage {
  constructor() {
    this.uri = false;
    this.sampleRateHz = 0;
    this.numberSamples = 0;
    this.frequencyBandToSoundPeaks = {};
  }
  static decodeFromBinary(bytes) {
    const self = new DecodedMessage;
    let ptr = 0;
    const read = (e) => e === undefined ? bytes.slice(ptr, ptr = bytes.length) : bytes.slice(ptr, ptr += e);
    const seek = (e) => ptr = e;
    seek(8);
    const checksummableData = read();
    seek(0);
    const header = readRawSignatureHeader(read);
    if (header.magic1 != 3405653376) {
      console.log("ASSERT 3 FAIL");
    }
    self.sampleRateHz = parseInt(SampleRate[header.shiftedSampleRateId >> 27].substring(1));
    self.numberSamples = Math.round(header.numberSamplesPlusDividedSampleRate - self.sampleRateHz * 0.24);
    while (true) {
      const tlvHeader = read(8);
      if (tlvHeader.length === 0)
        break;
      const frequencyBandId = readInt32(tlvHeader.slice(0, 4)), frequencyPeaksSize = readInt32(tlvHeader.slice(4));
      const frequencyPeaksPadding = 4 + -frequencyPeaksSize % 4;
      read(frequencyPeaksPadding);
      const frequencyBand = frequencyBandId - 1610809408;
      let fftPassNumber = 0;
      self.frequencyBandToSoundPeaks[FrequencyBand[frequencyBand]] = [];
      while (true) {
        const rawFftPass = read(1);
        if (rawFftPass.length === 0)
          break;
        const fftPassOffset = rawFftPass[0];
        if (fftPassOffset === 255) {
          fftPassNumber = readInt32(read(4));
          continue;
        } else {
          fftPassNumber += fftPassOffset;
        }
        const peakMagnitude = readInt32(padTo32(read(2)));
        const correctedPeakFrequencyBin = readInt32(padTo32(read(2)));
        self.frequencyBandToSoundPeaks[FrequencyBand[frequencyBand]].push(new FrequencyPeak(fftPassNumber, peakMagnitude, correctedPeakFrequencyBin, self.sampleRateHz));
      }
    }
    return self;
  }
  static decodeFromUri(uri) {
    if (!uri.startsWith(DATA_URI_PREFIX)) {
      throw new Error("assert 4");
    }
    return this.decodeFromBinary(Buffer.from(uri.replace(DATA_URI_PREFIX, ""), "base64"));
  }
  encodeToBinary() {
    const header = {
      magic1: 3405653376,
      magic2: 2484182016,
      shiftedSampleRateId: SampleRate[`_${this.sampleRateHz}`] << 27,
      fixedValue: (15 << 19) + 262144,
      numberSamplesPlusDividedSampleRate: Math.round(this.numberSamples + this.sampleRateHz * 0.24),
      crc32: -1,
      sizeMinusHeader: -1
    };
    let contentsBuf = [];
    for (const x of Object.entries(this.frequencyBandToSoundPeaks).map((a) => [FrequencyBand[a[0]], a[1]]).sort((a, b) => a[0] - b[0])) {
      const frequencyBand = x[0], frequencyPeaks = x[1];
      const peaksBuffer = [];
      let fftPassNumber = 0;
      for (const frequencyPeak of frequencyPeaks) {
        if (frequencyPeak.fftPassNumber < fftPassNumber) {
          throw new Error("Assert 5");
        }
        if (frequencyPeak.fftPassNumber - fftPassNumber >= 255) {
          peaksBuffer.push(255);
          peaksBuffer.push(...writeInt32(frequencyPeak.fftPassNumber));
          fftPassNumber = frequencyPeak.fftPassNumber;
        }
        peaksBuffer.push(frequencyPeak.fftPassNumber - fftPassNumber);
        peaksBuffer.push(...writeInt16(frequencyPeak.peakMagnitude - 1));
        peaksBuffer.push(...writeInt16(frequencyPeak.correctedPeakFrequencyBin - 1));
        fftPassNumber = frequencyPeak.fftPassNumber;
      }
      contentsBuf.push(...writeInt32(1610809408 + frequencyBand));
      contentsBuf.push(...writeInt32(peaksBuffer.length));
      contentsBuf = contentsBuf.concat(peaksBuffer);
      const paddingCount = 4 - peaksBuffer.length % 4;
      if (paddingCount < 4)
        contentsBuf.push(...Array(paddingCount).fill(0));
    }
    header.sizeMinusHeader = contentsBuf.length + 8;
    let buf = [];
    buf.push(...writeRawSignatureHeader(header));
    buf.push(...writeInt32(1073741824));
    buf.push(...writeInt32(contentsBuf.length + 8));
    buf = buf.concat(contentsBuf);
    header.crc32 = crc32(buf.slice(8));
    const newHeader = writeRawSignatureHeader(header);
    buf.splice(0, newHeader.length, ...newHeader);
    return buf;
  }
  encodeToUri() {
    const bin = this.encodeToBinary();
    return DATA_URI_PREFIX + Buffer.from(bin).toString("base64");
  }
}

// node_modules/node-shazam/dist/esm/algorithm.js
var hanning = (m) => Array(m).fill(0).map((_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (m - 1)));
var pyMod = (a, b) => a % b >= 0 ? a % b : b + a % b;
var HANNING_MATRIX = hanning(2050).slice(1, 2049);

class RingBuffer {
  constructor(bufferSize, defaultValue) {
    this.bufferSize = bufferSize;
    this.position = 0;
    this.written = 0;
    if (typeof defaultValue === "function") {
      this.list = Array(bufferSize).fill(null).map(defaultValue);
    } else {
      this.list = Array(bufferSize).fill(defaultValue ?? null);
    }
  }
  append(value) {
    this.list[this.position] = value;
    this.position++;
    this.written++;
    this.position %= this.bufferSize;
  }
}

class SignatureGenerator {
  initFields() {
    this.ringBufferOfSamples = new RingBuffer(2048, 0);
    this.fftOutputs = new RingBuffer(256, () => new Float64Array(Array(1025).fill(0)));
    this.spreadFFTsOutput = new RingBuffer(256, () => new Float64Array(Array(1025).fill(0)));
    this.nextSignature = new DecodedMessage;
    this.nextSignature.sampleRateHz = 16000;
    this.nextSignature.numberSamples = 0;
    this.nextSignature.frequencyBandToSoundPeaks = {};
  }
  constructor() {
    this.inputPendingProcessing = [];
    this.samplesProcessed = 0;
    this.initFields();
  }
  feedInput(s16leMonoSamples) {
    this.inputPendingProcessing = this.inputPendingProcessing.concat(s16leMonoSamples);
  }
  getNextSignature() {
    if (this.inputPendingProcessing.length - this.samplesProcessed < 128) {
      return null;
    }
    this.processInput(this.inputPendingProcessing);
    this.samplesProcessed += this.inputPendingProcessing.length;
    const returnedSignature = this.nextSignature;
    this.initFields();
    return returnedSignature;
  }
  processInput(s16leMonoSamples) {
    this.nextSignature.numberSamples += s16leMonoSamples.length;
    for (let positionOfChunk = 0;positionOfChunk < s16leMonoSamples.length; positionOfChunk += 128) {
      this.doFFT(s16leMonoSamples.slice(positionOfChunk, positionOfChunk + 128));
      this.doPeakSpreading();
      if (this.spreadFFTsOutput.written >= 46) {
        this.doPeakRecognition();
      }
    }
  }
  doFFT(batchOf128S16leMonoSamples) {
    this.ringBufferOfSamples.list.splice(this.ringBufferOfSamples.position, batchOf128S16leMonoSamples.length, ...batchOf128S16leMonoSamples);
    this.ringBufferOfSamples.position += batchOf128S16leMonoSamples.length;
    this.ringBufferOfSamples.position %= 2048;
    this.ringBufferOfSamples.written += batchOf128S16leMonoSamples.length;
    const excerptFromRingBuffer = [
      ...this.ringBufferOfSamples.list.slice(this.ringBufferOfSamples.position),
      ...this.ringBufferOfSamples.list.slice(0, this.ringBufferOfSamples.position)
    ];
    const results = fft(excerptFromRingBuffer.map((v, i) => new ComplexNumber(v * HANNING_MATRIX[i], 0))).map((e) => (e.imag * e.imag + e.real * e.real) / (1 << 17)).map((e) => e < 0.0000000001 ? 0.0000000001 : e).slice(0, 1025);
    if (results.length != 1025) {
      console.log("ASSERT FAILED!");
    }
    this.fftOutputs.append(new Float64Array(results));
  }
  doPeakSpreading() {
    const originLastFFT = this.fftOutputs.list[pyMod(this.fftOutputs.position - 1, this.fftOutputs.bufferSize)], spreadLastFFT = new Float64Array(originLastFFT);
    for (let position = 0;position < 1025; position++) {
      if (position < 1023) {
        spreadLastFFT[position] = Math.max(...spreadLastFFT.slice(position, position + 3));
      }
      let maxValue = spreadLastFFT[position];
      for (const formerFftNum of [-1, -3, -6]) {
        const formerFftOutput = this.spreadFFTsOutput.list[pyMod(this.spreadFFTsOutput.position + formerFftNum, this.spreadFFTsOutput.bufferSize)];
        if (isNaN(formerFftOutput[position]))
          continue;
        formerFftOutput[position] = maxValue = Math.max(formerFftOutput[position], maxValue);
      }
    }
    this.spreadFFTsOutput.append(spreadLastFFT);
  }
  doPeakRecognition() {
    const fftMinus46 = this.fftOutputs.list[pyMod(this.fftOutputs.position - 46, this.fftOutputs.bufferSize)];
    const fftMinus49 = this.spreadFFTsOutput.list[pyMod(this.spreadFFTsOutput.position - 49, this.spreadFFTsOutput.bufferSize)];
    const range = (a, b, c = 1) => {
      const out = [];
      for (let i = a;i < b; i += c)
        out.push(i);
      return out;
    };
    for (let binPosition = 10;binPosition < 1015; binPosition++) {
      if (fftMinus46[binPosition] >= 1 / 64 && fftMinus46[binPosition] >= fftMinus49[binPosition - 1]) {
        let maxNeighborInFftMinus49 = 0;
        for (const neighborOffset of [...range(-10, -3, 3), -3, 1, ...range(2, 9, 3)]) {
          const candidate = fftMinus49[binPosition + neighborOffset];
          if (isNaN(candidate))
            continue;
          maxNeighborInFftMinus49 = Math.max(candidate, maxNeighborInFftMinus49);
        }
        if (fftMinus46[binPosition] > maxNeighborInFftMinus49) {
          let maxNeighborInOtherAdjacentFFTs = maxNeighborInFftMinus49;
          for (const otherOffset of [-53, -45, ...range(165, 201, 7), ...range(214, 250, 7)]) {
            const candidate = this.spreadFFTsOutput.list[pyMod(this.spreadFFTsOutput.position + otherOffset, this.spreadFFTsOutput.bufferSize)][binPosition - 1];
            if (isNaN(candidate))
              continue;
            maxNeighborInOtherAdjacentFFTs = Math.max(candidate, maxNeighborInOtherAdjacentFFTs);
          }
          if (fftMinus46[binPosition] > maxNeighborInOtherAdjacentFFTs) {
            const fftNumber = this.spreadFFTsOutput.written - 46;
            const peakMagnitude = Math.log(Math.max(1 / 64, fftMinus46[binPosition])) * 1477.3 + 6144, peakMagnitudeBefore = Math.log(Math.max(1 / 64, fftMinus46[binPosition - 1])) * 1477.3 + 6144, peakMagnitudeAfter = Math.log(Math.max(1 / 64, fftMinus46[binPosition + 1])) * 1477.3 + 6144;
            const peakVariation1 = peakMagnitude * 2 - peakMagnitudeBefore - peakMagnitudeAfter, peakVariation2 = (peakMagnitudeAfter - peakMagnitudeBefore) * 32 / peakVariation1;
            const correctedPeakFrequencyBin = binPosition * 64 + peakVariation2;
            if (peakVariation1 <= 0) {
              console.log("Assert 2 failed - " + peakVariation1);
            }
            const frequencyHz = correctedPeakFrequencyBin * (16000 / 2 / 1024 / 64);
            let band;
            if (frequencyHz < 250) {
              continue;
            } else if (frequencyHz <= 520) {
              band = FrequencyBand._250_520;
            } else if (frequencyHz <= 1450) {
              band = FrequencyBand._520_1450;
            } else if (frequencyHz <= 3500) {
              band = FrequencyBand._1450_3500;
            } else if (frequencyHz <= 5500) {
              band = FrequencyBand._3500_5500;
            } else
              continue;
            if (!Object.keys(this.nextSignature.frequencyBandToSoundPeaks).includes(FrequencyBand[band])) {
              this.nextSignature.frequencyBandToSoundPeaks[FrequencyBand[band]] = [];
            }
            this.nextSignature.frequencyBandToSoundPeaks[FrequencyBand[band]].push(new FrequencyPeak(fftNumber, Math.round(peakMagnitude), Math.round(correctedPeakFrequencyBin), 16000));
          }
        }
      }
    }
  }
}

// stub:shazamio-core
function recognizeBytes() {
  throw new Error("shazamio-core is stubbed out — use fullRecognizeSong(samples)");
}

// stub:node-fetch
var f = (...args) => globalThis.fetch(...args);
var node_fetch_default = f;
var Headers = globalThis.Headers;
var Request = globalThis.Request;
var Response = globalThis.Response;

// node_modules/node-shazam/dist/esm/utils.js
function s16LEToSamplesArray(rawSamples) {
  const samplesArray = [];
  for (let i = 0;i < rawSamples.length / 2; i++) {
    let sample = rawSamples[2 * i] | rawSamples[2 * i + 1] << 8;
    if (sample & 32768) {
      sample = (sample & 32767) - 32768;
    }
    samplesArray.push(sample);
  }
  return samplesArray;
}

// node_modules/node-shazam/dist/esm/api.js
import fs from "fs";
import { readFileSync } from "fs";

// node_modules/node-shazam/dist/esm/useragents.js
var USER_AGENTS = [
  "Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SM-T210 Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-P905V Build/LMY47X)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; Vodafone Smart Tab 4G Build/KTU84P)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; SM-G360H Build/KTU84P)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0.2; SM-S920L Build/LRX22G)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; Fire Pro Build/LRX21M)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-N9005 Build/LRX21V)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SM-G7102 Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-G900F Build/LRX21T)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G928F Build/MMB29K)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-J500FN Build/LMY48B)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; Coolpad 3320A Build/LMY47V)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; SM-J110F Build/KTU84P)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SAMSUNG-SGH-I747 Build/KOT49H)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SAMSUNG-SM-T337A Build/KOT49H)",
  "Dalvik/1.6.0 (Linux; U; Android 4.3; SGH-T999 Build/JSS15J)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; D6603 Build/23.5.A.0.570)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-J700H Build/LMY48B)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; HTC6600LVW Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-N910G Build/LMY47X)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-N910T Build/LMY47X)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; C6903 Build/14.4.A.0.157)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)",
  "Dalvik/1.6.0 (Linux; U; Android 4.2.2; GT-I9105P Build/JDQ39)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-G900F Build/LRX21T)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; GT-I9192 Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-G531H Build/LMY48B)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-N9005 Build/LRX21V)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; LGMS345 Build/LMY47V)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0.2; HTC One Build/LRX22G)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0.2; LG-D800 Build/LRX22G)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-G531H Build/LMY48B)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-N9005 Build/LRX21V)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; SM-T113 Build/KTU84P)",
  "Dalvik/1.6.0 (Linux; U; Android 4.2.2; AndyWin Build/JDQ39E)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; Lenovo A7000-a Build/LRX21M)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; LGL16C Build/KOT49I.L16CV11a)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; GT-I9500 Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0.2; SM-A700FD Build/LRX22G)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SM-G130HN Build/KOT49H)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SM-N9005 Build/KOT49H)",
  "Dalvik/1.6.0 (Linux; U; Android 4.1.2; LG-E975T Build/JZO54K)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; E1 Build/KOT49H)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; GT-I9500 Build/KOT49H)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; GT-N5100 Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-A310F Build/LMY47X)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-J105H Build/LMY47V)",
  "Dalvik/1.6.0 (Linux; U; Android 4.3; GT-I9305T Build/JSS15J)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; android Build/JDQ39)",
  "Dalvik/1.6.0 (Linux; U; Android 4.2.1; HS-U970 Build/JOP40D)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; SM-T561 Build/KTU84P)",
  "Dalvik/1.6.0 (Linux; U; Android 4.2.2; GT-P3110 Build/JDQ39)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G925T Build/MMB29K)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; HUAWEI Y221-U22 Build/HUAWEIY221-U22)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-G530T1 Build/LMY47X)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-G920I Build/LMY47X)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-G900F Build/LRX21T)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; Vodafone Smart ultra 6 Build/LMY47V)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; XT1080 Build/SU6-7.7)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; ASUS MeMO Pad 7 Build/KTU84P)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SM-G800F Build/KOT49H)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; GT-N7100 Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G925I Build/MMB29K)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; A0001 Build/MMB29X)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1; XT1045 Build/LPB23.13-61)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; LGMS330 Build/LMY47V)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; Z970 Build/KTU84P)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-N900P Build/LRX21V)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; T1-701u Build/HuaweiMediaPad)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1; HTCD100LVWPP Build/LMY47O)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G935R4 Build/MMB29M)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G930V Build/MMB29M)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0.2; ZTE Blade Q Lux Build/LRX22G)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; GT-I9060I Build/KTU84P)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; LGUS992 Build/MMB29M)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G900P Build/MMB29M)",
  "Dalvik/1.6.0 (Linux; U; Android 4.1.2; SGH-T999L Build/JZO54K)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-N910V Build/LMY47X)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; GT-I9500 Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-P601 Build/LMY47X)",
  "Dalvik/1.6.0 (Linux; U; Android 4.2.2; GT-S7272 Build/JDQ39)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-N910T Build/LMY47X)",
  "Dalvik/1.6.0 (Linux; U; Android 4.3; SAMSUNG-SGH-I747 Build/JSS15J)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0.2; ZTE Blade Q Lux Build/LRX22G)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G930F Build/MMB29K)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; HTC_PO582 Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0; HUAWEI MT7-TL10 Build/HuaweiMT7-TL10)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0; LG-H811 Build/MRA58K)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; SM-N7505 Build/KOT49H)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0; LG-H815 Build/MRA58K)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.2; LenovoA3300-HV Build/KOT49H)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; SM-G360G Build/KTU84P)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; GT-I9300I Build/KTU84P)",
  "Dalvik/2.1.0 (Linux; U; Android 5.0; SM-G900F Build/LRX21T)",
  "Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-J700T Build/MMB29K)",
  "Dalvik/2.1.0 (Linux; U; Android 5.1.1; SM-J500FN Build/LMY48B)",
  "Dalvik/1.6.0 (Linux; U; Android 4.2.2; SM-T217S Build/JDQ39)",
  "Dalvik/1.6.0 (Linux; U; Android 4.4.4; SAMSUNG-SM-N900A Build/KTU84P)",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 3_2 like Mac OS X; en-us) AppleWebKit/531.21.10 (KHTML, like Gecko) Version/4.0.4 Mobile/7B367 Safari/531.21.10",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; es-es) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; es-es) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-gb) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8F190 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8F191 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_4 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8K2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3 like Mac OS X; ja-jp) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8F190 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_8 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8E401 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5302b",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8F190",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5302b Safari/7534.48.3",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; ko-kr) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8H7 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_1 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8G4",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J3 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; es-es) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2 Twitter for iPad",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J3 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8F190 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_2 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7D11 Safari/528.16",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Mobile/7E18",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; es-es) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_4 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8K2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_1 like Mac OS X; en-us) AppleWebKit/532.9 (KHTML, like Gecko) Version/4.0.5 Mobile/8B117 Safari/6531.22.7",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148a Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; nl-nl) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_0_1 like Mac OS X; fr-fr) AppleWebKit/532.9 (KHTML, like Gecko) Version/4.0.5 Mobile/8A306 Safari/6531.22.7",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 3_2 like Mac OS X; en-us) AppleWebKit/531.21.10 (KHTML, like Gecko) Version/4.0.4 Mobile/7B367 Safari/531.21.10",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8F190 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148a Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; ko-kr) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2 Twitter for iPad",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8F191",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; fr-fr) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_4 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8K2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8H7",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_6 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8E200",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2 Twitter for iPad",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8F191",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8H7",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8H7",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; nl-nl) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8F190 Twitter for iPad",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_0 like Mac OS X; en-us) AppleWebKit/532.9 (KHTML, like Gecko) Version/4.0.5 Mobile/8A293 Safari/6531.22.7",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; sv-se) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148a",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8H7",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_0_1 like Mac OS X; en-us) AppleWebKit/532.9 (KHTML, like Gecko) Mobile/8A306",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; fi-fi) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; fr-fr) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; zh-cn) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J3 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_1 like Mac OS X; zh-cn) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_1 like Mac OS X; zh-cn) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_1 like Mac OS X; zh-cn) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J3 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_1 like Mac OS X; zh-cn) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; zh-cn) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; zh-cn) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; ko-kr) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_1 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8F190",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A334 Safari/7534.48.3",
  "Mozilla/5.0 (iPod; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 3_2 like Mac OS X; en-us) AppleWebKit/531.21.10 (KHTML, like Gecko) Version/4.0.4 Mobile/7B367 Safari/531.21.10",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_0_1 like Mac OS X; en-us) AppleWebKit/532.9 (KHTML, like Gecko) Mobile/8A306",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_10 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8E600 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_0_1 like Mac OS X; en-us) AppleWebKit/532.9 (KHTML, like Gecko) Mobile/8A306",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; nb-no) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS_3_2_2 like Mac OS X; en-us) AppleWebKit/531.21.10 (KHTML, like Gecko) Version/4.0.4 Mobile/7B500 Safari/531.21.10",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPad; CPU OS 4_3 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/8F190 Safari/7534.48.3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_4 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8K2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_10 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8E600 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148 Twitter for iPad",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; es-es) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; fr-fr) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; fr-fr) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J3 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e Twitter for iPad",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; sv-se) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; nb-no) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_1 like Mac OS X; en-gb) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8G4",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-gb) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; es-es) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8H7 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_1 like Mac OS X; en-us) AppleWebKit/532.9 (KHTML, like Gecko) Version/4.0.5 Mobile/8B117 Safari/6531.22.7",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; de-de) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_1 like Mac OS X; pl-pl) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8G4",
  "Mozilla/5.0 (iPad; U; CPU OS 3_2 like Mac OS X; en-us) AppleWebKit/531.21.10 (KHTML, like Gecko) Version/4.0.4 Mobile/7B367 Safari/531.21.10",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Version/5.1 Mobile/9A5313e Safari/7534.48.3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; nb-no) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; CPU OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-gb) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_2 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8H7",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_2 like Mac OS X; nl-nl) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8H7",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8C148",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 3_1_3 like Mac OS X; en-us) AppleWebKit/528.18 (KHTML, like Gecko) Version/4.0 Mobile/7E18 Safari/528.16",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-gb) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8G4",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_8 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8E401",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; zh-cn) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; zh-cn) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPad",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_4 like Mac OS X; ja-jp) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8K2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 5_0 like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/9A5313e",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2 Twitter for iPhone",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8G4 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 3_2_1 like Mac OS X; en-us) AppleWebKit/531.21.10 (KHTML, like Gecko) Version/4.0.4 Mobile/7B405 Safari/531.21.10",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J2 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2 Twitter for iPhone",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J3",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8L1 Safari/6533.18.5",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8J3 Safari/6533.18.5",
  "Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_3_5 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8L1",
  "Mozilla/5.0 (iPad; U; CPU OS 4_3_3 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Mobile/8J2"
];

// node_modules/node-shazam/dist/esm/requests.js
class ShazamURLS {
  search_from_file(language, endpoint_country, device, uuid_1, uuid_2) {
    return `https://amp.shazam.com/discovery/v5/${language}/${endpoint_country}/${device}/-/tag/${uuid_1}/${uuid_2}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3`;
  }
  static top_tracks_global(language, endpoint_country, limit, offset) {
    return `https://www.shazam.com/shazam/v3/${language}/${endpoint_country}/web/-/tracks/ip-global-chart?pageSize=${limit}&startFrom=${offset}`;
  }
  static track_info(language, endpoint_country, track_id) {
    return `https://www.shazam.com/discovery/v5/${language}/${endpoint_country}/web/-/track/${track_id}?shazamapiversion=v3&video=v3 `;
  }
  static top_tracks_country(language, endpoint_country, country_code, limit, offset) {
    return `https://www.shazam.com/shazam/v3/${language}/${endpoint_country}/web/-/tracks/ip-country-chart-${country_code}?pageSize=${limit}&startFrom=${offset}`;
  }
  static top_tracks_city(language, endpoint_country, city_id, limit, offset) {
    return `https://www.shazam.com/shazam/v3/${language}/${endpoint_country}/web/-/tracks/ip-city-chart-${city_id}?pageSize=${limit}&startFrom=${offset}`;
  }
  static locations() {
    return "https://www.shazam.com/services/charts/locations";
  }
  static genre_world(language, endpoint_country, genre, limit, offset) {
    return `https://www.shazam.com/shazam/v3/${language}/${endpoint_country}/web/-/tracks/genre-global-chart-${genre}?pageSize=${limit}&startFrom=${offset}`;
  }
  static genre_country(language, endpoint_country, country, genre, limit, offset) {
    return `https://www.shazam.com/shazam/v3/${language}/${endpoint_country}/web/-/tracks/genre-country-chart-${country}-${genre}?pageSize=${limit}&startFrom=${offset}`;
  }
  static related_songs(language, endpoint_country, track_id, offset, limit) {
    return `https://cdn.shazam.com/shazam/v3/${language}/${endpoint_country}/web/-/tracks/track-similarities-id-${track_id}?startFrom=${offset}&pageSize=${limit}&connected=&channel=`;
  }
  static search_artist(language, endpoint_country, query, limit, offset) {
    return `https://www.shazam.com/services/search/v4/${language}/${endpoint_country}/web/search?term=${query}&limit=${limit}&offset=${offset}&types=artists`;
  }
  static search_music(language, endpoint_country, query, limit, offset) {
    return `https://www.shazam.com/services/search/v3/${language}/${endpoint_country}/web/search?query=${query}&numResults=${limit}&offset=${offset}&types=songs`;
  }
  static listening_counter(track) {
    return `https://www.shazam.com/services/count/v2/web/track/${track}`;
  }
  static listening_counter_many() {
    return "https://www.shazam.com/services/count/v2/web/track";
  }
  static search_artist_v2(endpoint_country, artist_id) {
    return `https://www.shazam.com/services/amapi/v1/catalog/${endpoint_country}/artists/${artist_id}`;
  }
  static artist_albums(endpoint_country, artist_id, limit, offset) {
    return `https://www.shazam.com/services/amapi/v1/catalog/${endpoint_country}/artists/${artist_id}/albums?limit=${limit}&offset=${offset}`;
  }
}

class Request2 {
  static headers(language = "en") {
    return {
      "X-Shazam-Platform": "IPHONE",
      "X-Shazam-AppVersion": "14.1.0",
      Accept: "*/*",
      "Content-Type": "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": language,
      "User-Agent": `${USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]}`
    };
  }
}

// stub:to_pcm
async function convertfile() {
  throw new Error("file conversion stubbed out — feed PCM");
}
async function tomp3() {
  throw new Error("file conversion stubbed out — feed PCM");
}

// node_modules/node-shazam/dist/esm/api.js
var TIME_ZONE = "Europe/Paris";
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c == "x" ? r : r & 3 | 8;
    return v.toString(16);
  }).toUpperCase();
}

class Endpoint {
  constructor(timezone) {
    this.timezone = timezone;
  }
  url() {
    return `${Endpoint.SCHEME}://${Endpoint.HOSTNAME}/discovery/v5/en/US/iphone/-/tag/${uuidv4()}/${uuidv4()}`;
  }
  params() {
    return {
      sync: "true",
      webv3: "true",
      sampling: "true",
      connected: "",
      shazamapiversion: "v3",
      sharehub: "true",
      hubv5minorversion: "v5.1",
      hidelb: "true",
      video: "v3"
    };
  }
  headers(language = "en") {
    return Request2.headers(language);
  }
  async sendRecognizeRequest(url, body, language = "en") {
    return await (await node_fetch_default(url, { body, headers: this.headers(language), method: "POST" })).json();
  }
  async formatAndSendRecognizeRequest(signature, language = "en") {
    const data = {
      timezone: this.timezone,
      signature: {
        uri: signature.encodeToUri(),
        samplems: Math.round(signature.numberSamples / signature.sampleRateHz * 1000)
      },
      timestamp: new Date().getTime(),
      context: {},
      geolocation: {}
    };
    const url = new URL(this.url());
    Object.entries(this.params()).forEach(([a, b]) => url.searchParams.append(a, b));
    const response = await this.sendRecognizeRequest(url.toString(), JSON.stringify(data), language);
    if (response?.matches.length === 0)
      return null;
    return response;
  }
}
Endpoint.SCHEME = "https";
Endpoint.HOSTNAME = "amp.shazam.com";

class Shazam {
  constructor(timeZone) {
    this.endpoint = new Endpoint(timeZone ?? TIME_ZONE);
  }
  headers(language = "en") {
    return Request2.headers(language);
  }
  async fromFilePath(path, minimal = false, language = "en") {
    await convertfile(path);
    const data = fs.readFileSync("node_shazam_temp.pcm");
    const conv = s16LEToSamplesArray(data);
    fs.unlinkSync("node_shazam_temp.pcm");
    const recognise = minimal ? await this.recognizeSongMinimal(conv, language) : await this.recognizeSong(conv, language);
    return recognise;
  }
  async fromVideoFile(path, minimal = false, language = "en") {
    await tomp3(path);
    const res = await this.fromFilePath("node_shazam_temp.mp3", minimal, language);
    fs.unlinkSync("node_shazam_temp.mp3");
    return res;
  }
  async recognizeSong(samples, language = "en", callback) {
    const response = await this.fullRecognizeSong(samples, callback, language);
    if (!response)
      return null;
    return response;
  }
  async recognizeSongMinimal(samples, language = "en", callback) {
    const response = await this.fullRecognizeSong(samples, callback, language);
    if (!response)
      return null;
    const trackData = response.track, mainSection = trackData.sections.find((e) => e.type === "SONG");
    const { title, subtitle: artist } = trackData, album = mainSection.metadata.find((e) => e.title === "Album")?.text, year = mainSection.metadata.find((e) => e.title === "Released")?.text;
    return { title, artist, album, year };
  }
  async fullRecognizeSong(samples, callback, language = "en") {
    callback?.("generating");
    const generator = this.createSignatureGenerator(samples);
    while (true) {
      callback?.("generating");
      const signature = generator.getNextSignature();
      if (!signature) {
        break;
      }
      callback?.("transmitting");
      const results = await this.endpoint.formatAndSendRecognizeRequest(signature, language);
      if (results !== null)
        return results;
    }
    return null;
  }
  async recognise(path, language = "en-US", minimal = false) {
    const signatures = recognizeBytes(readFileSync(path), 0, Number.MAX_SAFE_INTEGER);
    let response;
    for (let i = Math.floor(signatures.length / 2);i < signatures.length; i += 4) {
      const data = {
        timezone: this.endpoint.timezone,
        signature: {
          uri: signatures[i].uri,
          samplems: signatures[i].samplems
        },
        timestamp: new Date().getTime(),
        context: {},
        geolocation: {}
      };
      const url = new URL(this.endpoint.url());
      Object.entries(this.endpoint.params()).forEach(([a, b]) => url.searchParams.append(a, b));
      response = await this.endpoint.sendRecognizeRequest(url.toString(), JSON.stringify(data), language);
      if (response?.matches.length === 0)
        continue;
      break;
    }
    for (const sig of signatures)
      sig.free();
    if (!response)
      return null;
    if (response?.matches.length === 0)
      return null;
    if (minimal) {
      const trackData = response.track, mainSection = trackData.sections.find((e) => e.type === "SONG");
      const { title, subtitle: artist } = trackData, album = mainSection.metadata.find((e) => e.title === "Album")?.text, year = mainSection.metadata.find((e) => e.title === "Released")?.text;
      return { title, artist, album, year };
    }
    return response;
  }
  createSignatureGenerator(samples) {
    const signatureGenerator = new SignatureGenerator;
    signatureGenerator.feedInput(samples);
    return signatureGenerator;
  }
  async top_tracks_global(language = "en-US", endpoint_country = "GB", limit = "10", offset = "0") {
    const url = ShazamURLS.top_tracks_global(language, endpoint_country, limit, offset);
    return await (await node_fetch_default(url, { headers: this.headers(language), method: "GET" })).json();
  }
  async top_tracks_country(language, endpoint_country, country_code, limit, offset) {
    const url = ShazamURLS.top_tracks_country(language, endpoint_country, country_code, limit, offset);
    return await (await node_fetch_default(url, { headers: this.headers(language), method: "GET" })).json();
  }
  async top_tracks_city(language, endpoint_country, city_id, limit, offset) {
    const url = ShazamURLS.top_tracks_city(language, endpoint_country, city_id, limit, offset);
    return await (await node_fetch_default(url, { headers: this.headers(language), method: "GET" })).json();
  }
  async track_info(language, endpoint_country, track_id) {
    const url = ShazamURLS.track_info(language, endpoint_country, track_id);
    return await (await node_fetch_default(url, { headers: this.headers(language), method: "GET" })).json();
  }
  async list_locations() {
    const url = ShazamURLS.locations();
    return await (await node_fetch_default(url, { headers: this.headers(), method: "GET" })).json();
  }
  async top_genre_tracks_world(language, endpoint_country, genre, limit, offset) {
    const url = ShazamURLS.genre_world(language, endpoint_country, genre, limit, offset);
    return await (await node_fetch_default(url, { headers: this.headers(language), method: "GET" })).json();
  }
  async top_genre_tracks_country(language, endpoint_country, country, genre, limit, offset) {
    const url = ShazamURLS.genre_country(language, endpoint_country, country, genre, limit, offset);
    return await (await node_fetch_default(url, { headers: this.headers(language), method: "GET" })).json();
  }
  async related_songs(language, endpoint_country, track_id, offset, limit) {
    const url = ShazamURLS.related_songs(language, endpoint_country, track_id, offset, limit);
    return await (await node_fetch_default(url, { headers: this.headers(language), method: "GET" })).json();
  }
  async search_artist(language, endpoint_country, query, limit, offset) {
    const url = ShazamURLS.search_artist(language, endpoint_country, query, limit, offset);
    return await (await node_fetch_default(url, { headers: this.headers(language), method: "GET" })).json();
  }
  async search_artist_v2(endpoint_country, artist_id) {
    const url = ShazamURLS.search_artist_v2(endpoint_country, artist_id);
    return await (await node_fetch_default(url, { headers: this.headers(), method: "GET" })).json();
  }
  async artist_albums(endpoint_country, artist_id, limit, offset) {
    const url = ShazamURLS.artist_albums(endpoint_country, artist_id, limit, offset);
    return await (await node_fetch_default(url, { headers: this.headers(), method: "GET" })).json();
  }
  async search_music(language, endpoint_country, query, limit, offset) {
    const url = ShazamURLS.search_music(language, endpoint_country, query, limit, offset);
    return await (await node_fetch_default(url, { headers: this.headers(language), method: "GET" })).json();
  }
  async listen_count(track) {
    const url = ShazamURLS.listening_counter(track);
    return await (await node_fetch_default(url, { headers: this.headers(), method: "GET" })).json();
  }
}
Shazam.MAX_TIME_SCEONDS = 8;
// recognition/song-id/resample.ts
function resampleInt16(samples, fromRate, toRate) {
  if (fromRate === toRate)
    return samples;
  const outLength = Math.floor(samples.length * toRate / fromRate);
  const out = new Int16Array(outLength);
  const ratio = fromRate / toRate;
  for (let i = 0;i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(samples[i0] * (1 - frac) + samples[i1] * frac);
  }
  return out;
}

// recognition/song-id/shazam.ts
var SHAZAM_RATE = 16000;

class ShazamProvider {
  name = "shazam";
  shazam = new Shazam;
  async identify(clip) {
    const pcm = resampleInt16(clip.samples, clip.sampleRate, SHAZAM_RATE);
    const result = await this.shazam.fullRecognizeSong(Array.from(pcm));
    if (!result || !result.track)
      return null;
    const track = result.track;
    const sections = track.sections ?? [];
    const metadata = sections.find((s) => Array.isArray(s.metadata))?.metadata ?? [];
    const meta = (label) => metadata.find((m) => m.title?.toLowerCase() === label)?.text;
    const lyricSection = sections.find((s) => s.type?.toUpperCase() === "LYRICS" && Array.isArray(s.text) && s.text.length > 0);
    const artworkUrls = [track.images?.coverarthq, track.images?.coverart, track.images?.background].filter((u) => typeof u === "string" && u.length > 0);
    return {
      provider: this.name,
      providerTrackId: track.key,
      title: track.title,
      artist: track.subtitle,
      album: meta("album"),
      releaseYear: meta("released"),
      isrc: track.isrc,
      matchOffsetSec: result.matches?.[0]?.offset,
      artworkUrls: [...new Set(artworkUrls)],
      embeddedLyrics: lyricSection?.text,
      raw: result
    };
  }
}

// recognition/artwork/index.ts
async function resolveArtwork(query, options = {}) {
  const f2 = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? "Vizzy/1.0 (personal audio visualizer)";
  for (const url of query.preferredUrls ?? []) {
    if (await urlResolves(f2, url))
      return { url, source: "provider", album: query.album };
  }
  const fromItunes = await itunes(f2, query).catch(() => null);
  if (fromItunes)
    return fromItunes;
  const fromDeezer = await deezer(f2, query).catch(() => null);
  if (fromDeezer)
    return fromDeezer;
  return coverArtArchive(f2, userAgent, query).catch(() => null);
}
async function urlResolves(f2, url) {
  try {
    const res = await f2(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}
async function itunes(f2, q) {
  const params = new URLSearchParams({
    term: `${q.artist} ${q.title}`,
    media: "music",
    entity: "song",
    limit: "5"
  });
  const res = await f2(`https://itunes.apple.com/search?${params}`);
  if (!res.ok)
    return null;
  const data = await res.json();
  const hits = data.results ?? [];
  const best = q.album && hits.find((h) => h.collectionName?.toLowerCase().includes(q.album.toLowerCase())) || hits.find((h) => h.artworkUrl100);
  if (!best?.artworkUrl100)
    return null;
  return {
    url: best.artworkUrl100.replace("100x100bb", "1000x1000bb"),
    source: "itunes",
    album: best.collectionName
  };
}
async function deezer(f2, q) {
  const term = `artist:"${q.artist}" track:"${q.title}"`;
  const res = await f2(`https://api.deezer.com/search?q=${encodeURIComponent(term)}`);
  if (!res.ok)
    return null;
  const data = await res.json();
  const hit = data.data?.find((d) => d.album?.cover_xl);
  if (!hit?.album?.cover_xl)
    return null;
  return { url: hit.album.cover_xl, source: "deezer", album: hit.album.title };
}
async function coverArtArchive(f2, userAgent, q) {
  const luceneEscape = (s) => s.replace(/([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1");
  const query = [
    `recording:"${luceneEscape(q.title)}"`,
    `artist:"${luceneEscape(q.artist)}"`,
    q.album ? `release:"${luceneEscape(q.album)}"` : ""
  ].filter(Boolean).join(" AND ");
  const res = await f2(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=3`, { headers: { "User-Agent": userAgent } });
  if (!res.ok)
    return null;
  const data = await res.json();
  for (const recording of data.recordings ?? []) {
    for (const release of recording.releases ?? []) {
      const url = `https://coverartarchive.org/release/${release.id}/front-1200`;
      if (await urlResolves(f2, url)) {
        return { url, source: "coverartarchive", album: release.title };
      }
    }
  }
  return null;
}

// recognition/lyrics/lrc.ts
var TIME_TAG = /\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
var META_TAG = /^\[([a-zA-Z#]+):(.*)\]$/;
function parseLrc(text) {
  const lines = [];
  let offsetMs = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line)
      continue;
    const meta = line.match(META_TAG);
    if (meta && !/^\d/.test(meta[1])) {
      if (meta[1].toLowerCase() === "offset")
        offsetMs = parseInt(meta[2], 10) || 0;
      continue;
    }
    TIME_TAG.lastIndex = 0;
    const stamps = [];
    let m;
    let lastEnd = 0;
    while ((m = TIME_TAG.exec(line)) !== null) {
      if (m.index !== lastEnd)
        break;
      const minutes = parseInt(m[1], 10);
      const seconds = parseFloat(m[2].replace(":", "."));
      stamps.push(minutes * 60 + seconds);
      lastEnd = TIME_TAG.lastIndex;
    }
    if (stamps.length === 0)
      continue;
    const textPart = line.slice(lastEnd).trim();
    for (const t of stamps) {
      lines.push({ timeSec: Math.max(0, t - offsetMs / 1000), text: textPart });
    }
  }
  return lines.sort((a, b) => a.timeSec - b.timeSec);
}

// recognition/lyrics/lrclib.ts
var BASE = "https://lrclib.net/api";
function normalizeTitle(title) {
  return title.replace(/\s*[([](feat\.?|ft\.?|with|remaster(ed)?|mono|stereo|single|album|radio|live|bonus|deluxe|explicit)[^)\]]*[)\]]/gi, "").replace(/\s*-\s*(feat\.?|ft\.?|remaster(ed)?|single version|radio edit|live|mono|stereo)\b.*$/i, "").replace(/\s{2,}/g, " ").trim();
}

class LrclibProvider {
  name = "lrclib";
  userAgent;
  fetchImpl;
  constructor(options = {}) {
    this.userAgent = options.userAgent ?? "Vizzy/1.0 (personal audio visualizer)";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  async getLyrics(query) {
    const cleanTitle = normalizeTitle(query.title) || query.title;
    const record = (query.durationSec ? await this.getExact({ ...query, title: cleanTitle }) : null) ?? await this.search({ ...query, title: cleanTitle });
    if (!record)
      return null;
    const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : undefined;
    return {
      source: this.name,
      synced: synced?.length ? synced : undefined,
      plain: record.plainLyrics ?? undefined,
      trackDurationSec: record.duration,
      instrumental: record.instrumental ?? false
    };
  }
  async getExact(query) {
    const params = new URLSearchParams({
      artist_name: query.artist,
      track_name: query.title,
      duration: String(Math.round(query.durationSec))
    });
    if (query.album)
      params.set("album_name", query.album);
    const res = await this.request(`${BASE}/get?${params}`);
    if (!res)
      return null;
    return await res.json();
  }
  async search(query) {
    const params = new URLSearchParams({
      artist_name: query.artist,
      track_name: query.title
    });
    const res = await this.request(`${BASE}/search?${params}`);
    if (!res)
      return null;
    const hits = await res.json();
    if (!Array.isArray(hits) || !hits.length)
      return null;
    const scored = hits.map((h) => {
      let score = 0;
      if (h.syncedLyrics)
        score += 10;
      else if (h.plainLyrics)
        score += 3;
      if (query.durationSec && h.duration) {
        const drift = Math.abs(h.duration - query.durationSec);
        score += drift <= 2 ? 5 : drift <= 10 ? 1 : -5;
      }
      return { h, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0].score > 0 ? scored[0].h : null;
  }
  async request(url, attempt = 0) {
    const res = await this.fetchImpl(url, { headers: { "User-Agent": this.userAgent } });
    if (res.status === 404)
      return null;
    if (res.status === 503 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 700));
      return this.request(url, 1);
    }
    if (!res.ok)
      throw new Error(`lrclib ${res.status} for ${url}`);
    return res;
  }
}

// recognition/service.ts
var USER_AGENT = "Vizzy/1.0 (personal audio visualizer appliance)";
var songId = new ShazamProvider;
var lyricsProvider = new LrclibProvider({ userAgent: USER_AGENT });
var ART_DEADLINE_MS = 4000;
var LYRICS_DEADLINE_MS = 6000;
var deadline = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
var enrichCache = new Map;
var CACHE_MAX = 40;
async function enrich(match) {
  const key = match.providerTrackId ?? `${match.artist}::${match.title}`;
  const hit = enrichCache.get(key);
  if (hit && hit.artwork && hit.lyrics)
    return { ...hit, fromCache: true };
  const [artwork, lyrics] = await Promise.all([
    hit?.artwork ? Promise.resolve(hit.artwork) : deadline(resolveArtwork({
      artist: match.artist,
      title: match.title,
      album: match.album,
      preferredUrls: match.artworkUrls
    }, { userAgent: USER_AGENT }), ART_DEADLINE_MS).catch(() => null),
    hit?.lyrics ? Promise.resolve(hit.lyrics) : deadline(lyricsProvider.getLyrics({ artist: match.artist, title: match.title, album: match.album }), LYRICS_DEADLINE_MS).catch(() => null)
  ]);
  const finalLyrics = lyrics ?? (match.embeddedLyrics?.length ? { source: "shazam", plain: match.embeddedLyrics.join(`
`) } : null);
  enrichCache.set(key, { artwork, lyrics: finalLyrics });
  if (enrichCache.size > CACHE_MAX) {
    const oldest = enrichCache.keys().next().value;
    if (oldest !== undefined)
      enrichCache.delete(oldest);
  }
  return { artwork, lyrics: finalLyrics, fromCache: false };
}
async function identifyAndEnrich(pcm, sampleRate, capturedAtMs = Date.now()) {
  const samples = pcm instanceof Int16Array ? pcm : new Int16Array(pcm);
  const clip = { samples, sampleRate, capturedAtMs };
  const t0 = Date.now();
  const match = await songId.identify(clip);
  const identifyMs = Date.now() - t0;
  if (!match) {
    return { match: null, artwork: null, lyrics: null, timingMs: { identify: identifyMs, enrich: 0 } };
  }
  const t1 = Date.now();
  const { artwork, lyrics, fromCache } = await enrich(match);
  const { raw, embeddedLyrics, ...cleanMatch } = match;
  return {
    match: cleanMatch,
    artwork,
    lyrics,
    timingMs: { identify: identifyMs, enrich: Date.now() - t1 },
    cached: fromCache
  };
}
async function mockNowPlaying() {
  const mockMatch = {
    provider: "mock",
    providerTrackId: "mock-bohemian-rhapsody",
    title: "Bohemian Rhapsody",
    artist: "Queen",
    album: "A Night at the Opera",
    releaseYear: "1975",
    matchOffsetSec: 45,
    artworkUrls: []
  };
  const t0 = Date.now();
  const { artwork, lyrics } = await enrich(mockMatch);
  const { raw, embeddedLyrics, ...cleanMatch } = mockMatch;
  return {
    match: cleanMatch,
    artwork,
    lyrics,
    timingMs: { identify: 0, enrich: Date.now() - t0 }
  };
}
var ART_HOSTS = [
  "mzstatic.com",
  "dzcdn.net",
  "coverartarchive.org",
  "archive.org",
  "shazam.com"
];
function isAllowedArtUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:")
      return false;
    return ART_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}
export {
  mockNowPlaying,
  isAllowedArtUrl,
  identifyAndEnrich
};
