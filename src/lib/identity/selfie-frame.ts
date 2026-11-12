/** Preserve the camera frame for server-side biometrics; the oval is only a visual guide. */
export function captureSelfieFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): string | null {
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  // Do not crop using CSS coordinates (object-fit: cover changes that mapping),
  // stretch or mirror the evidence sent to the provider.
  context.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}
