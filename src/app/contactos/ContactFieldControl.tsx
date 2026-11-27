'use client';

import { useId, type ReactNode } from 'react';
import {
  readContactFieldSelections,
  type ContactFieldDefinition,
  type ContactFieldType,
} from '@/lib/contacts/detail';
import { contactControl } from './contact-detail-ui';

export type RelatedContactOption = { id: string; name: string; email: string | null };

const controlClass = `${contactControl} w-full min-w-0`;
const nativeInputs: Partial<
  Record<ContactFieldType, { type?: string; maxLength?: number; step?: string }>
> = {
  number: { type: 'number', step: 'any' },
  date: { type: 'date' },
  time: { type: 'time', step: 'any' },
  datetime: { type: 'datetime-local', step: 'any' },
  email: { type: 'email', maxLength: 254 },
  tel: { type: 'tel', maxLength: 60 },
  url: { type: 'url', maxLength: 2000 },
  currency: { maxLength: 64 },
  percent: { maxLength: 64 },
  postal_code: { maxLength: 5 },
};

export function ContactFieldControl({
  field,
  value,
  onChange,
  contacts,
  label = field.label,
  action,
}: {
  field: ContactFieldDefinition;
  value: string;
  onChange: (value: string) => void;
  contacts: RelatedContactOption[];
  label?: string;
  action?: ReactNode;
}) {
  const id = useId();
  const multiple = field.type === 'multiselect' || field.type === 'related_multiple';
  const grouped = field.type === 'radio' || multiple;
  const contactSelect = field.type === 'related' || field.type === 'related_multiple';
  const options = contactSelect
    ? contacts.map((contact) => ({
        value: contact.id,
        label: contact.email ? `${contact.name} · ${contact.email}` : contact.name,
      }))
    : (field.options ?? []).map((option) => ({ value: option, label: option }));
  const headingClass = 'min-w-0 text-sm font-medium text-muted-foreground [overflow-wrap:anywhere]';

  function renderControl() {
    if (field.type === 'multiline' || field.type === 'address') {
      return (
        <textarea
          id={id}
          className={`${controlClass} resize-y py-2`}
          rows={field.type === 'address' ? 2 : 3}
          maxLength={2000}
          placeholder="Sin valor"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }

    if (grouped) {
      const selected = multiple ? readContactFieldSelections(value) : [value];
      const unavailable = selected.filter(
        (item) => item && !options.some((option) => option.value === item)
      );
      const visibleOptions = [
        ...options,
        ...unavailable.map((item) => ({
          value: item,
          label: contactSelect ? 'Contacto que ya no está en tu agenda' : 'Opción no disponible',
        })),
      ];
      if (!visibleOptions.length)
        return (
          <p className={`${controlClass} flex items-center text-muted-foreground`}>
            {contactSelect ? 'No hay otros contactos en tu agenda.' : 'Agrega opciones al campo.'}
          </p>
        );
      return (
        <div
          role={multiple ? 'group' : 'radiogroup'}
          aria-labelledby={`${id}-label`}
          className={`${controlClass} max-h-44 space-y-1 overflow-y-auto py-1.5`}
        >
          {visibleOptions.map((option) => (
            <label key={option.value} className="flex min-h-8 items-start gap-2 py-1">
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={id}
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={selected.includes(option.value)}
                onChange={(event) => {
                  if (!multiple) {
                    onChange(option.value);
                    return;
                  }
                  const next = event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((item) => item !== option.value);
                  onChange(next.length ? JSON.stringify(next) : '');
                }}
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
            </label>
          ))}
          {!multiple && (
            <label className="flex min-h-8 items-start gap-2 py-1 text-muted-foreground">
              <input
                type="radio"
                name={id}
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={!value}
                onChange={() => onChange('')}
              />
              Sin valor
            </label>
          )}
        </div>
      );
    }

    if (field.type === 'select' || field.type === 'related' || field.type === 'boolean') {
      const choices =
        field.type === 'boolean'
          ? [
              { value: 'true', label: 'Sí' },
              { value: 'false', label: 'No' },
            ]
          : options;
      return (
        <select
          id={id}
          className={controlClass}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {contactSelect && !options.length ? 'No hay otros contactos en tu agenda' : 'Sin valor'}
          </option>
          {value && !choices.some((option) => option.value === value) && (
            <option disabled value={value}>
              {contactSelect ? 'Contacto que ya no está en tu agenda' : 'Opción no disponible'}
            </option>
          )}
          {choices.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    const native = nativeInputs[field.type];
    const suffix =
      field.type === 'currency'
        ? (field.currency ?? 'MXN')
        : field.type === 'percent'
          ? '%'
          : undefined;
    return (
      <div className="relative">
        <input
          id={id}
          className={`${controlClass}${suffix ? ' pr-14' : ''}`}
          type={native?.type ?? 'text'}
          step={native?.step}
          inputMode={suffix ? 'decimal' : field.type === 'postal_code' ? 'numeric' : undefined}
          list={field.type === 'combobox' ? `${id}-options` : undefined}
          aria-describedby={suffix ? `${id}-suffix` : undefined}
          maxLength={native?.maxLength ?? 240}
          placeholder={field.type === 'combobox' ? 'Escribe o elige una opción' : 'Sin valor'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix && (
          <span
            id={`${id}-suffix`}
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground"
          >
            {suffix}
          </span>
        )}
        {field.type === 'combobox' && (
          <datalist id={`${id}-options`}>
            {options.map((option) => (
              <option key={option.value} value={option.value} />
            ))}
          </datalist>
        )}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        {grouped ? (
          <span id={`${id}-label`} className={headingClass}>
            {label}
          </span>
        ) : (
          <label htmlFor={id} className={headingClass}>
            {label}
          </label>
        )}
        {action}
      </div>
      {renderControl()}
    </div>
  );
}
