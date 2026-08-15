'use client';

import React, { memo, useMemo } from 'react';
import AppIcon from './AppIcon';
import AppImage from './AppImage';

interface AppLogoProps {
  src?: string; // Image source (optional)
  darkSrc?: string; // Alternate image for dark mode
  variant?: 'auto' | 'dark' | 'light';
  iconName?: string; // Icon name when no image
  size?: number; // Size for icon/image
  className?: string; // Additional classes
  onClick?: () => void; // Click handler
}

const DEFAULT_LOGO = '/assets/images/docubox-logo-2026.png';
const DEFAULT_DARK_MODE_LOGO = '/assets/images/docubox-logo-2026-dark-mode.png';

const AppLogo = memo(function AppLogo({
  src = DEFAULT_LOGO,
  darkSrc,
  variant = 'auto',
  iconName = 'SparklesIcon',
  size = 32,
  className = '',
  onClick,
}: AppLogoProps) {
  const resolvedDarkSrc = darkSrc ?? (src === DEFAULT_LOGO ? DEFAULT_DARK_MODE_LOGO : src);

  // Memoize className calculation
  const containerClassName = useMemo(() => {
    const classes = ['flex items-center'];
    if (onClick) classes.push('cursor-pointer hover:opacity-80 transition-opacity');
    if (className) classes.push(className);
    return classes.join(' ');
  }, [onClick, className]);

  return (
    <div className={containerClassName} onClick={onClick}>
      {/* Show image if src provided, otherwise show icon */}
      {src && variant === 'auto' && resolvedDarkSrc !== src ? (
        <>
          <AppImage
            src={src}
            alt="Logo"
            width={126}
            height={24}
            className="flex-shrink-0 object-contain dark:hidden"
            priority={true}
            unoptimized={src.endsWith('.svg')}
            showLoadingBackground={false}
          />
          <AppImage
            src={resolvedDarkSrc}
            alt="Logo"
            width={126}
            height={24}
            className="hidden flex-shrink-0 object-contain dark:block"
            priority={true}
            unoptimized={resolvedDarkSrc.endsWith('.svg')}
            showLoadingBackground={false}
          />
        </>
      ) : src ? (
        <AppImage
          src={variant === 'light' ? resolvedDarkSrc : src}
          alt="Logo"
          width={126}
          height={24}
          className="flex-shrink-0 object-contain"
          priority={true}
          unoptimized={(variant === 'light' ? resolvedDarkSrc : src).endsWith('.svg')}
          showLoadingBackground={false}
        />
      ) : (
        <AppIcon name={iconName} size={size} className="flex-shrink-0" />
      )}
    </div>
  );
});

export default AppLogo;
