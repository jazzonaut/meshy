/**
 * Coarse "phone-class device" heuristic: a small viewport or a coarse (touch)
 * pointer. Used to pick lighter defaults — fewer particles and a lower render
 * resolution — where the GPU and fill budget are tighter. Conservative on
 * purpose: a touch laptop/tablet trips it too, but the user can always dial the
 * particle count back up.
 */
export function isMobileLike(): boolean {
  return (
    window.matchMedia('(max-width: 640px)').matches ||
    window.matchMedia('(pointer: coarse)').matches
  );
}
