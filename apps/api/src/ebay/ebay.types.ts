export type EbayMarketplaceId =
  | 'EBAY_US'
  | 'EBAY_GB'
  | 'EBAY_DE'
  | 'EBAY_AU'
  | 'EBAY_CA'
  | 'EBAY_FR'
  | 'EBAY_IT'
  | 'EBAY_ES';

export type EbayBrowseItem = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  itemWebUrl?: string;
  itemAffiliateWebUrl?: string;
  shortDescription?: string;
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  price?: { value?: string; currency?: string };
};

