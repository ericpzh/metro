# Station Designer icon

`station-designer-blue-bold.png` is the approved source artwork: white on the
game's navy background. The other images are design iterations.

Run `node tools/prepare-brand-icon.mjs` from the repository root to prepare:

- 64 px PNG favicons and 180 px Apple touch icons for both apps.
- A 512 px transparent silhouette for the website's CSS-coloured `BrandMark`.

The website uses an amber mark in its navigation. The browser icons keep the
approved navy and white colours. Vite fingerprints the assets, so they also
resolve through the Workers' language and path-prefix rewrites.
