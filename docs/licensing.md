# Licensing and distribution

Confluence's original application code and instrument definitions are licensed under **AGPL-3.0-or-later**. The complete license is in the root `LICENSE`.

SuperSonic is alpha software. This application pins `supersonic-scsynth` and `supersonic-scsynth-core` to **0.96.0** and pins all direct tooling versions. `package-lock.json` fixes the transitive dependency tree and registry integrity hashes. Upgrade the matching engine packages together, rebuild runtime assets, and rerun actual audio tests.

SuperSonic combines SuperCollider's scsynth (GPL-3.0-or-later) with Clockwork (AGPL-3.0-or-later). Its published client and core packages identify AGPL-3.0-or-later for the combined engine. Some client source files have alternative permissive licensing; those individual notices do not make the combined engine permissively licensed. This application does not depend on the optional bundled synthdefs or sample packages; its four compiled SynthDefs come from the included source.

When sharing builds, retain copyright and license notices, provide the applicable license text, and make Corresponding Source available under the required terms. When users interact with a modified AGPL program over a network, provide the source access required by AGPL section 13. Include application source, modifications, relevant build/installation scripts, dependency versions, and the source/material needed to reproduce the combined work. A link to an upstream README alone is not a substitute for the source obligations of your distributed version. Assess your specific deployment and other dependencies before release.

`npm run assets:sync` copies the upstream `LICENSE` and `COPYING` notices beside the self-hosted client and core assets. The core package metadata declares AGPL-3.0-or-later while its legacy LICENSE notice describes GPL-3.0-or-later. Both notices are retained, together with the full GPL-3.0 text in `docs/licenses/GPL-3.0.txt`; the combined-engine AGPL obligations still apply. Their package notices describe the component licenses; retain them when deploying. Dependency copyright notices remain with their packages. The root license covers this application's original work and does not replace third-party notices.

Official references verified for this implementation:

- <https://github.com/samaaron/supersonic> (README licensing section)
- <https://github.com/samaaron/supersonic/blob/main/LICENSE>
- <https://github.com/samaaron/supersonic/blob/main/docs/INSTALLATION_WEB.md>
- <https://github.com/samaaron/supersonic/blob/main/docs/API.md>

The API inspection used upstream revision `721caa0a96ff85edbdd7c27a012b5f1879104ecd`; installed runtime code is the published npm 0.96.0 release, not an unpinned Git checkout.
