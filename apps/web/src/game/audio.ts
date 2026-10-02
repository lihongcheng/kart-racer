export class RaceAudio {
  context?: AudioContext;
  master?: GainNode;
  engine?: OscillatorNode;
  engineGain?: GainNode;
  skid?: OscillatorNode;
  skidGain?: GainNode;
  enabled = true;
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain(); this.master.gain.value = 0.16;
      this.master.connect(this.context.destination);
      this.engine = this.context.createOscillator(); this.engine.type = 'sawtooth';
      this.engineGain = this.context.createGain(); this.engineGain.gain.value = 0;
      const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 500;
      this.engine.connect(filter); filter.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
      this.skid = this.context.createOscillator(); this.skid.type = 'triangle'; this.skid.frequency.value = 570;
      this.skidGain = this.context.createGain(); this.skidGain.gain.value = 0;
      this.skid.connect(this.skidGain); this.skidGain.connect(this.master); this.skid.start();
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }
  update(speed: number, drift: boolean, boost: boolean, running: boolean) {
    if (!this.context || !this.engine || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.enabled ? 0.16 : 0, now, 0.08);
    this.engine.frequency.setTargetAtTime(45 + Math.abs(speed) * 4 + (boost ? 35 : 0), now, 0.08);
    this.engineGain!.gain.setTargetAtTime(running ? 0.2 : 0, now, 0.1);
    this.skidGain!.gain.setTargetAtTime(running && drift ? 0.07 : 0, now, 0.05);
  }
  beep(frequency = 600, duration = 0.12) {
    if (!this.context || !this.master || !this.enabled) return;
    const osc = this.context.createOscillator(), gain = this.context.createGain();
    osc.frequency.value = frequency; gain.gain.value = 0.3;
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(); osc.stop(this.context.currentTime + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  dispose() { void this.context?.close(); }
}
