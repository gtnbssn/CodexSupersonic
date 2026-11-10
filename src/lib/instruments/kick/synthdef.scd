// Self-contained; EnvGen frees the node after its tail.
SynthDef(\poly_kick, { |out=0, pitch=52, decay=0.38, drive=1.8, amp=0.5, pan=0|
    var envelope = EnvGen.kr(Env.perc(0.002, decay, 1, -6), doneAction: 2);
    var bend = EnvGen.kr(Env([pitch * 3.8, pitch], [0.035], -7));
    var signal = (SinOsc.ar(bend) * drive).tanh * envelope * amp;
    Out.ar(out, Pan2.ar(signal, pan));
}).writeDefFile(~outputDir);
