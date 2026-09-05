'use client';

import { Map as MapIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui';
import { InsetRow } from '@/components/ui/InsetList';
import { useMapPrefs } from '@/lib/mapPrefs';

/**
 * Settings → "colour routes by pace". One boolean, so it lives on the landing
 * with the switch right there rather than behind a drill-in: a preference you
 * have to open a screen to find is a preference nobody changes.
 *
 * It takes effect immediately on every map already mounted (see `useMapPrefs`),
 * including the thumbnails on the feed behind this screen.
 */
export function MapPrefsRow() {
  const t = useTranslations('settings');
  const [{ paceColors }, setMapPrefs] = useMapPrefs();

  return (
    <InsetRow
      icon={MapIcon}
      iconBg="bg-band-3"
      label={t('mapPaceColors')}
      sublabel={t('mapPaceColorsDesc')}
      trailing={
        <Switch
          checked={paceColors}
          onChange={(next) => setMapPrefs({ paceColors: next })}
          activeColor="bg-band-3"
          ariaLabel={t('mapPaceColors')}
        />
      }
    />
  );
}
