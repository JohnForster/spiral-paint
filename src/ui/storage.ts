// localStorage access that never throws (private mode, blocked storage, quota).

export const AUTOSAVE_KEY = "spiral-paint:autosave";
export const PREFS_KEY = "spiral-paint:prefs";

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export interface Prefs {
  colour: string;
  recent: string[];
  showLines: boolean;
}

export function loadPrefs(defaults: Prefs): Prefs {
  try {
    const raw = load(PREFS_KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : defaults;
  } catch {
    return defaults;
  }
}
