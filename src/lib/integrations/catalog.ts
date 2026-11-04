/** Integration keys shown on the Settings screen (SRS screen 18). No values here, only names. */
export type SecretKey =
  | "google.places_api_key"
  | "google.custom_search_api_key"
  | "resend.api_key"
  | "botlinkd.app_key"
  | "botlinkd.auth_key"
  | "email_verification.api_key";

export type IntegrationId = "google_places" | "google_search" | "resend" | "botlinkd" | "email_verification";

export type Integration = {
  id: IntegrationId;
  name: string;
  description: string;
  secrets: { key: SecretKey; label: string; hint: string }[];
  /** Plain (non-secret) settings the integration needs. */
  plain?: { key: string; label: string; hint: string; options?: { value: string; label: string }[] }[];
  /** True when the test needs the Admin to type a destination, such as their own WhatsApp number. */
  testNeedsTarget?: { label: string; hint: string };
};

export const INTEGRATIONS: Integration[] = [
  {
    id: "google_places",
    name: "Google Places API",
    description: "Finds businesses, phone numbers, websites and ratings.",
    secrets: [{ key: "google.places_api_key", label: "Places API key", hint: "From Google Cloud console, restricted to the Places API (New)." }],
  },
  {
    id: "google_search",
    name: "Google Custom Search API",
    description: "Finds agencies and extra discovery.",
    secrets: [{ key: "google.custom_search_api_key", label: "Custom Search API key", hint: "From Google Cloud console." }],
    plain: [{ key: "google.custom_search_cx", label: "Search engine ID (cx)", hint: "From programmablesearchengine.google.com." }],
  },
  {
    id: "resend",
    name: "Resend",
    description: "Sends email and reports delivered, opened, clicked, bounced and complained.",
    secrets: [{ key: "resend.api_key", label: "Resend API key", hint: "Starts with re_. Full access lets the test list your domains." }],
  },
  {
    id: "botlinkd",
    name: "BotLinkd (WhatsApp)",
    description: "Sends WhatsApp text and approved template messages.",
    secrets: [
      { key: "botlinkd.app_key", label: "App key", hint: "From your BotLinkd dashboard." },
      { key: "botlinkd.auth_key", label: "Auth key", hint: "From your BotLinkd dashboard." },
    ],
    testNeedsTarget: {
      label: "Your own WhatsApp number",
      hint: "BotLinkd has no key-check endpoint, so the test sends one short message to this number.",
    },
  },
  {
    id: "email_verification",
    name: "Email verification",
    description: "Checks addresses before sending. Free checks (format, mail server) always run first; only addresses that pass are sent to the service.",
    plain: [
      {
        key: "email_verification.provider",
        label: "Service",
        hint: "Pick the service you have an account with. Enter its price per check on the Costs screen.",
        options: [
          { value: "millionverifier", label: "MillionVerifier" },
          { value: "zerobounce", label: "ZeroBounce" },
          { value: "neverbounce", label: "NeverBounce" },
        ],
      },
    ],
    secrets: [{ key: "email_verification.api_key", label: "API key", hint: "From the verification service's dashboard." }],
    testNeedsTarget: { label: "An address to check", hint: "The test checks this one address, which uses one credit." },
  },
];

export const SECRET_KEYS = INTEGRATIONS.flatMap((i) => i.secrets.map((s) => s.key));
export const PLAIN_KEYS = INTEGRATIONS.flatMap((i) => (i.plain ?? []).map((p) => p.key));
