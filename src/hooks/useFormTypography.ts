'use client';

import { useEffect } from 'react';
import { formFontStylesheet, type FormTypography } from '@/lib/typography/font-families';

export function useFormTypography(typography?: FormTypography) {
  useEffect(() => {
    if (!typography) return;
    const href = formFontStylesheet(typography);
    if (!href || Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some((link) => link.href === href)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.formFont = typography;
    document.head.appendChild(link);
  }, [typography]);
}
