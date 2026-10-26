import { Capacitor, registerPlugin } from '@capacitor/core';

export function createPlatform() {
  const isNative = Capacitor.getPlatform() === 'ios';
  const bridge = isNative ? registerPlugin('SQLLabNative') : null;
  let reminderWrites = Promise.resolve();
  return {
    isNative,
    notificationPermission: 'default',
    async loadStore() { return await bridge.loadStore(); },
    async saveStore(values) { await bridge.saveStore({ values }); },
    async refreshPermission() {
      if (isNative) this.notificationPermission = (await bridge.notificationStatus()).permission;
      return this.notificationPermission;
    },
    async requestReminderPermission() {
      this.notificationPermission = (await bridge.requestReminderPermission()).permission;
      return this.notificationPermission;
    },
    async setReminder(settings, completedDays) {
      if (isNative) {
        const request = { enabled: settings.on, time: settings.time, completedDays: [...completedDays] };
        reminderWrites = reminderWrites.catch(() => {}).then(() => bridge.setReminder(request));
        await reminderWrites;
      }
    },
    async shareBackup(filename, content) {
      if (!isNative) return false;
      await bridge.shareBackup({ filename, content });
      return true;
    },
    haptic() {
      if (isNative) bridge.haptic().catch(() => {});
      else if (navigator.vibrate) navigator.vibrate(6);
    },
    onAppState(listener) {
      if (!isNative) return Promise.resolve({ remove() {} });
      return bridge.addListener('appStateChange', listener);
    },
    onOpenTraining(listener) {
      if (!isNative) return Promise.resolve({ remove() {} });
      return bridge.addListener('openTraining', listener);
    },
  };
}
