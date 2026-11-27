'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, User, UserPlus, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  launchContactColumns,
  launchContactPerson,
  launchEmailPattern,
  type LaunchMember,
  type LaunchPerson,
} from '@/lib/case-files/launch';
import LaunchDialog from './LaunchDialog';

const inputClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
type Profile = {
  id: string;
  full_name?: string;
  email: string;
  phone?: string;
  rfc?: string;
  curp?: string;
};

export default function ParticipantPicker({
  userId,
  members,
  primary,
  onChoose,
  onClose,
}: {
  userId: string;
  members: LaunchMember[];
  primary: boolean;
  onChoose: (person: LaunchPerson) => string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<'contacts' | 'search' | 'members'>('contacts');
  const [contacts, setContacts] = useState<LaunchPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [platformQuery, setPlatformQuery] = useState('');
  const [results, setResults] = useState<LaunchPerson[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [manual, setManual] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [criteria, setCriteria] = useState<'correo' | 'telefono' | 'rfc' | 'curp'>('correo');
  const [personType, setPersonType] = useState('fisica'),
    [paternal, setPaternal] = useState(''),
    [maternal, setMaternal] = useState(''),
    [phone, setPhone] = useState(''),
    [rfc, setRfc] = useState(''),
    [curp, setCurp] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void supabase
      .from('contacts')
      .select(launchContactColumns)
      .eq('user_id', userId)
      .order('nombre')
      .then(
        ({ data, error: cause }) => {
          if (!live) return;
          if (cause)
            setLoadError(
              'No se pudieron cargar tus contactos. Puedes reintentar o añadir una persona manualmente.'
            );
          else
            setContacts((data || []).map(launchContactPerson).filter((person) => person !== null));
          setLoading(false);
        },
        () => {
          if (live) {
            setLoadError('No se pudieron cargar tus contactos. Vuelve a intentarlo.');
            setLoading(false);
          }
        }
      );
    return () => {
      live = false;
    };
  }, [supabase, userId, retry]);
  useEffect(() => () => controller.current?.abort(), []);

  const choose = (person: LaunchPerson) => {
    const member = members.find((item) => item.id === person.userId || item.id === person.id);
    setError(onChoose({ ...person, userId: member?.id }));
  };
  const searchPlatform = async () => {
    const requested =
      criteria === 'correo'
        ? platformQuery.trim().toLowerCase()
        : ['rfc', 'curp'].includes(criteria)
          ? platformQuery.trim().toUpperCase()
          : platformQuery.trim();
    if (!requested || (criteria === 'correo' && !launchEmailPattern.test(requested))) {
      setError('Escribe un criterio válido para buscar en Docubox.');
      return;
    }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setSearching(true);
    setSearched(true);
    setResults([]);
    setError('');
    try {
      const { data } = await supabase.auth.getSession();
      const response = await fetch(
        `/api/documentos/buscar-participante?q=${encodeURIComponent(requested)}&criteria=${criteria}`,
        {
          signal: request.signal,
          cache: 'no-store',
          headers: data.session?.access_token
            ? { Authorization: `Bearer ${data.session.access_token}` }
            : {},
        }
      );
      if (!response.ok) throw new Error('No se pudo buscar al participante. Vuelve a intentarlo.');
      const body = await response.json();
      if (!request.signal.aborted)
        setResults(
          (body.users || [])
            .filter((person: Profile) => person.email)
            .map((person: Profile) => ({
              id: person.id,
              name: person.full_name || person.email,
              email: person.email.trim().toLowerCase(),
              details: {
                full_name: person.full_name || '',
                phone: person.phone || '',
                rfc: person.rfc || '',
                curp: person.curp || '',
              },
            }))
        );
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'No se pudo buscar al participante.');
    } finally {
      if (!request.signal.aborted) setSearching(false);
    }
  };
  const list: LaunchPerson[] =
    tab === 'members'
      ? members.map((member) => ({
          id: member.id,
          userId: member.id,
          name: member.name,
          email: member.email || '',
        }))
      : tab === 'contacts'
        ? contacts
        : results;
  const filtered =
    tab === 'search'
      ? list
      : list.filter((person) =>
          `${person.name} ${person.email}`.toLowerCase().includes(query.toLowerCase())
        );

  return (
    <LaunchDialog
      title={primary ? 'Seleccionar titular' : 'Añadir participante'}
      description="Selecciona un contacto, un miembro del espacio o busca una persona en Docubox."
      onClose={onClose}
    >
      <div className="mb-4 flex overflow-hidden rounded-lg border border-slate-200">
        {(
          [
            { key: 'contacts', label: 'Mis contactos', icon: Users },
            { key: 'members', label: 'Miembros del espacio', icon: Users },
            { key: 'search', label: 'Buscar participante', icon: Search },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key && !manual}
            onClick={() => {
              setTab(key);
              setManual(false);
              setError('');
            }}
            className={`flex flex-1 items-center justify-center gap-2 border-r border-slate-200 px-2 py-2.5 text-sm font-medium last:border-r-0 ${tab === key && !manual ? 'bg-primary text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            <Icon size={15} className="hidden sm:block" />
            {label}
          </button>
        ))}
      </div>
      {manual ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim() || !launchEmailPattern.test(email.trim())) {
              setError('Escribe el nombre y un correo válido.');
              return;
            }
            choose({
              id: email.trim().toLowerCase(),
              name:
                personType === 'moral'
                  ? name.trim()
                  : [name, paternal, maternal]
                      .map((x) => x.trim())
                      .filter(Boolean)
                      .join(' '),
              email: email.trim().toLowerCase(),
              details: {
                nombre: personType === 'fisica' ? name.trim() : '',
                apellido_paterno: paternal.trim(),
                apellido_materno: maternal.trim(),
                phone: phone.trim(),
                rfc: rfc.trim().toUpperCase(),
                curp: curp.trim().toUpperCase(),
                personalidad_juridica: personType,
                business_name: personType === 'moral' ? name.trim() : '',
              },
            });
          }}
        >
          <div>
            <h3 className="text-sm font-semibold">Datos del participante</h3>
            <p className="mt-1 text-xs text-slate-500">
              Puedes registrar a una persona o empresa sin modificar tu agenda.
            </p>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span>Tipo de persona</span>
            <select
              className={inputClass}
              value={personType}
              onChange={(e) => setPersonType(e.target.value)}
            >
              <option value="fisica">Persona física</option>
              <option value="moral">Persona moral</option>
            </select>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>
              {personType === 'moral' ? 'Denominación o razón social' : 'Nombre'}{' '}
              <span className="text-red-500">*</span>
            </span>
            <input
              autoFocus
              required
              maxLength={240}
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>
              Correo electrónico <span className="text-red-500">*</span>
            </span>
            <input
              required
              type="email"
              maxLength={254}
              className={inputClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {personType === 'fisica' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Apellido paterno
                <input
                  value={paternal}
                  maxLength={100}
                  onChange={(e) => setPaternal(e.target.value)}
                  className={`${inputClass} mt-2`}
                />
              </label>
              <label className="text-sm">
                Apellido materno
                <input
                  value={maternal}
                  maxLength={100}
                  onChange={(e) => setMaternal(e.target.value)}
                  className={`${inputClass} mt-2`}
                />
              </label>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Teléfono
              <input
                type="tel"
                value={phone}
                maxLength={30}
                onChange={(e) => setPhone(e.target.value)}
                className={`${inputClass} mt-2`}
              />
            </label>
            <label className="text-sm">
              RFC
              <input
                value={rfc}
                maxLength={13}
                onChange={(e) => setRfc(e.target.value.toUpperCase())}
                className={`${inputClass} mt-2`}
              />
            </label>
            {personType === 'fisica' && (
              <label className="text-sm sm:col-span-2">
                CURP
                <input
                  value={curp}
                  maxLength={18}
                  onChange={(e) => setCurp(e.target.value.toUpperCase())}
                  className={`${inputClass} mt-2`}
                />
              </label>
            )}
          </div>
          <button
            type="submit"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white"
          >
            <UserPlus size={15} />
            {primary ? 'Seleccionar titular' : 'Añadir participante'}
          </button>
        </form>
      ) : (
        <>
          {tab === 'search' ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void searchPlatform();
              }}
            >
              <select
                aria-label="Criterio de búsqueda"
                value={criteria}
                onChange={(e) => {
                  setCriteria(e.target.value as typeof criteria);
                  setPlatformQuery('');
                  setResults([]);
                  setSearched(false);
                }}
                className={`${inputClass} max-w-32`}
              >
                <option value="correo">Correo</option>
                <option value="telefono">Teléfono</option>
                <option value="rfc">RFC</option>
                <option value="curp">CURP</option>
              </select>
              <input
                autoFocus
                type={criteria === 'correo' ? 'email' : 'text'}
                aria-label="Correo para buscar en Docubox"
                placeholder={`Buscar por ${criteria}`}
                value={platformQuery}
                onChange={(event) => {
                  controller.current?.abort();
                  setSearching(false);
                  setResults([]);
                  setSearched(false);
                  setPlatformQuery(event.target.value);
                  setError('');
                }}
                className={inputClass}
              />
              <button
                disabled={searching}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                Buscar
              </button>
            </form>
          ) : (
            <label className="relative block">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                autoFocus
                type="search"
                aria-label={
                  tab === 'contacts' ? 'Buscar en mis contactos' : 'Buscar miembro del espacio'
                }
                placeholder={
                  tab === 'contacts'
                    ? 'Buscar en mis contactos...'
                    : 'Buscar miembro del espacio...'
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={`${inputClass} pl-9`}
              />
            </label>
          )}
          <div className="mt-4 min-h-36 space-y-2">
            {tab === 'contacts' && loading ? (
              <div role="status" className="flex justify-center py-12">
                <Loader2 className="animate-spin text-primary" aria-label="Cargando contactos" />
              </div>
            ) : tab === 'contacts' && loadError ? (
              <div role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                {loadError}
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setLoadError('');
                    setRetry((value) => value + 1);
                  }}
                  className="ml-2 font-semibold underline"
                >
                  Reintentar
                </button>
              </div>
            ) : (
              filtered.map((person) => (
                <div
                  key={person.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <User size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {person.name}
                      {person.id === userId ? ' (Tú)' : ''}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {person.email || 'Cuenta del espacio de trabajo'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => choose(person)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white"
                  >
                    <UserPlus size={13} />
                    Agregar
                  </button>
                </div>
              ))
            )}
            {!loading && !filtered.length && !(tab === 'contacts' && loadError) && (
              <p className="py-10 text-center text-sm text-slate-500">
                {tab === 'search' && !searched
                  ? 'Busca a la persona por su correo electrónico.'
                  : tab === 'search' && searching
                    ? 'Buscando participante...'
                    : 'No se encontraron participantes.'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setManual(true);
              setError('');
            }}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:border-primary hover:text-primary"
          >
            <UserPlus size={16} />
            Añadir manualmente
          </button>
        </>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </LaunchDialog>
  );
}
