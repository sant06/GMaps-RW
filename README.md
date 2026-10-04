# GMaps-RW

Production-grade Manifest V3 browser extension for bidirectional synchronization (Read & Write) on Google Maps (custom lists, starred places, favorites, and notes).

## Overview

- **Read Engine**: Passive `batchexecute` RPC interceptor in MAIN world paired with a resilient fallback virtual DOM scroller (`div[role="feed"]`). Decodes high-precision coordinates (`!3d/!4d`).
- **Write Engine**: Internal RPC mutation replay (`f.req` + ambient `at` CSRF token) with programmatic DOM synthetic click fallback.
- **Export & Import**: RFC 7946 GeoJSON, KML 2.2, and RFC 4180 CSV formats.
- **Security & Privacy**: 100% local processing with strict CSP (`connect-src 'none'`) and zero remote telemetry.
- **UI Surface**: Native persistent `chrome.sidePanel`.

## Development

```bash
# Install dependencies
npm install

# Build extension bundles
npm run build

# Watch mode during development
npm run dev

# Strict TypeScript check
npm run typecheck
```

## Load Unpacked Extension

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the root directory of this repository (`c:\Users\Pc\Documents\AG - ExtensionChrome`).
