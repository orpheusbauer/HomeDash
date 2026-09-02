export type DashboardOrientation = 'landscape' | 'portrait';
export type MotionWakeStatus = {
  supported: boolean;
  enabled: boolean;
  cameraGranted: boolean;
  notificationGranted: boolean;
  batteryOptimizationsIgnored: boolean;
  serviceRunning?: boolean;
  receivingFrames?: boolean;
  cameraError?: string | null;
  lastFrameAgeSeconds?: number | null;
  lastMotionAgeSeconds?: number | null;
};

interface HomeDashAndroidBridge {
  getOrientation(): string;
  setOrientation(value: DashboardOrientation): void;
  openAppSettings(): void;
  exitToAndroid(): void;
  getAppVersion?: () => string;
  installAndroidUpdate?: (version: string) => void;
  getMotionWakeStatus?: () => string;
  setMotionWakeEnabled?: (enabled: boolean) => void;
  requestMotionWakePermission?: () => void;
  openBatteryOptimizationSettings?: () => void;
  openAppPermissionSettings?: () => void;
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

export function getAndroidAppVersion(): string | null {
  return window.HomeDashAndroid?.getAppVersion?.() ?? null;
}

export function supportsAndroidUpdates(): boolean {
  return typeof window.HomeDashAndroid?.installAndroidUpdate === 'function';
}

export function installAndroidUpdate(version: string): void {
  window.HomeDashAndroid?.installAndroidUpdate?.(version);
}

export function supportsMotionWake(): boolean {
  return (
    typeof window.HomeDashAndroid?.getMotionWakeStatus === 'function' &&
    typeof window.HomeDashAndroid?.setMotionWakeEnabled === 'function'
  );
}

export function getMotionWakeStatus(): MotionWakeStatus | null {
  try {
    const raw = window.HomeDashAndroid?.getMotionWakeStatus?.();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MotionWakeStatus>;
    if (
      typeof parsed.supported !== 'boolean' ||
      typeof parsed.enabled !== 'boolean' ||
      typeof parsed.cameraGranted !== 'boolean' ||
      typeof parsed.notificationGranted !== 'boolean' ||
      typeof parsed.batteryOptimizationsIgnored !== 'boolean'
    ) {
      return null;
    }
    return parsed as MotionWakeStatus;
  } catch {
    return null;
  }
}

export function setMotionWakeEnabled(enabled: boolean): void {
  window.HomeDashAndroid?.setMotionWakeEnabled?.(enabled);
}

export function requestMotionWakePermission(): void {
  window.HomeDashAndroid?.requestMotionWakePermission?.();
}

export function openBatteryOptimizationSettings(): void {
  window.HomeDashAndroid?.openBatteryOptimizationSettings?.();
}

export function openAndroidPermissionSettings(): void {
  window.HomeDashAndroid?.openAppPermissionSettings?.();
}
