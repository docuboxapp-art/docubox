export function activityErrorMessage(payload: unknown): string {
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  if (body.error === 'SESSION_POLICY_UNAVAILABLE')
    return 'La validación de sesión no está disponible temporalmente. Intenta nuevamente en unos momentos.';
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  if (typeof body.error === 'string' && body.error.trim() && !/^[A-Z][A-Z0-9_]+$/.test(body.error))
    return body.error;
  return 'No se pudo cargar la bandeja. Intenta nuevamente.';
}
