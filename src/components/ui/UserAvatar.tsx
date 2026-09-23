'use client';

import React, { useState } from 'react';

interface UserAvatarProps {
  src?: string | null;
  alt: string;
  className: string;
  imageClassName?: string;
  fallback: React.ReactNode;
}

export default function UserAvatar({
  src,
  alt,
  className,
  imageClassName = 'h-full w-full object-cover',
  fallback,
}: UserAvatarProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showImage = Boolean(src && failedSource !== src);

  return (
    <div className={`overflow-hidden rounded-full ${className}`}>
      {showImage ? (
        <img
          src={src || ''}
          alt={alt}
          className={imageClassName}
          onError={() => setFailedSource(src || null)}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
