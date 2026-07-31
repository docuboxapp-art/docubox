'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';

interface TotpCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  loading?: boolean;
  autoFocus?: boolean;
}

export default function TotpCodeInput({
  value,
  onChange,
  disabled = false,
  error = false,
  loading = false,
  autoFocus = false,
}: TotpCodeInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);

  // Sync external value to internal digits
  useEffect(() => {
    const newDigits: string[] = [];
    for (let i = 0; i < 6; i++) {
      const c = value[i] ?? '';
      newDigits.push(/\d/.test(c) ? c : '');
    }
    setDigits(newDigits);
  }, [value]);

  const focusNext = useCallback((index: number) => {
    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const focusPrev = useCallback((index: number) => {
    if (index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }, []);

  const handleChange = (index: number, val: string) => {
    // Allow only digits
    const digit = val.replace(/\D/g, '').slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    onChange(newDigits.join(''));
    if (digit) focusNext(index);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const newDigits = [...digits];
        newDigits[index] = '';
        setDigits(newDigits);
        onChange(newDigits.join(''));
      } else {
        focusPrev(index);
      }
    } else if (e.key === 'ArrowLeft') {
      focusPrev(index);
    } else if (e.key === 'ArrowRight') {
      focusNext(index);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || '';
    }
    setDigits(newDigits);
    onChange(newDigits.join(''));
    // Focus last filled or next empty
    const lastIdx = Math.min(pasted.length - 1, 5);
    inputRefs.current[lastIdx]?.focus();
  };

  const baseClass = `
    w-10 h-12 text-center text-lg font-700 rounded-xl border-2 transition-all duration-150
    focus:outline-none focus:ring-2 focus:ring-primary/30
    disabled:opacity-50 disabled:cursor-not-allowed
  `;

  const stateClass = error
    ? 'border-red-400 bg-red-50 text-red-700 focus:border-red-500' :'border-border bg-white text-foreground focus:border-primary';

  return (
    <div className="flex items-center gap-2 justify-center" onPaste={handlePaste}>
      {digits.map((digit, i) => (
        <React.Fragment key={i}>
          <input
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            pattern="\d*"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            disabled={disabled || loading}
            autoFocus={autoFocus && i === 0}
            className={`${baseClass} ${stateClass}`}
            aria-label={`Dígito ${i + 1} del código TOTP`}
          />
          {i === 2 && (
            <span className="text-muted-foreground text-lg font-300 select-none">–</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
