# Clodds Apps

This directory contains platform-specific application packages.

## Planned Apps

- **clodds-desktop** - Electron desktop app
- **clodds-mobile** - React Native mobile app
- **clodds-web** - Web dashboard

## Structure

```
apps/
├── desktop/          # Electron app
│   ├── main/         # Main process
│   ├── renderer/     # Renderer process
│   └── preload/      # Preload scripts
├── mobile/           # React Native app
│   ├── ios/          # iOS native code
│   ├── android/      # Android native code
│   └── src/          # Shared JS/TS code
└── web/              # Web dashboard
    ├── pages/        # Next.js pages
    └── components/   # React components
```

## Building

```bash
# Desktop
cd apps/desktop && npm run build

# Mobile
cd apps/mobile && npm run ios
cd apps/mobile && npm run android

# Web
cd apps/web && npm run build
```
