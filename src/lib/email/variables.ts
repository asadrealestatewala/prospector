/** Template variables (SRS screen 9). Kept apart from the renderer so the browser can list them. */
export const TEMPLATE_VARIABLES = [
  { key: "business_name", label: "Business name", sample: "Bright Future School" },
  { key: "city", label: "City", sample: "Lahore" },
  { key: "contact_name", label: "Contact name", sample: "" },
  { key: "product_name", label: "Product name", sample: "Classwell" },
  { key: "product_price", label: "Product price", sample: "PKR 20 per student" },
  { key: "sender_name", label: "Sender name", sample: "Asad" },
] as const;
export type VariableKey = (typeof TEMPLATE_VARIABLES)[number]["key"];
export type TemplateValues = Partial<Record<VariableKey, string | null>>;

