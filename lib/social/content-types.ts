/** Client-safe label list for SocialContentType — shared by every dashboard page that offers the picker. */

import type { SocialContentType } from './types';

export const CONTENT_TYPE_OPTIONS: { value: SocialContentType; label: string }[] = [
  { value: 'gypsum_false_ceiling', label: 'Gypsum False Ceiling' },
  { value: 'pvc_ceiling', label: 'PVC Ceiling' },
  { value: 'wpc_louvers', label: 'WPC Louvers' },
  { value: 'wpc_fluted_panel', label: 'WPC Fluted Panel' },
  { value: 'uv_marble_sheet', label: 'UV Marble Sheet' },
  { value: 'tv_unit', label: 'TV Unit' },
  { value: 'wall_paneling', label: 'Wall Paneling' },
  { value: 'partition', label: 'Partition' },
  { value: 'interior_project', label: 'Interior Project' },
  { value: 'before_after', label: 'Before/After' },
  { value: 'customer_project', label: 'Customer Project' },
  { value: 'interior_tip', label: 'Interior Tip' },
  { value: 'offer', label: 'Offer' },
  { value: 'festival', label: 'Festival' },
  { value: 'faq', label: 'FAQ' },
  { value: 'local_business_promotion', label: 'Local Business Promotion' },
];
