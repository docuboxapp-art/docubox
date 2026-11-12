/** Account sign-out must not replace an independently authorized case invitation. */
export function redirectExpiredAccountSession(location: Pick<Location, 'pathname' | 'assign'>) {
  if (location.pathname.startsWith('/expediente/')) return;
  location.assign('/login?reason=session-expired');
}
