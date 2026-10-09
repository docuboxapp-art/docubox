'use client';

import { formFontFamily, TEMPLATE_FONT_FAMILIES, type FormTypography } from '@/lib/typography/font-families';

export function FormTypographySelect({
  value,
  onChange,
  className,
}: {
  value: FormTypography;
  onChange: (value: FormTypography) => void;
  className: string;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as FormTypography)} className={className}>
      <option value="sans">Moderna (sans serif)</option>
      <option value="serif">Clásica (serif)</option>
      <optgroup label="Tipografías de plantillas">
        {TEMPLATE_FONT_FAMILIES.map((font) => (
          <option key={font} value={font} style={{ fontFamily: formFontFamily(font) }}>{font}</option>
        ))}
      </optgroup>
    </select>
  );
}
