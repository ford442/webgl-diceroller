/**
 * extract-hulls-playwright.mjs
 *
 * Uses a headless browser (Playwright) to load dice GLB files with Three.js
 * GLTFLoader + DRACOLoader, then extracts unique vertex positions for each
 * die type.  Writes public/wasm/hulls.json.
 */

import { chromium } from 'playwright';
import fs from 'fs';

const DICE = [
  { type: 'd4',  file: 'die_4.glb',  sides: 4  },
  { type: 'd6',  file: 'die_6.glb',  sides: 6  },
  { type: 'd8',  file: 'die_8.glb',  sides: 8  },
  { type: 'd10', file: 'die_10.glb', sides: 10 },
  { type: 'd12', file: 'die_12.glb', sides: 12 },
  { type: 'd20', file: 'die_20.glb', sides: 20 },
];

const EPSILON_SQ = 1e-6;

async function extract() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Expose a helper to the page that loads GLBs and returns hull vertices
  const hulls = await page.evaluate(async (diceList, epsSq) => {
    // Load three.js from the project's node_modules via CDN-ish import
    // We construct module URLs from window.location (which is about:blank).
    // Instead, we'll dynamically import from the local server... but there's
    // no server running.  We'll use data URLs for the import map and then
    // import three and loaders from unpkg at the exact version used by the project.

    const THREE_VERSION = '0.181.2';
    const map = {
      imports: {
        'three': `https://unpkg.com/three@${THREE_VERSION}/build/three.module.js`,
        'three/addons/': `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/`
      }
    };
    const im = document.createElement('script');
    im.type = 'importmap';
    im.textContent = JSON.stringify(map);
    document.head.appendChild(im);

    // Wait a tick for the importmap to register
    await new Promise(r => setTimeout(r, 10));

    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');

    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(draco);

    const result = {};

    for (const die of diceList) {
      const url = `https://raw.githubusercontent.com/mrdoob/three.js/${THREE_VERSION}/examples/models/gltf/.placeholder`;
      // We can't fetch from file:// in the browser, so we need to fetch the GLB
      // from the local filesystem.  Playwright's page.evaluate can't read files.
      // We'll use fetch with a blob URL constructed from the Node side below...
      // Actually, let's just return raw arraybuffers from Node and evaluate with them.
    }
    return result;
  }, DICE, EPSILON_SQ);

  await browser.close();
  return hulls;
}

// The above approach is getting convoluted.  Let's use a simpler Playwright
// pattern: intercept requests or use addInitScript, or simply run the extraction
// inside a local Vite dev server.

extract().catch(console.error);
