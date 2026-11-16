import React, { createContext, useContext, useEffect, useState } from 'react';
import { Accessibility, RotateCcw } from 'lucide-react';
import { MatButton, MatDialog, MatDivider, MatSwitch } from '../components/material/MaterialUI';

export interface AccessibilityPreferences {
  highContrast: boolean;
  largeText: boolean;
  reduceMotion: boolean;
  colorblindSafe: boolean;
}

const DEFAULT_A11Y_PREFS: AccessibilityPreferences = {
  highContrast: false,
  largeText: false,
  reduceMotion: false,
  colorblindSafe: false,
};

const A11Y_STORAGE_KEY = 'pigradient_a11y_prefs';

interface AccessibilityContextValue {
  prefs: AccessibilityPreferences;
  updatePref: <K extends keyof AccessibilityPreferences>(
    key: K,
    value: AccessibilityPreferences[K]
  ) => void;
  resetPrefs: () => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue>({
  prefs: DEFAULT_A11Y_PREFS,
  updatePref: () => {},
  resetPrefs: () => {},
});

export const AccessibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [prefs, setPrefs] = useState<AccessibilityPreferences>(() => {
    try {
      const saved = localStorage.getItem(A11Y_STORAGE_KEY);
      if (saved) return { ...DEFAULT_A11Y_PREFS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_A11Y_PREFS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(prefs));
    } catch {}

    document.documentElement.classList.toggle('a11y-large-text', prefs.largeText);
    document.body.classList.toggle('a11y-high-contrast', prefs.highContrast);
    document.body.classList.toggle('a11y-reduce-motion', prefs.reduceMotion);
  }, [prefs]);

  const updatePref = <K extends keyof AccessibilityPreferences>(
    key: K,
    value: AccessibilityPreferences[K]
  ) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  };

  const resetPrefs = () => setPrefs(DEFAULT_A11Y_PREFS);

  return (
    <AccessibilityContext.Provider value={{ prefs, updatePref, resetPrefs }}>
      {children}
    </AccessibilityContext.Provider>
  );
};

export function useAccessibility() {
  return useContext(AccessibilityContext);
}

export const AccessibilityDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { prefs, updatePref, resetPrefs } = useAccessibility();

  return (
    <MatDialog
      open={open}
      onClose={onClose}
      title="Accessibility Options"
      subtitle="Visual contrast, typography, motion, and chart distinguishability"
      icon={
        <div className="w-9 h-9 rounded-lg bg-[#1e3a5f] text-[#93c5fd] flex items-center justify-center">
          <Accessibility className="w-5 h-5" />
        </div>
      }
      actions={
        <>
          <MatButton
            variant="text"
            onClick={resetPrefs}
            icon={<RotateCcw className="w-3.5 h-3.5" />}
          >
            Reset Defaults
          </MatButton>
          <MatButton variant="filled" onClick={onClose}>
            Done
          </MatButton>
        </>
      }
    >
      <div className="space-y-1">
        <MatSwitch
          checked={prefs.highContrast}
          onChange={(v) => updatePref('highContrast', v)}
          label="High Contrast Mode"
          description="Deepens background contrast, sharpens borders, and thickens keyboard focus rings."
        />

        <MatDivider />

        <MatSwitch
          checked={prefs.largeText}
          onChange={(v) => updatePref('largeText', v)}
          label="Larger UI Text (112.5%)"
          description="Scales labels, sensor metrics, and controls across all views."
        />

        <MatDivider />

        <MatSwitch
          checked={prefs.reduceMotion}
          onChange={(v) => updatePref('reduceMotion', v)}
          label="Reduce Motion"
          description="Disables live chart transitions and UI animations."
        />

        <MatDivider />

        <MatSwitch
          checked={prefs.colorblindSafe}
          onChange={(v) => updatePref('colorblindSafe', v)}
          label="Colorblind-Safe Chart Patterns"
          description="Adds distinct point markers and dash patterns to telemetry series so curves don't rely on color alone."
        />
      </div>
    </MatDialog>
  );
};
