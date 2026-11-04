import type { Product } from "@/components/ui/chips";

/** Default business types per product (SRS screen 3, steps 1 and 2). Users can add custom keywords. */
export const PRODUCT_BUSINESS_TYPES: Record<Product, { label: string; keywords: string[] }> = {
  classwell: { label: "Schools", keywords: ["private school", "academy", "college"] },
  vetlin: { label: "Vet clinics", keywords: ["veterinary clinic", "pet clinic", "animal hospital"] },
  postwala: { label: "Marketing agencies", keywords: ["marketing agency", "digital marketing agency", "social media agency"] },
};

export const BUSINESS_TYPE_PRESETS: { label: string; keywords: string[] }[] = [
  PRODUCT_BUSINESS_TYPES.classwell,
  PRODUCT_BUSINESS_TYPES.vetlin,
  PRODUCT_BUSINESS_TYPES.postwala,
];
