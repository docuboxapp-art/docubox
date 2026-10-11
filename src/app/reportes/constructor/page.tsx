import ReportBuilder from './ReportBuilder';

export default async function ReportBuilderPage({ searchParams }: { searchParams: Promise<{ report?: string; preset?: string }> }) {
  const { report, preset } = await searchParams;
  return <ReportBuilder reportId={report || null} presetId={preset || null} />;
}
