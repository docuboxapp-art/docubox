'use client';

import { createContext } from 'react';
import type { WorkspaceDocumentTab } from '@/lib/documents/workspace-actions';

export const DocumentViewerActionContext = createContext<{
  documentId: string;
  tab: WorkspaceDocumentTab;
  onUpdated: () => void;
  onSavingChange: (saving: boolean) => void;
} | null>(null);
