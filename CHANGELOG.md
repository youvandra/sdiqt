# Changelog

## 0.1.0 (2026-11-27)


### Features

* archive rollup history and build prover inputs from it ([#22](https://github.com/youvandra/sdiqt/issues/22)) ([3929e74](https://github.com/youvandra/sdiqt/commit/3929e74c98a63da303da2bcaef7d37e984f418da))
* **chain:** add retrying REST, simulate-first transactions and a daily spend cap ([#21](https://github.com/youvandra/sdiqt/issues/21)) ([ae833a8](https://github.com/youvandra/sdiqt/commit/ae833a8a2026eb50eba5f16e5df1f63f9fbea9a7))
* check every qledger-v1 rollup and show them in the explorer ([#56](https://github.com/youvandra/sdiqt/issues/56)) ([b0deef1](https://github.com/youvandra/sdiqt/commit/b0deef1725ff9b84ab76ed12f04b9d93c87a7af3))
* **deploy:** run the watchtower on the host from a single bundle ([#42](https://github.com/youvandra/sdiqt/issues/42)) ([77bb8ac](https://github.com/youvandra/sdiqt/commit/77bb8acd59377d3ea3707fd54e02f78619111591))
* **deploy:** serve the explorer on sdiqt.xyz with link previews ([#44](https://github.com/youvandra/sdiqt/issues/44)) ([3a8a666](https://github.com/youvandra/sdiqt/commit/3a8a666e907ebdb03e96d98efc9a39d39fc8d184))
* **deploy:** take exit packets on sdiqt.xyz ([#48](https://github.com/youvandra/sdiqt/issues/48)) ([0859722](https://github.com/youvandra/sdiqt/commit/085972229f232ac5d7e2a4e3f31f75596001a33c))
* exit packet v1 (S5-02) and withdraw-exec (S5-01 tool) ([#47](https://github.com/youvandra/sdiqt/issues/47)) ([fca009d](https://github.com/youvandra/sdiqt/commit/fca009d762f8c417b5d5087ea00c0169f1c5214c))
* **explorer:** browser Verify and Flip One Byte on the batch drawer ([#36](https://github.com/youvandra/sdiqt/issues/36)) ([f237f21](https://github.com/youvandra/sdiqt/commit/f237f2187fa9f65a4f343719e69bd1f38ac54947))
* **explorer:** finish the landing with verify, builders and network facts ([#37](https://github.com/youvandra/sdiqt/issues/37)) ([e983a61](https://github.com/youvandra/sdiqt/commit/e983a617108033af6562ce2b77947d5d62c08f1b))
* **explorer:** move the rollup explorer to its own page ([#67](https://github.com/youvandra/sdiqt/issues/67)) ([7bb4932](https://github.com/youvandra/sdiqt/commit/7bb4932b60defd5e427551193a2252fa7eeb4169))
* **explorer:** one-page explorer with brand tokens, live overview and batch drawer ([#34](https://github.com/youvandra/sdiqt/issues/34)) ([804c63a](https://github.com/youvandra/sdiqt/commit/804c63a81620bf1b2c073f173903ed504fd374b6))
* **explorer:** paginate the batch table ([#74](https://github.com/youvandra/sdiqt/issues/74)) ([724e3cd](https://github.com/youvandra/sdiqt/commit/724e3cd0efc0f8d89df4fe3808a9e23d3cc616a9))
* **explorer:** proof view on a real proven batch, archive label for pruned batches ([#35](https://github.com/youvandra/sdiqt/issues/35)) ([98b8342](https://github.com/youvandra/sdiqt/commit/98b834273e97fea31d618f1cade60536834b4b86))
* **explorer:** redesign the landing and rollup pages ([#66](https://github.com/youvandra/sdiqt/issues/66)) ([cc09a46](https://github.com/youvandra/sdiqt/commit/cc09a46478a86306f418b0ebe4d93b5bf2868650))
* import the qledger-v1 core and SP1 chunk prover ([#5](https://github.com/youvandra/sdiqt/issues/5)) ([2287001](https://github.com/youvandra/sdiqt/commit/2287001e05063298925ec5476d941a97f3d85474))
* **operator:** add heartbeat command ([#50](https://github.com/youvandra/sdiqt/issues/50)) ([8382383](https://github.com/youvandra/sdiqt/commit/83823836ea61f73f7bbab3fc2977cc63f547f315))
* **operator:** add qledger seed, deposit and inbox tx commands to sdiqt-accounts ([#39](https://github.com/youvandra/sdiqt/issues/39)) ([8f82353](https://github.com/youvandra/sdiqt/commit/8f82353c623503ab686caa7f28caf97136fbbeec))
* **operator:** add sdiqt-accounts for account setup and rollup creation ([#38](https://github.com/youvandra/sdiqt/issues/38)) ([f08b852](https://github.com/youvandra/sdiqt/commit/f08b85227fd0b7527716e580f23ebdfb62b02607))
* **operator:** add the one-shot --evil-root path for the staged fraud ([#28](https://github.com/youvandra/sdiqt/issues/28)) ([2acab38](https://github.com/youvandra/sdiqt/commit/2acab3813e4d2095b216c4d740e767314d731a4c))
* **operator:** plan batches from the archive behind a dual self-check ([#23](https://github.com/youvandra/sdiqt/issues/23)) ([6383bfc](https://github.com/youvandra/sdiqt/commit/6383bfccb5c0488fc1621bfb40567b402510dfee))
* **operator:** post QSTR commitments and find them in the archive ([#26](https://github.com/youvandra/sdiqt/issues/26)) ([74b2c05](https://github.com/youvandra/sdiqt/commit/74b2c0560b23a708de9603da0d922b3845dfdb3c))
* **operator:** prove chain batches through a one-at-a-time queue ([#27](https://github.com/youvandra/sdiqt/issues/27)) ([ae970b0](https://github.com/youvandra/sdiqt/commit/ae970b09c617ffb6d327e48c93cda69c0b0fe52d))
* **operator:** upload each verified bundle before its QSTR post ([#29](https://github.com/youvandra/sdiqt/issues/29)) ([b420057](https://github.com/youvandra/sdiqt/commit/b4200578d3d365148699dc2e61cc3104bcc9c248))
* **proof:** recompute PROOF.md and docs/counts.json from chain ([#46](https://github.com/youvandra/sdiqt/issues/46)) ([9a95427](https://github.com/youvandra/sdiqt/commit/9a95427961711562e3a9cf82243f0e30f5a9fc4c))
* **protocol:** add the protocol package and generated constants ([#20](https://github.com/youvandra/sdiqt/issues/20)) ([f598d14](https://github.com/youvandra/sdiqt/commit/f598d14b704b31890c8950ffc0647064fc32cdcb))
* **protocol:** add the QSTR v1 commitment encoder and decoder ([#25](https://github.com/youvandra/sdiqt/issues/25)) ([f58fb74](https://github.com/youvandra/sdiqt/commit/f58fb747ecc6efff273962f52f27117220c8bdd9))
* **prover:** write chunk proofs and the vkey hash with --out ([#12](https://github.com/youvandra/sdiqt/issues/12)) ([1b29689](https://github.com/youvandra/sdiqt/commit/1b29689bed204db5775941850e0ea2aab132a8fc))
* **verify:** add the chunk verifier with a WebAssembly build ([#13](https://github.com/youvandra/sdiqt/issues/13)) ([4689597](https://github.com/youvandra/sdiqt/commit/46895974295a1ff5f26f24bb9347fca09b6cb877))
* **verify:** verify whole bundles in WebAssembly and add @sdiqt/verify ([#30](https://github.com/youvandra/sdiqt/issues/30)) ([0fa018b](https://github.com/youvandra/sdiqt/commit/0fa018bde8141898e5c11857eda9c933e5f37348))
* **watchtower:** challenge confirmed fraud and void the batches it rolls back ([#33](https://github.com/youvandra/sdiqt/issues/33)) ([1d74617](https://github.com/youvandra/sdiqt/commit/1d746178cfb1057abdfb3c7ccb95685cdb90b4d0))
* **watchtower:** judge every batch and issue signed settlement receipts ([#31](https://github.com/youvandra/sdiqt/issues/31)) ([1b7b0fd](https://github.com/youvandra/sdiqt/commit/1b7b0fd84d87db1d40f37e5a11d83ece6e174fba))
* **watchtower:** serve a read-only JSON API for batches, receipts and health ([#32](https://github.com/youvandra/sdiqt/issues/32)) ([f34f0c0](https://github.com/youvandra/sdiqt/commit/f34f0c044cd55232cca9ee07e4dae7634ff86e51))
* **watchtower:** tick as soon as a new batch lands ([#65](https://github.com/youvandra/sdiqt/issues/65)) ([ddc865a](https://github.com/youvandra/sdiqt/commit/ddc865aacbede988f3c9fcbb870c17eb04f74cda))


### Bug Fixes

* **archiver:** report a lagging tx index apart from an accumulator mismatch ([#24](https://github.com/youvandra/sdiqt/issues/24)) ([a6a6e18](https://github.com/youvandra/sdiqt/commit/a6a6e18b807f364cce9c3cdd7618f19d6cafa61e))
* **ci:** match the explorer title by brand prefix in the uptime check ([#75](https://github.com/youvandra/sdiqt/issues/75)) ([3895694](https://github.com/youvandra/sdiqt/commit/3895694c130287884add5ac23e59d958621bff41))
* **deps:** update crates with security advisories ([#17](https://github.com/youvandra/sdiqt/issues/17)) ([a9f310a](https://github.com/youvandra/sdiqt/commit/a9f310a3806ea7d1ee10908379988a7b35fa0fb1))
* **explorer:** drawer above the nav, chain links, Explorer beside GitHub ([#71](https://github.com/youvandra/sdiqt/issues/71)) ([04bc234](https://github.com/youvandra/sdiqt/commit/04bc2340ac125c1cca40009edb4d014d4e5f6739))
* **explorer:** keyboard focus, touch targets and page titles ([#60](https://github.com/youvandra/sdiqt/issues/60)) ([0c09bcc](https://github.com/youvandra/sdiqt/commit/0c09bcca56e700e87c9d9f81d92f363e47044796))
* **explorer:** nav keeps only the logo, Explorer and GitHub ([#73](https://github.com/youvandra/sdiqt/issues/73)) ([b17c296](https://github.com/youvandra/sdiqt/commit/b17c296fb1fd8fc68f81ff9f37e4012b47d68c26))
* **operator:** resume saved prove jobs after a restart ([#41](https://github.com/youvandra/sdiqt/issues/41)) ([c6279ee](https://github.com/youvandra/sdiqt/commit/c6279eeadf8d0145fccb8a31452bc8783fa45c87))
* **protocol:** encode an empty withdrawals root in QSTR as 32 zero bytes ([#40](https://github.com/youvandra/sdiqt/issues/40)) ([14530d7](https://github.com/youvandra/sdiqt/commit/14530d7ba251427f03a0d10b893bde6af8867ca5))
* smooth the first run for newcomers ([#64](https://github.com/youvandra/sdiqt/issues/64)) ([e8a4df1](https://github.com/youvandra/sdiqt/commit/e8a4df1aff83fc6064decf532af148986464b369))
* **verify:** harden bundle reading and decoding ([#55](https://github.com/youvandra/sdiqt/issues/55)) ([c366926](https://github.com/youvandra/sdiqt/commit/c36692691f91ac262c7a50119cc5978ad5f4a411))


### Performance

* **explorer:** smaller font, lazy drawer and cached static files ([#69](https://github.com/youvandra/sdiqt/issues/69)) ([f274e3b](https://github.com/youvandra/sdiqt/commit/f274e3b5edfe9196fee23ccedc31664b9ba0519d))


### Documentation

* add README badges and refresh PROOF.md at height 10799151 ([#68](https://github.com/youvandra/sdiqt/issues/68)) ([6d2ca03](https://github.com/youvandra/sdiqt/commit/6d2ca03202f881035dec8d2bddcd975bc1136f83))
* add threat model and limits ([#51](https://github.com/youvandra/sdiqt/issues/51)) ([12cddd2](https://github.com/youvandra/sdiqt/commit/12cddd2a2c02745ff4a37fa4a8c94c86cb5020ee))
* describe multi-rollup coverage with live numbers ([#59](https://github.com/youvandra/sdiqt/issues/59)) ([4a375b7](https://github.com/youvandra/sdiqt/commit/4a375b70f9787dde524b24fd0b0bb4473105dd87))
* **proof:** add the paid withdrawal (S4-03, S5-01) ([#49](https://github.com/youvandra/sdiqt/issues/49)) ([fad5eea](https://github.com/youvandra/sdiqt/commit/fad5eeaa5d4356b97fb14834105fa13d52ea0cd2))
* record the live staged fraud and turn the tower challenge on ([#63](https://github.com/youvandra/sdiqt/issues/63)) ([f4030aa](https://github.com/youvandra/sdiqt/commit/f4030aa92d5cb5394e73dd008dfd1654a8e4a6e2))
* record the sealed exit claims and refresh PROOF.md ([#61](https://github.com/youvandra/sdiqt/issues/61)) ([6d806a2](https://github.com/youvandra/sdiqt/commit/6d806a25df269548102520a23145d07a14ee3c9c))
* show the sealed exit as live, add the cover and refresh README numbers ([#62](https://github.com/youvandra/sdiqt/issues/62)) ([4c4317e](https://github.com/youvandra/sdiqt/commit/4c4317ede6cdd9fe02d8e21d21dccca13fcc30d2))
* **specs:** statement, bundle and receipt v1 with vectors ([#52](https://github.com/youvandra/sdiqt/issues/52)) ([7915eba](https://github.com/youvandra/sdiqt/commit/7915eba496d3bdff10d28de36fdfc8c7175b83e7))
* tighten the README opening to three sentences ([#72](https://github.com/youvandra/sdiqt/issues/72)) ([2d87660](https://github.com/youvandra/sdiqt/commit/2d8766033878ebe64ef1dbdc34d88fdd717ddc8b))
* write the README and AI usage note ([#54](https://github.com/youvandra/sdiqt/issues/54)) ([3784ebc](https://github.com/youvandra/sdiqt/commit/3784ebcbecf4d4a8332d03c036a74593ca6c8108))
