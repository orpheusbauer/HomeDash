export type DashboardOrientation = 'landscape' | 'portrait';

interface HomeDashAndroidBridge {
  getOrientation(): string;
  setOrientation(value: DashboardOrientation): void;
  openAppSettings(): void;
  exitToAndroid(): void;
}

declare global {
  interface Window {
    HomeDashAndroid?: HomeDashAndroidBridge;
  }
}

export function hasAndroidBridge(): boolean {
  return typeof window.HomeDashAndroid !== 'undefined';
}

export function getDashboardOrientation(): DashboardOrientation | null {
  const value = window.HomeDashAndroid?.getOrientation();
  return value === 'portrait' || value === 'landscape' ? value : null;
}

export function setDashboardOrientation(value: DashboardOrientation): void {
  window.HomeDashAndroid?.setOrientation(value);
}

export function openAndroidAppSettings(): void {
  window.HomeDashAndroid?.openAppSettings();
}

export function exitToAndroid(): void {
  window.HomeDashAndroid?.exitToAndroid();
}
