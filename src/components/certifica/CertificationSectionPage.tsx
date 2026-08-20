'use client';

import Link from 'next/link';
import { ArrowRight, Construction, Plus } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { CertificationHeader, CertificationWorkspace } from './CertificationUI';

export function CertificationSectionPage({ title, description, items, action }: { title: string; description: string; items: Array<{ title: string; description: string; href?: string; value?: string }>; action?: { label: string; href: string } }) {
  return <AppLayout noPadding><CertificationWorkspace><CertificationHeader title={title} description={description} actions={action ? <Link href={action.href} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-semibold text-white"><Plus size={15} />{action.label}</Link> : undefined} /><section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="divide-y divide-slate-200">{items.map((item) => { const content = <><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-primary"><Construction size={17} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.description}</span></span>{item.value && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{item.value}</span>}{item.href && <ArrowRight size={15} className="text-slate-400" />}</>; return item.href ? <Link key={item.title} href={item.href} className="flex items-center gap-3 p-4 hover:bg-slate-50">{content}</Link> : <div key={item.title} className="flex items-center gap-3 p-4">{content}</div>; })}</div></section></CertificationWorkspace></AppLayout>;
}

