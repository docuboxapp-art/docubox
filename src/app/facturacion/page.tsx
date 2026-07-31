'use client';

import React, { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  CreditCard, Star, CheckCircle, ShoppingBag, FileText, PenTool,
  HardDrive, Download, X, Building2, MapPin, Phone, Mail, Hash,
  Calendar, Receipt, TrendingUp, Zap, Package, AlertCircle, BarChart3,
  Crown, Layers, Loader2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type Tab = 'plan' | 'historial' | 'consumos' | 'planes';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  interval: string;
  documents_included: number;
  features: string[];
}

interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  workspace_id: string | null;
  status: string;
  documents_used: number;
  documents_limit: number;
  current_period_start: string;
  current_period_end: string | null;
  subscription_plans: SubscriptionPlan | null;
}

interface SubscriptionHistoryItem {
  id: string;
  plan_name: string;
  amount: number;
  interval: string;
  event_type: string;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  created_at: string;
}

// ── Static upgrade plan data ───────────────────────────────────────────────────

const upgradePlan = {
  name: 'Plan Empresarial',
  price: '$1,299',
  period: 'mes',
  features: [
    'Documentos ilimitados',
    'Firmas ilimitadas',
    '100 GB de almacenamiento',
    'Plantillas ilimitadas',
    'Soporte 24/7 dedicado',
    'API & Webhooks avanzados',
    'Reportes personalizados',
    'Certificados digitales avanzados',
    'Usuarios ilimitados',
    'SSO / SAML',
  ],
};

interface ChargeItem {
  concept: string;
  qty: number;
  unitPrice: string;
  subtotal: string;
}

interface Purchase {
  id: string;
  date: string;
  description: string;
  amount: string;
  status: 'Pagado' | 'Pendiente' | 'Fallido';
  invoice: string;
  charges: ChargeItem[];
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  paymentMethod: string;
  billingPeriod: string;
}

interface Metric {
  label: string;
  used: number;
  total: number;
  unit: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  textColor: string;
}

const statusConfig: Record<Purchase['status'], { bg: string; text: string; dot: string }> = {
  Pagado:   { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  Pendiente:{ bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
  Fallido:  { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500'     },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
}

function mapHistoryToPurchase(item: SubscriptionHistoryItem, index: number): Purchase {
  const year = new Date(item.created_at).getFullYear();
  const month = String(new Date(item.created_at).getMonth() + 1).padStart(2, '0');
  const folio = `INV-${year}-${String(index + 1).padStart(3, '0')}`;
  const amount = item.amount;
  const tax = amount * 0.16;
  const subtotalBase = amount - tax;

  return {
    id: folio,
    date: formatDate(item.created_at),
    description: `${item.plan_name} — ${new Date(item.created_at).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`,
    amount: formatCurrency(amount),
    status: amount === 0 ? 'Pagado' : 'Pagado',
    invoice: '#',
    billingPeriod: item.period_start && item.period_end
      ? `${formatDate(item.period_start)} – ${formatDate(item.period_end)}`
      : '—',
    paymentMethod: amount === 0 ? 'Plan Gratuito' : 'Tarjeta registrada',
    charges: [
      {
        concept: item.plan_name,
        qty: 1,
        unitPrice: formatCurrency(subtotalBase),
        subtotal: formatCurrency(subtotalBase),
      },
    ],
    subtotal: formatCurrency(subtotalBase),
    discount: '$0.00',
    tax: formatCurrency(tax),
    total: formatCurrency(amount),
  };
}

// ── Invoice Modal ──────────────────────────────────────────────────────────────

interface InvoiceModalProps {
  purchase: Purchase;
  onClose: () => void;
}

function InvoiceModal({ purchase, onClose }: InvoiceModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Receipt size={15} className="text-primary" />
            </div>
            <div>
              <h2 className="font-700 text-sm text-foreground">Factura {purchase.id}</h2>
              <p className="text-xs text-muted-foreground">{purchase.billingPeriod}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 bg-primary text-white text-xs font-600 px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Download size={13} />
              Descargar PDF
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Company & Invoice Info */}
          <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <FileText size={14} className="text-white" />
                </div>
                <span className="font-800 text-base text-foreground">DocuBox</span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5"><Building2 size={11} />DocuBox S.A. de C.V.</div>
                <div className="flex items-center gap-1.5"><Hash size={11} />RFC: DBX-2020-001234</div>
                <div className="flex items-center gap-1.5"><MapPin size={11} />Av. Insurgentes Sur 1234, CDMX</div>
                <div className="flex items-center gap-1.5"><Phone size={11} />+52 55 1234 5678</div>
                <div className="flex items-center gap-1.5"><Mail size={11} />facturacion@docubox.mx</div>
              </div>
            </div>
            <div className="sm:text-right">
              <span className={`inline-flex items-center gap-1.5 text-xs font-600 px-2.5 py-1 rounded-full mb-3 ${statusConfig[purchase.status].bg} ${statusConfig[purchase.status].text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusConfig[purchase.status].dot}`} />
                {purchase.status}
              </span>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex sm:justify-end items-center gap-1.5">
                  <Hash size={11} />
                  <span className="font-600 text-foreground">{purchase.id}</span>
                </div>
                <div className="flex sm:justify-end items-center gap-1.5">
                  <Calendar size={11} />Emitida: {purchase.date}
                </div>
                <div className="flex sm:justify-end items-center gap-1.5">
                  <Calendar size={11} />Período: {purchase.billingPeriod}
                </div>
              </div>
            </div>
          </div>

          {/* Bill To */}
          <div className="bg-muted/40 rounded-xl p-4">
            <p className="text-xs font-700 text-muted-foreground uppercase tracking-wide mb-2">Facturado a</p>
            <p className="font-600 text-foreground text-sm">Cliente DocuBox</p>
            <div className="space-y-0.5 text-xs text-muted-foreground mt-1">
              <p>Plan: {purchase.description}</p>
              <p>Método de pago: {purchase.paymentMethod}</p>
            </div>
          </div>

          {/* Charges */}
          <div>
            <p className="text-xs font-700 text-muted-foreground uppercase tracking-wide mb-3">Desglose de Cargos</p>
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="text-left px-4 py-2.5 text-xs font-600 text-muted-foreground">Concepto</th>
                    <th className="text-center px-4 py-2.5 text-xs font-600 text-muted-foreground">Cant.</th>
                    <th className="text-right px-4 py-2.5 text-xs font-600 text-muted-foreground">P. Unitario</th>
                    <th className="text-right px-4 py-2.5 text-xs font-600 text-muted-foreground">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {purchase.charges.map((charge, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-foreground text-xs">{charge.concept}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground text-xs">{charge.qty}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground text-xs">{charge.unitPrice}</td>
                      <td className="px-4 py-3 text-right font-600 text-foreground text-xs">{charge.subtotal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full sm:w-64 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{purchase.subtotal}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Descuento</span><span>{purchase.discount}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">IVA (16%)</span><span>{purchase.tax}</span></div>
              <div className="border-t border-border pt-2.5 flex justify-between">
                <span className="font-700 text-foreground">Total</span>
                <span className="font-800 text-lg text-primary">{purchase.total}</span>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground border-t border-border pt-4">
            Este documento es un comprobante fiscal digital (CFDI) emitido por DocuBox S.A. de C.V. · Folio fiscal: {purchase.id}-CFDI
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Planes y Paquetes Data ─────────────────────────────────────────────────────

const planes = [
  {
    id: 'basico',
    name: 'Plan Básico',
    price: '$299',
    period: 'mes',
    description: 'Ideal para freelancers y profesionistas independientes.',
    badge: null,
    badgeColor: '',
    highlight: false,
    icon: FileText,
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-600',
    borderColor: 'border-border',
    features: [
      '25 documentos mensuales',
      '25 firmas electrónicas',
      '5 GB de almacenamiento',
      '3 plantillas personalizadas',
      'Soporte por email',
      'CFDI incluido',
    ],
  },
  {
    id: 'profesional',
    name: 'Plan Profesional',
    price: '$599',
    period: 'mes',
    description: 'Para equipos en crecimiento que necesitan más capacidad.',
    badge: 'Más popular',
    badgeColor: 'bg-primary text-white',
    highlight: true,
    icon: Zap,
    iconBg: 'bg-primary/10',
    iconColor: 'text-primary',
    borderColor: 'border-primary',
    features: [
      '150 documentos mensuales',
      'Firmas ilimitadas',
      '25 GB de almacenamiento',
      '20 plantillas personalizadas',
      'Soporte prioritario',
      'API básica',
      'Reportes mensuales',
      'CFDI incluido',
    ],
  },
  {
    id: 'empresarial',
    name: 'Plan Empresarial',
    price: '$1,299',
    period: 'mes',
    description: 'Solución completa para empresas con alto volumen de documentos.',
    badge: 'Completo',
    badgeColor: 'bg-violet-600 text-white',
    highlight: false,
    icon: Crown,
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    borderColor: 'border-border',
    features: [
      'Documentos ilimitados',
      'Firmas ilimitadas',
      '100 GB de almacenamiento',
      'Plantillas ilimitadas',
      'Soporte 24/7 dedicado',
      'API & Webhooks avanzados',
      'Reportes personalizados',
      'Certificados digitales avanzados',
      'Usuarios ilimitados',
      'SSO / SAML',
    ],
  },
];

const paquetesDocumentos = [
  {
    id: 'paq-10',
    docs: 10,
    price: '$89',
    pricePerDoc: '$8.90',
    color: 'bg-blue-50',
    borderColor: 'border-blue-100',
    textColor: 'text-blue-700',
    badgeColor: 'bg-blue-100 text-blue-700',
  },
  {
    id: 'paq-25',
    docs: 25,
    price: '$199',
    pricePerDoc: '$7.96',
    color: 'bg-emerald-50',
    borderColor: 'border-emerald-100',
    textColor: 'text-emerald-700',
    badgeColor: 'bg-emerald-100 text-emerald-700',
    badge: 'Ahorra 11%',
  },
  {
    id: 'paq-50',
    docs: 50,
    price: '$349',
    pricePerDoc: '$6.98',
    color: 'bg-violet-50',
    borderColor: 'border-violet-100',
    textColor: 'text-violet-700',
    badgeColor: 'bg-violet-100 text-violet-700',
    badge: 'Mejor valor',
  },
  {
    id: 'paq-100',
    docs: 100,
    price: '$599',
    pricePerDoc: '$5.99',
    color: 'bg-amber-50',
    borderColor: 'border-amber-100',
    textColor: 'text-amber-700',
    badgeColor: 'bg-amber-100 text-amber-700',
    badge: 'Ahorra 33%',
  },
];

// ── Planes y Paquetes Tab ──────────────────────────────────────────────────────

function PlanesTab({ onUpgrade, onPlanChanged }: { onUpgrade: () => void; onPlanChanged?: () => void }) {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { user } = useAuth();

  async function handleSelectPlan(planId: string) {
    setSelectedPlan(planId);
    setSuccessMsg(null);
    setErrorMsg(null);
  }

  async function handleConfirmPlan() {
    if (!selectedPlan || !user) return;
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/subscriptions/cambiar-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planSlug: selectedPlan, userId: user.id }),
      });
      const json = await res.json();

      if (!json.success) {
        setErrorMsg(json.error || 'No se pudo cambiar el plan. Intenta de nuevo.');
      } else {
        const planName = planes.find(p => p.id === selectedPlan)?.name || selectedPlan;
        setSuccessMsg(`¡Plan actualizado a ${planName} exitosamente!`);
        setSelectedPlan(null);
        onPlanChanged?.();
      }
    } catch {
      setErrorMsg('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-5">
          <h2 className="text-base font-700 text-foreground">Elige tu Plan</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Selecciona el plan que mejor se adapte a tus necesidades. Todos los planes incluyen CFDI y soporte.</p>
        </div>

        {successMsg && (
          <div className="mb-4 flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <CheckCircle size={15} className="text-emerald-600 flex-shrink-0" />
            <p className="text-sm font-600 text-emerald-800">{successMsg}</p>
          </div>
        )}

        {errorMsg && (
          <div className="mb-4 flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle size={15} className="text-red-600 flex-shrink-0" />
            <p className="text-sm font-600 text-red-800">{errorMsg}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {planes.map((plan) => {
            const PlanIcon = plan.icon;
            const isSelected = selectedPlan === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative bg-white border-2 rounded-2xl overflow-hidden flex flex-col transition-all duration-150 ${
                  plan.highlight ? 'border-primary shadow-lg shadow-primary/10' : plan.borderColor
                } ${isSelected ? 'ring-2 ring-primary ring-offset-2' : ''}`}
              >
                {plan.badge && (
                  <div className="absolute top-4 right-4">
                    <span className={`text-xs font-700 px-2.5 py-1 rounded-full ${plan.badgeColor}`}>
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="p-6 flex flex-col flex-1">
                  {/* Icon + Name */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-xl ${plan.iconBg} flex items-center justify-center`}>
                      <PlanIcon size={18} className={plan.iconColor} />
                    </div>
                    <div>
                      <h3 className="font-700 text-foreground text-sm">{plan.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>
                    </div>
                  </div>

                  {/* Price */}
                  <div className={`rounded-xl px-4 py-3 mb-5 ${plan.highlight ? 'bg-primary/5 border border-primary/20' : 'bg-muted/40'}`}>
                    <div className="flex items-end gap-1">
                      <span className="text-3xl font-800 text-foreground">{plan.price}</span>
                      <span className="text-sm text-muted-foreground mb-1">/ {plan.period}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">+ IVA · Facturación mensual</p>
                  </div>

                  {/* Features */}
                  <ul className="space-y-2 flex-1 mb-6">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                        <CheckCircle size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <button
                    onClick={() => handleSelectPlan(plan.id)}
                    disabled={loading}
                    className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white text-sm font-600 px-6 py-2.5 rounded-xl transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isSelected ? '✓ Seleccionado' : 'Seleccionar plan'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {selectedPlan && (
          <div className="mt-4 flex items-center justify-between bg-primary/5 border border-primary/20 rounded-xl px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <CheckCircle size={16} className="text-primary" />
              <span className="text-sm font-600 text-foreground">
                Plan seleccionado: <span className="text-primary">{planes.find(p => p.id === selectedPlan)?.name}</span>
              </span>
            </div>
            <button
              onClick={handleConfirmPlan}
              disabled={loading}
              className="bg-white text-blue-600 text-sm font-700 px-5 py-2 rounded-xl hover:bg-blue-50 transition-colors whitespace-nowrap flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              {loading ? 'Actualizando...' : 'Actualizar ahora'}
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="mb-5">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
              <Layers size={15} className="text-violet-600" />
            </div>
            <h2 className="text-base font-700 text-foreground">Paquetes Adicionales de Documentos</h2>
          </div>
          <p className="text-sm text-muted-foreground ml-10.5">Amplía tu capacidad sin cambiar de plan. Los documentos no caducan y se acumulan mes a mes.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {paquetesDocumentos.map((paq) => (
            <div
              key={paq.id}
              className={`relative border rounded-2xl p-5 flex flex-col items-center text-center ${paq.color} ${paq.borderColor}`}
            >
              {paq.badge && (
                <span className={`absolute -top-2.5 left-1/2 -translate-x-1/2 text-xs font-700 px-2.5 py-0.5 rounded-full whitespace-nowrap ${paq.badgeColor}`}>
                  {paq.badge}
                </span>
              )}
              <div className={`w-12 h-12 rounded-xl bg-white flex items-center justify-center mb-3 shadow-sm`}>
                <FileText size={20} className={paq.textColor} />
              </div>
              <p className={`text-3xl font-800 ${paq.textColor}`}>{paq.docs}</p>
              <p className="text-xs text-muted-foreground font-600 uppercase tracking-wide mt-0.5 mb-3">documentos</p>
              <p className="text-xl font-800 text-foreground">{paq.price}</p>
              <p className="text-xs text-muted-foreground mt-0.5 mb-4">{paq.pricePerDoc} / doc · + IVA</p>
              <button className={`w-full py-2 rounded-xl text-xs font-700 bg-white border ${paq.borderColor} ${paq.textColor} hover:shadow-sm transition-all`}>
                Comprar
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
          <AlertCircle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            Los paquetes adicionales son compatibles con cualquier plan activo. Los documentos no utilizados se acumulan y no tienen fecha de vencimiento.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Plan Tab ───────────────────────────────────────────────────────────────────

interface PlanTabProps {
  subscription: Subscription | null;
  loading: boolean;
  onUpgrade: () => void;
}

function PlanTab({ subscription, loading, onUpgrade }: PlanTabProps) {
  const plan = subscription?.subscription_plans;
  const planName = plan?.name || 'Plan Gratuito';
  const planPrice = plan ? formatCurrency(plan.price) : '$0.00';
  const docsUsed = subscription?.documents_used || 0;
  const docsTotal = subscription?.documents_limit || 2;
  const pct = docsTotal > 0 ? Math.round((docsUsed / docsTotal) * 100) : 0;
  const docsFromPlan = docsTotal;
  const docsFromPackage = 0;

  const renewDate = subscription?.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

  const renewDays = subscription?.current_period_end
    ? Math.max(0, Math.ceil((new Date(subscription.current_period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const planFeatures: string[] = plan?.features || ['2 documentos por mes', 'Firma electrónica básica', 'Historial de documentos', 'Soporte por email'];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Plan Details */}
        <div className="lg:col-span-3 bg-white border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <Star size={15} className="text-primary" />
              </div>
              <h2 className="text-sm font-700 text-foreground">Detalles del Plan Actual</h2>
            </div>
            <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-600 text-xs font-600 px-3 py-1 rounded-full border border-gray-200">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
              {subscription?.status === 'active' ? 'Activo' : subscription?.status || 'Plan Gratuito'}
            </span>
          </div>

          <div className="p-6 space-y-5">
            <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-xl px-5 py-4">
              <div>
                <h3 className="text-lg font-700 text-blue-600">{planName}</h3>
                <span className="inline-block mt-1 bg-white text-blue-600 text-xs font-500 px-2.5 py-0.5 rounded-full border border-blue-200">
                  Plan Mensual · Renovable
                </span>
              </div>
              <div className="text-right">
                <p className="text-2xl font-800 text-foreground">{planPrice}</p>
                <p className="text-xs text-muted-foreground">/ mes</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-700 text-muted-foreground uppercase tracking-wide mb-3">Características incluidas</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
                {planFeatures.map((f: string) => (
                  <div key={f} className="flex items-center gap-2 text-sm text-foreground">
                    <CheckCircle size={14} className="text-emerald-500 flex-shrink-0" />
                    {f}
                  </div>
                ))}
              </div>
            </div>

            {renewDays > 0 && (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <AlertCircle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  Tu plan se renueva automáticamente en{' '}
                  <span className="font-700">{renewDays} días</span> — {renewDate} — con{' '}
                  <span className="font-700">{docsTotal} nuevos documentos</span>.
                </p>
              </div>
            )}

            <button
              onClick={onUpgrade}
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white text-sm font-600 px-6 py-2.5 rounded-xl transition-colors flex items-center gap-2"
            >
              <TrendingUp size={15} />
              Mejorar Plan
            </button>
          </div>
        </div>

        {/* Document Consumption */}
        <div className="lg:col-span-2 bg-white border border-border rounded-2xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
              <FileText size={15} className="text-blue-600" />
            </div>
            <h2 className="text-sm font-700 text-foreground">Consumo de Documentos</h2>
          </div>

          <div className="p-6 flex flex-col flex-1">
            <div className="flex flex-col items-center py-5 flex-1 justify-center">
              <span className="text-7xl font-800 text-blue-600 leading-none tabular-nums">{docsTotal - docsUsed}</span>
              <span className="text-xs font-600 text-muted-foreground uppercase tracking-widest mt-2">Documentos Disponibles</span>
            </div>

            <div className="mb-5">
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>Usados: <span className="font-600 text-foreground">{docsUsed}</span></span>
                <span>Total: <span className="font-600 text-foreground">{docsTotal}</span></span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="space-y-2 mb-5">
              <div className="flex items-center justify-between py-2.5 px-3 bg-muted/30 rounded-xl">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center">
                    <FileText size={11} className="text-blue-600" />
                  </div>
                  <span className="text-xs text-foreground">Plan Mensual</span>
                </div>
                <span className="text-xs font-700 text-foreground">{docsFromPlan} docs</span>
              </div>
              <div className="flex items-center justify-between py-2.5 px-3 bg-muted/30 rounded-xl">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-violet-100 flex items-center justify-center">
                    <Package size={11} className="text-violet-600" />
                  </div>
                  <span className="text-xs text-foreground">Paquete adicional</span>
                </div>
                <span className="text-xs font-700 text-foreground">{docsFromPackage} docs</span>
              </div>
            </div>

            <button className="w-full bg-muted/60 hover:bg-muted text-foreground text-xs font-600 py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 border border-border">
              <ShoppingBag size={13} className="text-muted-foreground" />
              Comprar paquete adicional
            </button>
          </div>
        </div>
      </div>

      {/* Upgrade banner */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <h3 className="font-700 text-base">{upgradePlan.name}</h3>
              <p className="text-sm text-blue-100 mt-0.5">Desbloquea todo el potencial de DocuBox con documentos y firmas ilimitadas.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {upgradePlan.features.slice(0, 5).map((f) => (
                  <span key={f} className="flex items-center gap-1 text-xs text-blue-100">
                    <CheckCircle size={11} className="text-blue-200" />{f}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-2 flex-shrink-0">
            <div className="text-right">
              <p className="text-2xl font-800">{upgradePlan.price}</p>
              <p className="text-xs text-blue-200">/ {upgradePlan.period}</p>
            </div>
            <button className="bg-white text-blue-600 text-sm font-700 px-5 py-2 rounded-xl hover:bg-blue-50 transition-colors whitespace-nowrap">
              Actualizar ahora
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Historial Tab ──────────────────────────────────────────────────────────────

interface HistorialTabProps {
  history: SubscriptionHistoryItem[];
  loading: boolean;
}

function HistorialTab({ history, loading }: HistorialTabProps) {
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);

  const purchases: Purchase[] = history.map((item, i) => mapHistoryToPurchase(item, i));

  const totalPaid = purchases
    .filter((p) => p.status === 'Pagado')
    .reduce((sum, p) => sum + parseFloat(p.amount.replace(/[$,]/g, '')), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        {[
          { label: 'Total transacciones', value: purchases.length.toString(), icon: Receipt, color: 'text-primary', bg: 'bg-primary/10' },
          { label: 'Pagadas', value: purchases.filter(p => p.status === 'Pagado').length.toString(), icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Fallidas', value: purchases.filter(p => p.status === 'Fallido').length.toString(), icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Total pagado', value: `$${totalPaid.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`, icon: CreditCard, color: 'text-blue-600', bg: 'bg-blue-50' },
        ].map((stat) => {
          const StatIcon = stat.icon;
          return (
            <div key={stat.label} className="bg-white border border-border rounded-xl p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center flex-shrink-0`}>
                <StatIcon size={16} className={stat.color} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-base font-700 text-foreground tabular-nums">{stat.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <ShoppingBag size={15} className="text-primary" />
            </div>
            <div>
              <h3 className="font-700 text-sm text-foreground">Historial de Compras</h3>
              <p className="text-xs text-muted-foreground">{purchases.length} transacciones registradas</p>
            </div>
          </div>
        </div>

        {purchases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <ShoppingBag size={20} className="text-muted-foreground" />
            </div>
            <p className="text-sm font-600 text-foreground">Sin historial de compras</p>
            <p className="text-xs text-muted-foreground mt-1">Tu historial de transacciones aparecerá aquí.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-border">
                  <th className="text-left px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Folio</th>
                  <th className="text-left px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Fecha</th>
                  <th className="text-left px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Descripción</th>
                  <th className="text-right px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Monto</th>
                  <th className="text-center px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Estado</th>
                  <th className="text-center px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Factura</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {purchases.map((p) => {
                  const sc = statusConfig[p.status];
                  return (
                    <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{p.id}</td>
                      <td className="px-5 py-3.5 text-sm text-foreground whitespace-nowrap">{p.date}</td>
                      <td className="px-5 py-3.5 text-sm text-foreground">{p.description}</td>
                      <td className="px-5 py-3.5 text-right font-700 text-foreground tabular-nums">{p.amount}</td>
                      <td className="px-5 py-3.5 text-center">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-600 px-2.5 py-1 rounded-full ${sc.bg} ${sc.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                          {p.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {p.status === 'Pagado' ? (
                          <button
                            onClick={() => setSelectedPurchase(p)}
                            className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-600 px-3 py-1.5 rounded-lg hover:bg-primary/20 transition-colors"
                          >
                            <Download size={12} />
                            Ver detalle
                          </button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedPurchase && (
        <InvoiceModal purchase={selectedPurchase} onClose={() => setSelectedPurchase(null)} />
      )}
    </>
  );
}

// ── Consumos Tab ───────────────────────────────────────────────────────────────

interface ConsumosTabProps {
  subscription: Subscription | null;
  loading: boolean;
}

function ConsumosTab({ subscription, loading }: ConsumosTabProps) {
  const docsUsed = subscription?.documents_used || 0;
  const docsTotal = subscription?.documents_limit || 2;

  const consumos: Metric[] = [
    { label: 'Documentos', used: docsUsed, total: docsTotal, unit: 'docs', icon: FileText, color: 'bg-blue-500', bgColor: 'bg-blue-50', textColor: 'text-blue-600' },
    { label: 'Firmas Electrónicas', used: 0, total: Infinity, unit: 'firmas', icon: PenTool, color: 'bg-violet-500', bgColor: 'bg-violet-50', textColor: 'text-violet-600' },
    { label: 'Almacenamiento', used: 0, total: 1, unit: 'GB', icon: HardDrive, color: 'bg-emerald-500', bgColor: 'bg-emerald-50', textColor: 'text-emerald-600' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {consumos.map((m) => {
          const pct = m.total === Infinity ? null : Math.round((m.used / m.total) * 100);
          const MIcon = m.icon;
          const isHigh = pct !== null && pct >= 80;
          const isMed = pct !== null && pct >= 60 && pct < 80;
          const valueLabel = m.total === Infinity
            ? `${m.used} ${m.unit}`
            : `${m.used} / ${m.total} ${m.unit}`;
          return (
            <div key={m.label} className="bg-white border border-border rounded-xl p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg ${m.bgColor} flex items-center justify-center flex-shrink-0`}>
                <MIcon size={16} className={m.textColor} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className="text-base font-700 text-foreground tabular-nums">{valueLabel}</p>
                {pct !== null ? (
                  <div className="mt-1.5">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isHigh ? 'bg-red-500' : isMed ? 'bg-amber-500' : m.color}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className={`text-xs mt-0.5 font-600 ${isHigh ? 'text-red-600' : isMed ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {pct}% usado
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-600 font-600 mt-0.5 flex items-center gap-1">
                    <CheckCircle size={11} />Ilimitado
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <BarChart3 size={15} className="text-primary" />
          </div>
          <div>
            <h3 className="font-700 text-sm text-foreground">Detalle de Consumo</h3>
            <p className="text-xs text-muted-foreground">Período actual de suscripción</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Recurso</th>
                <th className="text-right px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Usado</th>
                <th className="text-right px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Límite</th>
                <th className="text-right px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide">Disponible</th>
                <th className="text-left px-5 py-3 text-xs font-600 text-muted-foreground uppercase tracking-wide w-44">Uso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {consumos.map((m) => {
                const pct = m.total === Infinity ? null : Math.round((m.used / m.total) * 100);
                const available = m.total === Infinity ? '∞' : `${m.total - m.used} ${m.unit}`;
                const isHigh = pct !== null && pct >= 80;
                const isMed = pct !== null && pct >= 60 && pct < 80;
                const MIcon = m.icon;
                return (
                  <tr key={m.label} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-lg ${m.bgColor} flex items-center justify-center`}>
                          <MIcon size={13} className={m.textColor} />
                        </div>
                        <span className="font-600 text-foreground text-sm">{m.label}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right text-foreground tabular-nums">{m.used} {m.unit}</td>
                    <td className="px-5 py-4 text-right text-muted-foreground">{m.total === Infinity ? 'Ilimitado' : `${m.total} ${m.unit}`}</td>
                    <td className="px-5 py-4 text-right font-600 text-foreground tabular-nums">{available}</td>
                    <td className="px-5 py-4">
                      {pct !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${isHigh ? 'bg-red-500' : isMed ? 'bg-amber-500' : m.color}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-xs font-600 w-8 text-right ${isHigh ? 'text-red-600' : isMed ? 'text-amber-600' : 'text-muted-foreground'}`}>{pct}%</span>
                        </div>
                      ) : (
                        <span className="text-xs text-emerald-600 font-600 flex items-center gap-1">
                          <CheckCircle size={11} />Ilimitado
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'plan',      label: 'Tu Plan Actual',      icon: Star        },
  { id: 'historial', label: 'Historial de Compras', icon: ShoppingBag },
  { id: 'consumos',  label: 'Consumos',             icon: BarChart3   },
  { id: 'planes',    label: 'Planes y Paquetes',    icon: Layers      },
];

export default function FacturacionPage() {
  const [activeTab, setActiveTab] = useState<Tab>('plan');
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [history, setHistory] = useState<SubscriptionHistoryItem[]>([]);
  const [loadingSub, setLoadingSub] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const { user } = useAuth();
  const supabase = createClient();

  const fetchSubscription = useCallback(async () => {
    if (!user) { setLoadingSub(false); return; }
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select(`
          *,
          subscription_plans (
            id, name, slug, description, price, interval, documents_included, features
          )
        `)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Subscription fetch error:', error.message);
      }
      setSubscription(data || null);
    } catch (err) {
      console.error('Subscription error:', err);
    } finally {
      setLoadingSub(false);
    }
  }, [user]);

  const fetchHistory = useCallback(async () => {
    if (!user) { setLoadingHistory(false); return; }
    try {
      const { data, error } = await supabase
        .from('subscription_history')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('History fetch error:', error.message);
      }
      setHistory(data || []);
    } catch (err) {
      console.error('History error:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSubscription();
    fetchHistory();
  }, [fetchSubscription, fetchHistory]);

  return (
    <AppLayout noPadding>
      <div className="px-4 sm:px-6 lg:px-8 pt-2 pb-4 md:pb-6 space-y-6 w-full min-h-[calc(100vh-8rem)]">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <CreditCard size={24} className="text-primary" />
              Facturación y Planes
            </h1>
            <p className="text-sm text-muted-foreground mt-1">Gestiona tu suscripción, revisa tus compras y monitorea tus consumos.</p>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 bg-muted/50 p-1 rounded-xl border border-border overflow-x-auto scrollbar-thin">
          {tabs.map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-600 transition-all duration-150 whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <TabIcon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="fade-in">
          {activeTab === 'plan'      && <PlanTab subscription={subscription} loading={loadingSub} onUpgrade={() => setActiveTab('planes')} />}
          {activeTab === 'historial' && <HistorialTab history={history} loading={loadingHistory} />}
          {activeTab === 'consumos'  && <ConsumosTab subscription={subscription} loading={loadingSub} />}
          {activeTab === 'planes'    && <PlanesTab onUpgrade={() => setActiveTab('planes')} onPlanChanged={() => { fetchSubscription(); fetchHistory(); setActiveTab('plan'); }} />}
        </div>
      </div>
    </AppLayout>
  );
}
