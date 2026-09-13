// Backwards-compatible alias for clients still using the original route.
import { POST as unlockPOST } from '../view-access/unlock/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = unlockPOST;
