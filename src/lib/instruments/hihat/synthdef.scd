SynthDef(\poly_hihat, { |out=0, brightness=7000, decay=0.075, amp=0.2, pan=0|
    var envelope = EnvGen.kr(Env.perc(0.001, decay, 1, -7), doneAction: 2);
    var signal = HPF.ar(WhiteNoise.ar, brightness) * envelope * amp;
    Out.ar(out, Pan2.ar(signal, pan));
}).writeDefFile(~outputDir);
