import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.f8241af79ba1484ebd18215507503e86',
  appName: 'fixture-vision',
  webDir: 'dist',
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    }
  },
  ios: {
    contentInset: 'automatic'
  },
  server: {
    url: 'https://f8241af7-9ba1-484e-bd18-215507503e86.lovableproject.com?forceHideBadge=true',
    cleartext: true,
    androidScheme: 'https'
  }
};

export default config;
