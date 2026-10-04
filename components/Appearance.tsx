"use client";

import * as React from "react";

/**
 * SLATE ships one dark surface family and one accent hue. Re-branding is
 * therefore a single `--tp-h` change on <html> — never a hand-picked colour.
 * This module owns that value and persists it, so the whole product re-skins
 * from one control.
 */

const STORAGE_KEY = "marketmind-brand-hue";

export const DEFAULT_HUE = 265;

export interface BrandPreset {
  hue: number;
  label: string;
  /** A readable sample of what the accent looks like, for the swatch. */
  note: string;
}

/** Curated hues that each read well against the #0f1115 canvas at 0.72 L. */
export const BRAND_PRESETS: BrandPreset[] = [
  { hue: 265, label: "Indigo", note: "the SLATE default" },
  { hue: 200, label: "Azure", note: "cool, technical" },
  { hue: 158, label: "Emerald", note: "growth-led" },
  { hue: 330, label: "Rose", note: "warm, high signal" },
  { hue: 40, label: "Amber", note: "attention-led" },
];

export function isBrandHue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 360;
}

/** Writes the accent hue onto the root element the theme block lives on. */
export function applyBrandHue(hue: number): void {
  document.documentElement.style.setProperty("--tp-h", String(hue));
}

/**
 * Initialises the accent before first paint so the page never flashes the
 * default hue on reload.
 */
export const brandScript = `(function(){try{var h=parseFloat(localStorage.getItem("${STORAGE_KEY}"));if(!isFinite(h)||h<0||h>360){h=${DEFAULT_HUE};}document.documentElement.style.setProperty("--tp-h",String(h));}catch(e){}})();`;

export interface BrandState {
  hue: number;
  setHue: (hue: number) => void;
  /** Back to the SLATE default. */
  reset: () => void;
  isDefault: boolean;
}

export function useBrand(): BrandState {
  const [hue, setHueState] = React.useState(DEFAULT_HUE);

  React.useEffect(() => {
    let stored: number | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = Number(raw);
        if (isBrandHue(parsed)) stored = parsed;
      }
    } catch {
      /* storage unavailable — stay on the default */
    }
    const next = stored ?? DEFAULT_HUE;
    setHueState(next);
    applyBrandHue(next);
  }, []);

  const setHue = React.useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(360, Math.round(next)));
    setHueState(clamped);
    applyBrandHue(clamped);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const reset = React.useCallback(() => setHue(DEFAULT_HUE), [setHue]);

  return { hue, setHue, reset, isDefault: hue === DEFAULT_HUE };
}
