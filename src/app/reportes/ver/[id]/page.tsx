import ReportViewer from './ReportViewer';

export default async function ReportViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportViewer reportId={id} />;
}
