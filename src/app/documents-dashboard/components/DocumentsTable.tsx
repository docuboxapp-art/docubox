'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import StatusBadge, { DocumentStatus } from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import {
  Search,
  Filter,
  Eye,
  Send,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  FileText,
  CheckCircle2,
  Clock,
  Shield,
  Download,
  Trash2,
} from 'lucide-react';

interface Firmante {
  nombre: string;
  firmado: boolean;
}

interface Documento {
  id: string;
  nombre: string;
  tipo: string;
  estado: DocumentStatus;
  rfc: string;
  firmantes: Firmante[];
  metodo: 'efirma' | 'autografa' | 'mixto';
  nom151: boolean;
  fechaEnvio: string;
  fechaLimite: string;
  hash: string;
}

// Backend integration: fetch from /api/documents?page=1&limit=12
const documentos: Documento[] = [
  {
    id: 'doc-001',
    nombre: 'Contrato de Arrendamiento Oficinas CDMX',
    tipo: 'Contrato',
    estado: 'pendiente',
    rfc: 'GOMA870312H45',
    firmantes: [
      { nombre: 'Gabriela Morales', firmado: true },
      { nombre: 'Roberto Sánchez', firmado: false },
      { nombre: 'Ana Torres', firmado: false },
    ],
    metodo: 'efirma',
    nom151: true,
    fechaEnvio: '19/03/2026',
    fechaLimite: '26/03/2026',
    hash: 'a3f9c1b2',
  },
  {
    id: 'doc-002',
    nombre: 'Pagaré Financiamiento Equipo Industrial',
    tipo: 'Pagaré',
    estado: 'completado',
    rfc: 'HECM910507KP3',
    firmantes: [
      { nombre: 'Héctor Contreras', firmado: true },
      { nombre: 'Lucía Mendoza', firmado: true },
    ],
    metodo: 'efirma',
    nom151: true,
    fechaEnvio: '15/03/2026',
    fechaLimite: '22/03/2026',
    hash: 'b7d2e4a1',
  },
  {
    id: 'doc-003',
    nombre: 'Poder Notarial Representación Legal',
    tipo: 'Poder',
    estado: 'en_proceso',
    rfc: 'ROVA800923NF8',
    firmantes: [
      { nombre: 'Rosa Vázquez', firmado: true },
      { nombre: 'Jorge Díaz', firmado: false },
      { nombre: 'Carmen Flores', firmado: false },
      { nombre: 'Miguel Ángel Ruiz', firmado: false },
    ],
    metodo: 'mixto',
    nom151: false,
    fechaEnvio: '20/03/2026',
    fechaLimite: '27/03/2026',
    hash: 'c1a5f8d3',
  },
  {
    id: 'doc-004',
    nombre: 'Acuerdo de Confidencialidad NDA Proveedor',
    tipo: 'Acuerdo',
    estado: 'rechazado',
    rfc: 'PERM770614JZ2',
    firmantes: [
      { nombre: 'Pedro Ramírez', firmado: false },
      { nombre: 'Elena Gutiérrez', firmado: false },
    ],
    metodo: 'autografa',
    nom151: false,
    fechaEnvio: '18/03/2026',
    fechaLimite: '25/03/2026',
    hash: 'd4b9e7f2',
  },
  {
    id: 'doc-005',
    nombre: 'Contrato de Servicios TI 2026',
    tipo: 'Contrato',
    estado: 'parcial',
    rfc: 'LONA850228XY1',
    firmantes: [
      { nombre: 'Lorenzo Navarro', firmado: true },
      { nombre: 'Sofía Ibáñez', firmado: true },
      { nombre: 'Andrés Molina', firmado: false },
    ],
    metodo: 'efirma',
    nom151: true,
    fechaEnvio: '21/03/2026',
    fechaLimite: '28/03/2026',
    hash: 'e2c6a9b5',
  },
  {
    id: 'doc-006',
    nombre: 'Acta Constitutiva Empresa SAS',
    tipo: 'Acta',
    estado: 'completado',
    rfc: 'TOCA920715MK4',
    firmantes: [
      { nombre: 'Tomás Castellanos', firmado: true },
      { nombre: 'Isabel Reyes', firmado: true },
      { nombre: 'Fernando López', firmado: true },
    ],
    metodo: 'efirma',
    nom151: true,
    fechaEnvio: '10/03/2026',
    fechaLimite: '17/03/2026',
    hash: 'f8d1b4c7',
  },
  {
    id: 'doc-007',
    nombre: 'Factura Electrónica Servicios Consultoría',
    tipo: 'Factura',
    estado: 'pendiente',
    rfc: 'GUJA780319HN9',
    firmantes: [{ nombre: 'Guillermo Juárez', firmado: false }],
    metodo: 'efirma',
    nom151: false,
    fechaEnvio: '21/03/2026',
    fechaLimite: '23/03/2026',
    hash: 'a9e3c2d6',
  },
  {
    id: 'doc-008',
    nombre: 'Convenio Modificatorio Contrato Marco',
    tipo: 'Convenio',
    estado: 'borrador',
    rfc: 'MESA830511PQ7',
    firmantes: [
      { nombre: 'Mercedes Salazar', firmado: false },
      { nombre: 'Patricio Olvera', firmado: false },
    ],
    metodo: 'mixto',
    nom151: false,
    fechaEnvio: '—',
    fechaLimite: '—',
    hash: 'b3f7d1e8',
  },
  {
    id: 'doc-009',
    nombre: 'Carta Oferta Ejecutivo Comercial Senior',
    tipo: 'RRHH',
    estado: 'completado',
    rfc: 'ZAPA910803GV5',
    firmantes: [
      { nombre: 'Zapata Arriaga S.A.', firmado: true },
      { nombre: 'Valentina Cruz', firmado: true },
    ],
    metodo: 'autografa',
    nom151: false,
    fechaEnvio: '12/03/2026',
    fechaLimite: '19/03/2026',
    hash: 'c7a2e5b9',
  },
  {
    id: 'doc-010',
    nombre: 'Contrato de Distribución Exclusiva Nacional',
    tipo: 'Contrato',
    estado: 'vencido',
    rfc: 'BARM680924DL3',
    firmantes: [
      { nombre: 'Bárbara Moreno', firmado: true },
      { nombre: 'Ernesto Peña', firmado: false },
    ],
    metodo: 'efirma',
    nom151: false,
    fechaEnvio: '01/03/2026',
    fechaLimite: '08/03/2026',
    hash: 'd5b8f3a1',
  },
  {
    id: 'doc-011',
    nombre: 'Adendum Contrato Prestación Servicios',
    tipo: 'Adendum',
    estado: 'en_proceso',
    rfc: 'ALVA950602WT6',
    firmantes: [
      { nombre: 'Álvaro Soto', firmado: true },
      { nombre: 'Natalia Herrera', firmado: false },
    ],
    metodo: 'efirma',
    nom151: true,
    fechaEnvio: '20/03/2026',
    fechaLimite: '27/03/2026',
    hash: 'e1c4d7b2',
  },
  {
    id: 'doc-012',
    nombre: 'Acuerdo de Pago en Parcialidades',
    tipo: 'Acuerdo',
    estado: 'pendiente',
    rfc: 'FUEN720418KJ8',
    firmantes: [
      { nombre: 'Fuentes & Asociados SC', firmado: false },
      { nombre: 'Carlos Espinoza', firmado: false },
    ],
    metodo: 'autografa',
    nom151: false,
    fechaEnvio: '21/03/2026',
    fechaLimite: '24/03/2026',
    hash: 'f6a9c3e4',
  },
];

const filterOptions: { label: string; value: string }[] = [
  { label: 'Todos', value: 'todos' },
  { label: 'Pendientes', value: 'pendiente' },
  { label: 'En progreso', value: 'en_proceso' },
  { label: 'Completados', value: 'completado' },
  { label: 'Rechazados', value: 'rechazado' },
  { label: 'Vencidos', value: 'vencido' },
];

function FirmantesProgress({ firmantes }: { firmantes: Firmante[] }) {
  const total = firmantes.length;
  const firmados = firmantes.filter((f) => f.firmado).length;
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {firmantes.map((f, i) => (
          <div
            key={`firmante-dot-${i}`}
            title={`${f.nombre} — ${f.firmado ? 'Firmado' : 'Pendiente'}`}
            className={`w-2.5 h-2.5 rounded-full border ${
              f.firmado ? 'bg-emerald-500 border-emerald-600' : 'bg-gray-200 border-gray-300'
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">
        {firmados}/{total}
      </span>
    </div>
  );
}

function MetodoBadge({ metodo }: { metodo: 'efirma' | 'autografa' | 'mixto' }) {
  const config = {
    efirma: { label: 'e.firma', className: 'bg-primary/10 text-primary border border-primary/20' },
    autografa: {
      label: 'Autógrafa',
      className: 'bg-purple-50 text-purple-700 border border-purple-200',
    },
    mixto: { label: 'Mixto', className: 'bg-teal-50 text-teal-700 border border-teal-200' },
  };
  const c = config[metodo];
  return (
    <span className={`text-[10px] font-600 px-2 py-0.5 rounded-full ${c.className}`}>
      {c.label}
    </span>
  );
}

export default function DocumentsTable() {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('todos');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [sortField, setSortField] = useState<string>('fechaEnvio');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [openActionRow, setOpenActionRow] = useState<string | null>(null);
  const itemsPerPage = 8;

  const filtered = documentos.filter((doc) => {
    const matchSearch =
      doc.nombre.toLowerCase().includes(search.toLowerCase()) ||
      doc.rfc.toLowerCase().includes(search.toLowerCase()) ||
      doc.tipo.toLowerCase().includes(search.toLowerCase());
    const matchFilter = activeFilter === 'todos' || doc.estado === activeFilter;
    return matchSearch && matchFilter;
  });

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleRow = (id: string) => {
    setSelectedRows((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  const toggleAll = () => {
    if (selectedRows.length === paginated.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(paginated.map((d) => d.id));
    }
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field)
      return <ChevronUp size={12} className="text-muted-foreground opacity-30" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={12} className="text-primary" />
    ) : (
      <ChevronDown size={12} className="text-primary" />
    );
  };

  return (
    <div className="bg-white rounded-xl border border-border shadow-card">
      {/* Table header */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-700 text-slate-900 whitespace-nowrap">
            Documentos recientes
          </h2>
          <div className="flex items-center gap-2 flex-1 justify-end">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Buscar por nombre, RFC, tipo…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 w-56 placeholder:text-muted-foreground"
              />
            </div>
            <button className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:bg-muted transition-all duration-150 active:scale-95">
              <Filter size={13} />
              Filtros
            </button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {filterOptions.map((opt) => (
            <button
              key={`filter-${opt.value}`}
              onClick={() => {
                setActiveFilter(opt.value);
                setCurrentPage(1);
              }}
              className={`px-3 py-1 rounded-full text-xs font-500 transition-all duration-150 ${
                activeFilter === opt.value
                  ? 'bg-primary text-white'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedRows.length > 0 && (
        <div className="px-5 py-2.5 bg-primary/5 border-b border-primary/20 flex items-center gap-3 slide-up">
          <span className="text-sm font-600 text-primary">{selectedRows.length} seleccionados</span>
          <div className="flex items-center gap-2 ml-auto">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-500 bg-white border border-border text-foreground hover:bg-muted transition-all duration-150">
              <Send size={12} />
              Reenviar recordatorio
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-500 bg-white border border-border text-foreground hover:bg-muted transition-all duration-150">
              <Download size={12} />
              Descargar constancias
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-500 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition-all duration-150">
              <Trash2 size={12} />
              Eliminar
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={selectedRows.length === paginated.length && paginated.length > 0}
                  onChange={toggleAll}
                  className="rounded border-border"
                />
              </th>
              {[
                { label: 'Documento', field: 'nombre' },
                { label: 'RFC', field: 'rfc' },
                { label: 'Tipo', field: 'tipo' },
                { label: 'Estado', field: 'estado' },
                { label: 'Firmantes', field: 'firmantes' },
                { label: 'Método', field: 'metodo' },
                { label: 'NOM-151', field: 'nom151' },
                { label: 'Enviado', field: 'fechaEnvio' },
                { label: 'Vence', field: 'fechaLimite' },
              ].map((col) => (
                <th
                  key={`col-${col.field}`}
                  onClick={() => handleSort(col.field)}
                  className="px-3 py-3 text-left cursor-pointer group"
                >
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-600 uppercase tracking-wide text-muted-foreground group-hover:text-foreground transition-colors">
                      {col.label}
                    </span>
                    <SortIcon field={col.field} />
                  </div>
                </th>
              ))}
              <th className="px-3 py-3 text-right">
                <span className="text-[11px] font-600 uppercase tracking-wide text-muted-foreground">
                  Acciones
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={11}>
                  <EmptyState
                    icon={<FileText size={24} />}
                    title="No hay documentos"
                    description="No se encontraron documentos con los filtros seleccionados. Intenta cambiar el criterio de búsqueda."
                    action={
                      <Link
                        href="/inicio"
                        className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-500 hover:bg-primary-700 transition-all duration-150"
                      >
                        Subir nuevo documento
                      </Link>
                    }
                  />
                </td>
              </tr>
            ) : (
              paginated.map((doc, idx) => (
                <tr
                  key={doc.id}
                  className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors duration-100 ${
                    idx % 2 === 0 ? '' : 'bg-muted/10'
                  } ${selectedRows.includes(doc.id) ? 'bg-primary/5' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedRows.includes(doc.id)}
                      onChange={() => toggleRow(doc.id)}
                      className="rounded border-border"
                    />
                  </td>
                  <td className="px-3 py-3 max-w-[200px]">
                    <p className="text-sm font-500 text-foreground truncate" title={doc.nombre}>
                      {doc.nombre}
                    </p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                      #{doc.hash}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs font-mono text-muted-foreground">{doc.rfc}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-foreground bg-muted px-2 py-0.5 rounded-md font-500">
                      {doc.tipo}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={doc.estado} size="sm" />
                  </td>
                  <td className="px-3 py-3">
                    <FirmantesProgress firmantes={doc.firmantes} />
                  </td>
                  <td className="px-3 py-3">
                    <MetodoBadge metodo={doc.metodo} />
                  </td>
                  <td className="px-3 py-3">
                    {doc.nom151 ? (
                      <div className="flex items-center gap-1" title="Sellado NOM-151">
                        <Shield size={13} className="text-emerald-600" />
                        <span className="text-[10px] text-emerald-700 font-600">Sí</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {doc.fechaEnvio}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`text-xs tabular-nums font-500 ${
                        doc.estado === 'vencido' ? 'text-red-600' : 'text-muted-foreground'
                      }`}
                    >
                      {doc.fechaLimite}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="flex items-center gap-1">
                        <button
                          title="Ver detalle del documento"
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-150"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          title="Reenviar solicitud de firma"
                          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-150"
                        >
                          <Send size={14} />
                        </button>
                        <div className="relative">
                          <button
                            title="Más opciones"
                            onClick={() =>
                              setOpenActionRow(openActionRow === doc.id ? null : doc.id)
                            }
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-150"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {openActionRow === doc.id && (
                            <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-border shadow-dropdown z-20 py-1 fade-in">
                              <button className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-muted transition-colors">
                                <Download size={12} />
                                Descargar constancia
                              </button>
                              <button className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-muted transition-colors">
                                <CheckCircle2 size={12} />
                                Ver audit trail
                              </button>
                              <button className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-muted transition-colors">
                                <Clock size={12} />
                                Ver historial
                              </button>
                              <hr className="my-1 border-border" />
                              <button className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors">
                                <Trash2 size={12} />
                                Eliminar documento
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-5 py-3 border-t border-border flex items-center justify-between">
        <p className="text-xs text-muted-foreground tabular-nums">
          Mostrando {Math.min((currentPage - 1) * itemsPerPage + 1, filtered.length)}–
          {Math.min(currentPage * itemsPerPage, filtered.length)} de {filtered.length} documentos
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-2.5 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
          >
            Anterior
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <button
              key={`page-${page}`}
              onClick={() => setCurrentPage(page)}
              className={`w-8 h-7 rounded-lg text-xs font-500 transition-all duration-150 ${
                currentPage === page
                  ? 'bg-primary text-white'
                  : 'border border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {page}
            </button>
          ))}
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-2.5 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
