import React, { useEffect, useId, useRef } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

/**
 * Material Design 3 / Angular Material Inspired Component Primitives
 * Zero external dependencies; enforces accessible 40px+ targets, focus-visible
 * rings, WAI-ARIA roles, single-level tonal surfaces, and ink-bar tab indicators.
 */

export const MatCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  elevation?: 'outlined' | 'elevated' | 'filled';
  style?: React.CSSProperties;
  title?: string;
  ariaLabel?: string;
}> = ({ children, className = '', elevation = 'outlined', style, title, ariaLabel }) => {
  const surfaceClass =
    elevation === 'elevated'
      ? 'bg-[#1d2129] shadow-[0_1px_3px_0_rgba(0,0,0,0.45),0_4px_10px_2px_rgba(0,0,0,0.25)] border border-white/[0.06]'
      : elevation === 'filled'
      ? 'bg-[#191c23] border border-white/[0.06]'
      : 'bg-[#181b22] border border-white/[0.1]';

  return (
    <div
      className={`rounded-xl ${surfaceClass} ${className}`}
      style={style}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
};

export const MatDivider: React.FC<{ className?: string }> = ({ className = '' }) => (
  <hr className={`border-0 border-t border-white/[0.09] ${className}`} />
);

export interface MatTabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  title?: string;
}

export const MatTabs: React.FC<{
  tabs: MatTabItem[];
  value: string;
  onChange: (id: string) => void;
  fullWidth?: boolean;
  dense?: boolean;
  className?: string;
  ariaLabel?: string;
}> = ({
  tabs,
  value,
  onChange,
  fullWidth = false,
  dense = false,
  className = '',
  ariaLabel = 'Navigation tabs',
}) => {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let nextIdx = idx;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;
    else return;

    e.preventDefault();
    onChange(tabs[nextIdx].id);
    tabRefs.current[nextIdx]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex items-stretch border-b border-white/[0.1] overflow-x-auto no-scrollbar ${
        fullWidth ? 'w-full' : ''
      } ${className}`}
    >
      {tabs.map((tab, idx) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[idx] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={tab.title}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`relative flex items-center justify-center gap-1.5 sm:gap-2 ${
              dense ? 'min-h-[40px] px-2.5 sm:px-3 text-xs' : 'min-h-[44px] sm:min-h-[46px] px-3 sm:px-5 text-xs sm:text-[13px]'
            } ${
              fullWidth ? 'flex-1' : 'shrink-0'
            } font-medium tracking-[0.01em] whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#60a5fa] cursor-pointer ${
              active
                ? 'text-[#93c5fd] bg-[#60a5fa]/[0.06]'
                : 'text-[#a3aab8] hover:text-[#e6e8ee] hover:bg-white/[0.04]'
            }`}
          >
            {tab.icon && <span className="shrink-0" aria-hidden="true">{tab.icon}</span>}
            <span>{tab.label}</span>
            {/* Material Ink Bar */}
            <span
              aria-hidden="true"
              className={`absolute bottom-0 left-0 right-0 h-[2.5px] rounded-t-sm transition-opacity duration-150 ${
                active ? 'bg-[#60a5fa] opacity-100' : 'opacity-0'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
};

export interface MatButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'warning';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}

export const MatButton: React.FC<MatButtonProps> = ({
  variant = 'filled',
  size = 'md',
  icon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) => {
  const sizeClass =
    size === 'sm'
      ? 'min-h-[36px] px-3 py-1.5 text-xs gap-1.5'
      : 'min-h-[40px] px-4 py-2 text-[13px] gap-2';

  const variantClass = disabled
    ? 'bg-white/[0.06] text-white/35 border border-white/[0.06] cursor-not-allowed'
    : variant === 'filled'
    ? 'bg-[#2563eb] hover:bg-[#3b82f6] active:bg-[#1d4ed8] text-white shadow-sm cursor-pointer'
    : variant === 'tonal'
    ? 'bg-[#1e3a5f] hover:bg-[#254773] text-[#bfdbfe] border border-[#60a5fa]/25 cursor-pointer'
    : variant === 'outlined'
    ? 'bg-transparent hover:bg-white/[0.05] text-[#e6e8ee] border border-white/[0.2] hover:border-white/[0.35] cursor-pointer'
    : variant === 'warning'
    ? 'bg-[#d97706] hover:bg-[#f59e0b] text-slate-950 font-semibold shadow-sm cursor-pointer'
    : 'bg-transparent hover:bg-white/[0.06] text-[#93c5fd] cursor-pointer';

  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-lg font-medium tracking-[0.01em] whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa] ${sizeClass} ${variantClass} ${className}`}
      {...rest}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
};

export const MatSegmentedButton: React.FC<{
  options: { id: string; label: string; title?: string }[];
  value: string;
  onChange: (id: string) => void;
  fullWidthOnMobile?: boolean;
  className?: string;
  ariaLabel?: string;
}> = ({
  options,
  value,
  onChange,
  fullWidthOnMobile = false,
  className = '',
  ariaLabel = 'Segmented selector',
}) => (
  <div
    role="group"
    aria-label={ariaLabel}
    className={`flex flex-nowrap items-center max-w-full overflow-x-auto no-scrollbar rounded-lg border border-white/[0.14] divide-x divide-white/[0.12] bg-[#14171d] ${
      fullWidthOnMobile ? 'w-full sm:w-auto' : 'w-fit'
    } ${className}`}
  >
    {options.map((opt) => {
      const active = opt.id === value;
      return (
        <button
          key={opt.id}
          type="button"
          aria-pressed={active}
          title={opt.title}
          onClick={() => onChange(opt.id)}
          className={`min-h-[38px] sm:min-h-[36px] px-2.5 sm:px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#60a5fa] cursor-pointer ${
            fullWidthOnMobile ? 'flex-1 sm:flex-initial shrink-0' : 'shrink-0'
          } ${
            active
              ? 'bg-[#1e3a5f] text-[#bfdbfe]'
              : 'text-[#a3aab8] hover:text-[#e6e8ee] hover:bg-white/[0.04]'
          }`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

export const MatSwitch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  title?: string;
}> = ({ checked, onChange, label, description, className = '', title }) => {
  const labelId = useId();
  return (
    <label
      title={title}
      className={`flex items-center justify-between gap-4 min-h-[44px] py-2 cursor-pointer select-none group ${className}`}
    >
      <div className="min-w-0 flex-1">
        <div id={labelId} className="text-[13px] font-medium text-[#e6e8ee]">
          {label}
        </div>
        {description && (
          <div className="text-xs text-[#8f96a6] mt-0.5 leading-relaxed">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa] cursor-pointer ${
          checked
            ? 'bg-[#2563eb] border-[#2563eb]'
            : 'bg-[#2a2f3a] border-[#525b6e] group-hover:border-[#78849e]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block rounded-full bg-white shadow transition-transform duration-150 ${
            checked ? 'h-5 w-5 translate-x-5.5' : 'h-3.5 w-3.5 translate-x-1 bg-[#a3aab8]'
          }`}
        />
      </button>
    </label>
  );
};

export const MatCheckbox: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  accent?: 'primary' | 'amber';
  className?: string;
  title?: string;
}> = ({ checked, onChange, label, description, accent = 'primary', className = '', title }) => {
  const checkedBg =
    accent === 'amber'
      ? 'bg-[#d97706] border-[#d97706] text-slate-950'
      : 'bg-[#2563eb] border-[#2563eb] text-white';

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2.5 text-left min-h-[40px] py-1.5 px-1.5 rounded-lg hover:bg-white/[0.04] transition-colors focus-visible:outline-2 focus-visible:outline-[#60a5fa] cursor-pointer ${className}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 w-[18px] h-[18px] rounded-[4px] border-2 flex items-center justify-center shrink-0 transition-colors ${
          checked ? checkedBg : 'border-[#78849e] bg-transparent'
        }`}
      >
        {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-[13px] font-medium text-[#e6e8ee] block leading-snug">{label}</span>
        {description && <span className="text-xs text-[#8f96a6] block mt-0.5">{description}</span>}
      </span>
    </button>
  );
};

export const MatSlider: React.FC<{
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  color?: 'primary' | 'emerald' | 'indigo' | 'amber' | 'rose';
  ariaLabel?: string;
  ariaValueText?: string;
  title?: string;
}> = ({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  color = 'primary',
  ariaLabel = 'Slider',
  ariaValueText,
  title,
}) => {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const fillColor =
    color === 'emerald'
      ? '#10b981'
      : color === 'indigo'
      ? '#818cf8'
      : color === 'amber'
      ? '#f59e0b'
      : color === 'rose'
      ? '#f43f5e'
      : '#3b82f6';

  return (
    <div title={title} className="relative flex items-center min-h-[40px] w-full select-none">
      {/* Track */}
      <div className="relative w-full h-1.5 rounded-full bg-white/[0.12] overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, backgroundColor: fillColor }}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        aria-valuetext={ariaValueText}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />
      {/* Thumb indicator with keyboard focus ring */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute w-4 h-4 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.6)] transition-transform peer-focus-visible:scale-125 peer-focus-visible:ring-2 peer-focus-visible:ring-[#93c5fd] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#181b22]"
        style={{
          left: `calc(${pct}% - 8px)`,
          boxShadow: `0 0 0 2px ${fillColor}, 0 2px 6px rgba(0,0,0,0.5)`,
        }}
      />
    </div>
  );
};

export const MatTextField: React.FC<{
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  mono?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
}> = ({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  maxLength,
  min,
  max,
  step,
  mono = false,
  className = '',
  ariaLabel,
  title,
}) => {
  const inputId = useId();
  const hintId = useId();
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label ? (
        <label
          htmlFor={inputId}
          className="block text-xs font-medium text-[#b5bcc9] tracking-[0.01em]"
        >
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        aria-describedby={hint ? hintId : undefined}
        title={title}
        className={`w-full min-h-[44px] px-3.5 py-2 bg-[#12151b] border border-white/[0.18] hover:border-white/[0.3] focus:border-[#60a5fa] focus:ring-1 focus:ring-[#60a5fa]/60 rounded-lg text-[13px] text-[#e6e8ee] placeholder:text-[#667085] focus:outline-none transition-colors ${
          mono ? 'font-mono' : ''
        }`}
      />
      {hint && (
        <p id={hintId} className="text-[11px] text-[#8f96a6] leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
};

export const MatSelect: React.FC<{
  label: React.ReactNode;
  hint?: React.ReactNode;
  value: string | number;
  onChange: (value: string) => void;
  options: { value: string | number; label: string }[];
  className?: string;
  title?: string;
}> = ({ label, hint, value, onChange, options, className = '', title }) => {
  const selectId = useId();
  const hintId = useId();
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label
        htmlFor={selectId}
        className="block text-xs font-medium text-[#b5bcc9] tracking-[0.01em]"
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? hintId : undefined}
          title={title}
          className="w-full min-h-[44px] pl-3.5 pr-10 py-2 bg-[#12151b] border border-white/[0.18] hover:border-white/[0.3] focus:border-[#60a5fa] focus:ring-1 focus:ring-[#60a5fa]/60 rounded-lg text-[13px] text-[#e6e8ee] appearance-none focus:outline-none transition-colors cursor-pointer"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-[#181b22] text-[#e6e8ee]">
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="w-4 h-4 text-[#8f96a6] pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
        />
      </div>
      {hint && (
        <p id={hintId} className="text-[11px] text-[#8f96a6] leading-relaxed">
          {hint}
        </p>
      )}
    </div>
  );
};

export const MatDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  maxWidthClass?: string;
}> = ({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  actions,
  maxWidthClass = 'max-w-md',
}) => {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full ${maxWidthClass} max-h-[90dvh] flex flex-col bg-[#21252e] border border-white/[0.12] rounded-2xl shadow-[0_12px_36px_rgba(0,0,0,0.55)] overflow-hidden`}
      >
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-4 sm:pt-5 pb-3.5 sm:pb-4 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && <div className="shrink-0" aria-hidden="true">{icon}</div>}
            <div className="min-w-0">
              <h3 id={titleId} className="text-base font-semibold text-[#f1f3f8] font-display">
                {title}
              </h3>
              {subtitle && <p className="text-xs text-[#9ca3af] mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close dialog (Esc)"
            className="p-2 -mr-2 -mt-1 rounded-lg text-[#9ca3af] hover:text-white hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-[#60a5fa] cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-4 overflow-y-auto">{children}</div>

        {actions && (
          <div className="flex items-center justify-end gap-2 px-5 sm:px-6 py-3.5 bg-[#191c23] border-t border-white/[0.08] shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};
