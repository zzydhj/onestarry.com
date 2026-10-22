/**
 * SKU gallery / picker layout knobs (single source of truth).
 * The UI adapts automatically once counts cross these thresholds — this is what
 * keeps a 12-colour product and a 100-colour product using the SAME components.
 */
export const SKU_LAYOUT = {
    /** above this many colours → swatches become searchable + scroll */
    COLOR_SEARCH: 10,
    COLOR_SCROLL: 10,
    /** how many colours per row group the swatch grid shows before "show more" */
    COLOR_PAGE: 24,
    /** gallery thumbnail strip cap before overflow "+N" */
    MAX_STRIP: 10,
    /** "All photos" grid: colour groups rendered per page (× sizes each) */
    GRID_GROUPS_PER_PAGE: 6,
    /** at/above this many SKUs the picker switches to "multi-pick" staging (per-combo qty + badges) */
    MULTI_PICK_MIN_SKUS: 10,
} as const
