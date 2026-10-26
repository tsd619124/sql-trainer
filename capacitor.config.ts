import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fengguanjia.sqllab',
  appName: 'SQL Lab',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    backgroundColor: '#f3f5f9',
    allowsLinkPreview: false,
  },
};

export default config;
