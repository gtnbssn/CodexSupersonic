SynthDef(\poly_snare, { |out=0, tone=185, noise=0.65, decay=0.18, amp=0.35, pan=0|
    var envelope = EnvGen.kr(Env.perc(0.001, decay, 1, -5), doneAction: 2);
    var shell = SinOsc.ar(tone) * (1 - noise);
    var rattle = HPF.ar(WhiteNoise.ar, 1500) * noise;
    Out.ar(out, Pan2.ar((shell + rattle) * envelope * amp, pan));
}).writeDefFile(~outputDir);
