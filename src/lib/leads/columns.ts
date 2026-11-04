/** Column chooser on the Leads screen. The hidden list is kept in a cookie per browser. */
export const LEAD_COLUMNS_COOKIE = "prospector_lead_columns";

export const LEAD_COLUMN_LABELS: Record<string, string> = {
  name: "Business name",
  product: "Product",
  city: "City",
  phone: "Phone",
  website: "Website",
  email: "Email",
  whatsapp: "WhatsApp",
  rating: "Rating",
  score: "Score",
  status: "Status",
  source: "Source search",
  last_contacted: "Last contacted",
  owner: "Owner",
  tags: "Tags",
  created: "Date added",
};

export const DEFAULT_HIDDEN = ["tags", "created"];

export const LEAD_LIST_SELECT =
  "id, name, product, city, area, phone, website, email, whatsapp, google_rating, google_review_count, score, status, tags, last_contacted_at, created_at, owner_id, source_search_id, owner:users!leads_owner_id_fkey(full_name), source:searches!leads_source_search_id_fkey(name)";
