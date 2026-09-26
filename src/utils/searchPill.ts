/** Why the phone search bar might fold back into its Search pill. */
export type SearchCollapseReason = 'picked' | 'close' | 'escape' | 'blur';

/**
 * Phones only: whether the expanded search bar folds back into the pill.
 * Picking a place, the close button and Escape always fold it. Losing focus
 * folds it only when nothing is typed and no results are showing, because
 * tapping a result blurs the input before its click lands.
 */
export function shouldCollapseSearch(reason: SearchCollapseReason, query: string, resultsOpen: boolean): boolean {
  if (reason !== 'blur') return true;
  return query.trim() === '' && !resultsOpen;
}
