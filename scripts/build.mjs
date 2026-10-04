import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');

const isWatch = process.argv.includes('--watch');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log(`[Build] Starting ${isWatch ? 'watch mode' : 'production build'}...`);

const buildTargets = [
  // 1. Background Service Worker (ESM for MV3)
  {
    entryPoints: [path.resolve(rootDir, 'src/background/index.ts')],
    outfile: path.resolve(distDir, 'background.bundle.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    platform: 'browser',
  },
  // 2. Content Script (IIFE for isolated execution context)
  {
    entryPoints: [path.resolve(rootDir, 'src/content/index.ts')],
    outfile: path.resolve(distDir, 'content.bundle.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
    platform: 'browser',
  },
  // 3. Injected Interceptor (IIFE for MAIN world execution)
  {
    entryPoints: [path.resolve(rootDir, 'src/injected/interceptor.ts')],
    outfile: path.resolve(distDir, 'injected_interceptor.bundle.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
    platform: 'browser',
  },
  // 4. Side Panel Logic (IIFE)
  {
    entryPoints: [path.resolve(rootDir, 'src/sidepanel/index.ts')],
    outfile: path.resolve(distDir, 'sidepanel.bundle.js'),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
    platform: 'browser',
  },
];

async function runBuild() {
  try {
    for (const target of buildTargets) {
      if (isWatch) {
        const ctx = await esbuild.context(target);
        await ctx.watch();
        console.log(`[Watch] Watching ${path.basename(target.outfile)}...`);
      } else {
        await esbuild.build(target);
        console.log(`[Build] Built ${path.basename(target.outfile)}`);
      }
    }

    // Copy CSS to dist if exists
    const cssSrc = path.resolve(rootDir, 'src/sidepanel/style.css');
    const cssDist = path.resolve(distDir, 'sidepanel.css');
    if (fs.existsSync(cssSrc)) {
      fs.copyFileSync(cssSrc, cssDist);
      console.log(`[Build] Copied sidepanel.css to dist/`);
    }

    console.log('[Build] All targets compiled successfully.');
  } catch (err) {
    console.error('[Build Error]', err);
    process.exit(1);
  }
}

runBuild();
