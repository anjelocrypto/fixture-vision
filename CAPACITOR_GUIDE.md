# Capacitor Mobile App Build Guide

## Quick Start

### Prerequisites
- Node.js 18+
- For Android: Android Studio with SDK installed
- For iOS: macOS with Xcode installed

### Initial Setup

```bash
# 1. Clone/pull the project from GitHub
git pull origin main

# 2. Install dependencies
npm install

# 3. Build the web app
npm run build

# 4. Add mobile platforms (first time only)
npx cap add android
npx cap add ios

# 5. Sync web assets to native projects
npx cap sync
```

---

## Development Workflow

### Android Development

```bash
# Build and sync
npm run build
npx cap sync android

# Run on emulator or connected device
npx cap run android

# OR open in Android Studio for debugging
npx cap open android
```

### iOS Development (macOS only)

```bash
# Build and sync
npm run build
npx cap sync ios

# Run on simulator
npx cap run ios

# OR open in Xcode for debugging/archiving
npx cap open ios
```

---

## Live Reload (Development)

The `capacitor.config.ts` is configured for live reload from Lovable's preview URL.

**For production builds**, comment out or remove the `server.url` property:

```typescript
// capacitor.config.ts
server: {
  // url: 'https://...', // Comment this for production
  cleartext: true,
  androidScheme: 'https'
}
```

---

## Building for Production

### Android (APK/AAB)

```bash
# 1. Remove server.url from capacitor.config.ts
# 2. Build and sync
npm run build
npx cap sync android

# 3. Open Android Studio
npx cap open android

# 4. Build → Generate Signed Bundle/APK
# - Create/select keystore
# - Choose AAB for Play Store, APK for direct install
```

### iOS (Archive)

```bash
# 1. Remove server.url from capacitor.config.ts
# 2. Build and sync
npm run build
npx cap sync ios

# 3. Open Xcode
npx cap open ios

# 4. Product → Archive → Distribute App
# - Select App Store Connect or Ad Hoc
# - Follow signing prompts
```

---

## App Store Compliance Checklist

### Required Assets
- [ ] App icon (1024x1024 PNG, no transparency)
- [ ] Screenshots for all device sizes
- [ ] Privacy Policy URL
- [ ] Terms of Service URL

### Store Listing Requirements
- [ ] Age rating: 17+ (prediction/betting content)
- [ ] Clear description: "Virtual coins only, no real money"
- [ ] Category: Sports / Entertainment

### Critical Disclaimers (Already Implemented)
✅ Landing page footer: "No real money gambling" disclaimer
✅ Markets page: "Virtual coins only" info box
✅ Both state: "Coins cannot be purchased or exchanged for cash"

### What NOT to Include in Mobile App
❌ Stripe payments (Apple/Google reject this for digital goods)
❌ Any way to purchase coins
❌ Real money gambling language

---

## Troubleshooting

### "Cannot find module" errors
```bash
rm -rf node_modules
npm install
npm run build
npx cap sync
```

### iOS build fails with signing errors
1. Open Xcode
2. Select project → Signing & Capabilities
3. Select your development team
4. Enable "Automatically manage signing"

### Android build fails
1. Open Android Studio
2. File → Sync Project with Gradle Files
3. Build → Clean Project
4. Build → Rebuild Project

### Safe areas not working
- Ensure `viewport-fit=cover` is in index.html
- Check that `env(safe-area-inset-*)` CSS is applied
- Test on actual device or accurate simulator

---

## Config Reference

**capacitor.config.ts**
```typescript
{
  appId: 'app.lovable.f8241af79ba1484ebd18215507503e86',
  appName: 'fixture-vision',
  webDir: 'dist',
  android: { ... },
  ios: { contentInset: 'automatic' },
  server: {
    androidScheme: 'https',
    // url: '...' // Only for development
  }
}
```

---

## Next Steps After v1 Launch

1. **Push Notifications**: Add `@capacitor/push-notifications` + Firebase
2. **Biometrics**: Add `@capacitor/biometric-auth` for Face ID/Touch ID
3. **Deep Links**: Configure App Links (Android) / Universal Links (iOS)
4. **Analytics**: Add Firebase Analytics or similar

---

## Support

For issues with Capacitor: https://capacitorjs.com/docs
For Lovable mobile guide: https://lovable.dev/blog/lovable-mobile-development-guide
