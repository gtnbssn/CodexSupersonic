SynthDef(\poly_bass, { |out=0, freq=65.4, cutoff=850, resonance=0.5, sustain=0.16, release=0.25, amp=0.3, pan=0|
    var envelope = EnvGen.kr(Env.linen(0.005, sustain, release, 1, -4), doneAction: 2);
    var signal = RLPF.ar(Saw.ar(freq) * 0.5, cutoff, 1 - (resonance * 0.85));
    Out.ar(out, Pan2.ar(signal * envelope * amp, pan));
}).writeDefFile(~outputDir);
