import { PaceProfile } from './types';

export function paceToMetersPerSecond(secondsPerKm: number): number {
  return 1000 / secondsPerKm;
}

export function metersPerSecondToPace(mps: number): string {
  const secondsPerKm = 1000 / mps;
  return formatPace(secondsPerKm);
}

export function parsePaceString(pace: string): number {
  const parts = pace.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
  }
  return parseInt(pace);
}

export function formatPace(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function getDefaultPaceProfile(): PaceProfile {
  return {
    easy: { min: 330, max: 390 },       // 5:30 - 6:30
    threshold: { min: 270, max: 290 },   // 4:30 - 4:50
    interval: { min: 240, max: 260 },    // 4:00 - 4:20
    tempo: { min: 280, max: 300 },       // 4:40 - 5:00
    sprint: { min: 200, max: 230 },      // 3:20 - 3:50
    marathon_pace: { min: 290, max: 310 }, // 4:50 - 5:10
  };
}

export function getPaceForZone(
  zone: string,
  paceProfile: PaceProfile
): { min: number; max: number } {
  const key = zone as keyof PaceProfile;
  return paceProfile[key] || paceProfile.easy;
}
