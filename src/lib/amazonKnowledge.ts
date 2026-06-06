const LISTING_REFERENCE_NOTES = [
  'Source summary: current project knowledge files for Amazon product images and A+ image sizing. Treat this as reference material for judgment, not a fixed creative template.',
  'Every product needs a compliant MAIN image; a strong gallery usually adds about 6 secondary images and may also include video outside this image workflow.',
  'Image technical baseline: use clear, non-pixelated product images; supported still formats include JPEG/JPG, PNG, TIFF, and non-animated GIF; the longest side should be 500-10,000 px.',
  'MAIN image reference: accurately show the real sold product with truthful color, proportion, quantity, and included accessories; use a seamless pure white background RGB 255,255,255; product fills about 85% of the frame; keep the whole product inside the frame without cropping.',
  'MAIN image exclusions: no text, logo, watermark, border, color block, graphic overlay, badge, prop, support stand, confusing accessory, extra item, duplicate product view, or packaging unless packaging is an actual product feature.',
  'All listing images should match the product title and only show what is sold or needed to explain the sold item. Avoid nudity or sexually suggestive content, buyer reviews, five-star ratings, pricing, coupons, free shipping, seller-specific claims, unsupported claims, and variant-image text/pricing.',
  'Do not use Amazon, Prime, Alexa, Amazon Choice, Premium Choice, Best Seller, hot-sale badges, marketplace marks, or any lookalike logo, badge, or page element.',
  'Secondary images may use compliant lifestyle, detail, scale, contents, comparison-within-product, or use-step concepts when supported by the listing and references. On-image copy should be concise, US-English, defensible, and readable on mobile.',
]

const APLUS_REFERENCE_NOTES = [
  'Source summary: current project knowledge files for Amazon A+ content rules and US A+ module image sizes. Treat this as reference material for judgment, not a fixed creative template.',
  'A+ technical baseline: plan RGB JPG/PNG/BMP assets, at least 72 dpi, sharp and non-blurry, under 2 MB per upload, no animation, no watermark, and no tiny text that cannot be read on mobile.',
  'Standard A+ upload size references: Header Banner 970x300, Single Image 970x600, Logo Image 600x180, Highlight Tile 220x220, Comparison Thumbnail 150x300.',
  'Premium A+ upload size references: Hero Banner 1464x600, Single/Feature Image 970x600, Logo Image 600x180, Brand Story module image around 463x625.',
  'Design reference: keep key content in a central safe area, use mobile-readable copy, clear hierarchy, balanced spacing, and coherent lighting, color palette, composition logic, material treatment, and typography direction across modules.',
  'A+ should be unique to the product and brand story; avoid simply reusing the same images already planned for the listing carousel.',
  'A+ may use one helpful brand mark and may use a Logo Image module for an existing brand mark; do not invent partner logos or extra marks.',
  'Trademark/copyright symbols such as TM, ®, or © should only appear when already present on the product packaging or as part of a real logo; otherwise remove standalone symbols.',
  'A+ copy and images should avoid prices, discounts, coupons, free shipping, QR codes, phone numbers, email addresses, postal addresses, external URLs, hyperlinks, customer reviews, star ratings, competitor mentions, seller authorization claims, unsupported guarantees, and aggressive purchase calls to action such as buy now or add to cart.',
  'Avoid unsupported awards, certifications, eco claims, medical/cure/prevention claims, satisfaction guarantees, exaggerated claims such as best/top-rated/bestseller, and time-sensitive hype such as new/latest/sale unless the listing provides defensible substantiation and the placement is allowed.',
  'Do not mimic Amazon page UI or use Amazon, Prime, Alexa, Amazon Choice, Premium Choice, Best Seller, hot-sale badges, or lookalike marketplace marks.',
]

function formatReferenceMaterial(title: string, notes: readonly string[]) {
  return [
    title,
    ...notes.map((note) => `- ${note}`),
  ].join('\n')
}

export function formatAmazonListingReferenceMaterial() {
  return formatReferenceMaterial('Amazon Listing reference material for the planner:', LISTING_REFERENCE_NOTES)
}

export function formatAmazonAPlusReferenceMaterial() {
  return formatReferenceMaterial('Amazon A+ reference material for the planner:', APLUS_REFERENCE_NOTES)
}
