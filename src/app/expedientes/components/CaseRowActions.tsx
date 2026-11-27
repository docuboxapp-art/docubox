'use client';

import { ChevronRight, Eye, Folder, Star } from 'lucide-react';
import { WorkspaceRowActions } from '@/components/WorkspaceRowActions';

export default function CaseRowActions({
  id,
  title,
  favorite,
  moveDisabled,
  favoriteDisabled,
  onMove,
  onFavorite,
  onPreview,
}: {
  id: string;
  title: string;
  favorite: boolean;
  moveDisabled: boolean;
  favoriteDisabled: boolean;
  onMove: () => void;
  onFavorite: () => void;
  onPreview: () => void;
}) {
  return (
    <WorkspaceRowActions
      title={title}
      className="case-row-actions"
      menuClassName="workspace-action-menu"
      actions={[
        { label: 'Consultar expediente', icon: ChevronRight, href: `/expedientes/${id}` },
        { label: 'Vista previa', icon: Eye, onSelect: onPreview },
        { label: 'Mover a carpeta', icon: Folder, onSelect: onMove, disabled: moveDisabled },
        {
          label: favorite ? 'Quitar de favoritos' : 'Agregar a favoritos',
          icon: Star,
          iconClassName: favorite ? 'text-amber-500' : undefined,
          fillIcon: favorite,
          onSelect: onFavorite,
          disabled: favoriteDisabled,
        },
      ]}
    />
  );
}
