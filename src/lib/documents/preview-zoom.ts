/** Fit the rendered preview without changing document or field coordinates. */
export function fitPreviewZoom(
  viewport: HTMLElement | null,
  currentZoom: number,
  minimum = 25,
  maximum = 200
) {
  const sheet = viewport?.querySelector<HTMLElement>('[data-document-preview-sheet], canvas');
  const width = sheet?.getBoundingClientRect().width;
  if (!viewport || !width || width <= 0 || sheet.dataset.previewReady === 'false') return currentZoom;
  const renderedZoom = Number(sheet.dataset.previewZoom) || currentZoom;
  return Math.max(
    minimum,
    Math.min(maximum, Math.floor(((viewport.clientWidth - 32) / width) * renderedZoom))
  );
}
