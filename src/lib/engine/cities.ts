/**
 * Pakistani cities for the New Search screen (SRS screen 3, step 3).
 * Coordinates are city centres, used only when a radius is set. Areas let a large city be split
 * into several searches for fuller coverage, because Google returns at most 60 places per query.
 */
export type Province = "Punjab" | "Sindh" | "Khyber Pakhtunkhwa" | "Balochistan" | "Islamabad" | "Gilgit-Baltistan" | "Azad Kashmir";

export type City = { name: string; province: Province; lat: number; lng: number; areas?: string[] };

export const CITIES: City[] = [
  { name: "Karachi", province: "Sindh", lat: 24.8607, lng: 67.0011, areas: ["Clifton", "DHA", "Gulshan-e-Iqbal", "Gulistan-e-Johar", "North Nazimabad", "Nazimabad", "PECHS", "Saddar", "Korangi", "Malir", "Federal B Area", "Bahadurabad", "Scheme 33", "Orangi Town", "Landhi", "Gulberg Karachi"] },
  { name: "Lahore", province: "Punjab", lat: 31.5204, lng: 74.3587, areas: ["Gulberg", "DHA Lahore", "Johar Town", "Model Town", "Bahria Town Lahore", "Wapda Town", "Garden Town", "Cantt Lahore", "Iqbal Town", "Samanabad", "Faisal Town", "Township", "Valencia", "Allama Iqbal Town", "Shadman", "Raiwind Road"] },
  { name: "Islamabad", province: "Islamabad", lat: 33.6844, lng: 73.0479, areas: ["F-6", "F-7", "F-8", "F-10", "F-11", "G-6", "G-8", "G-9", "G-10", "G-11", "I-8", "I-10", "E-11", "Bahria Town Islamabad", "DHA Islamabad", "Bani Gala"] },
  { name: "Rawalpindi", province: "Punjab", lat: 33.5651, lng: 73.0169, areas: ["Saddar Rawalpindi", "Satellite Town", "Chaklala", "Westridge", "Bahria Town Rawalpindi", "Peshawar Road", "Murree Road", "Adiala Road"] },
  { name: "Faisalabad", province: "Punjab", lat: 31.4504, lng: 73.135, areas: ["D Ground", "Peoples Colony", "Madina Town", "Susan Road", "Gulberg Faisalabad", "Jinnah Colony", "Samanabad Faisalabad", "Canal Road Faisalabad"] },
  { name: "Multan", province: "Punjab", lat: 30.1575, lng: 71.5249, areas: ["Cantt Multan", "Gulgasht", "Shah Rukn-e-Alam", "Bosan Road", "Model Town Multan", "New Multan"] },
  { name: "Peshawar", province: "Khyber Pakhtunkhwa", lat: 34.0151, lng: 71.5249, areas: ["Hayatabad", "University Town", "Saddar Peshawar", "Gulbahar", "Dalazak Road", "Warsak Road"] },
  { name: "Gujranwala", province: "Punjab", lat: 32.1877, lng: 74.1945 },
  { name: "Sialkot", province: "Punjab", lat: 32.4945, lng: 74.5229 },
  { name: "Hyderabad", province: "Sindh", lat: 25.396, lng: 68.3578 },
  { name: "Quetta", province: "Balochistan", lat: 30.1798, lng: 66.975 },
  { name: "Bahawalpur", province: "Punjab", lat: 29.3956, lng: 71.6836 },
  { name: "Sargodha", province: "Punjab", lat: 32.0836, lng: 72.6711 },
  { name: "Sukkur", province: "Sindh", lat: 27.7052, lng: 68.8574 },
  { name: "Larkana", province: "Sindh", lat: 27.5598, lng: 68.2264 },
  { name: "Sheikhupura", province: "Punjab", lat: 31.7167, lng: 73.985 },
  { name: "Rahim Yar Khan", province: "Punjab", lat: 28.4202, lng: 70.2952 },
  { name: "Jhang", province: "Punjab", lat: 31.2681, lng: 72.3181 },
  { name: "Dera Ghazi Khan", province: "Punjab", lat: 30.0459, lng: 70.6403 },
  { name: "Gujrat", province: "Punjab", lat: 32.5736, lng: 74.0789 },
  { name: "Sahiwal", province: "Punjab", lat: 30.6682, lng: 73.1114 },
  { name: "Wah Cantt", province: "Punjab", lat: 33.7715, lng: 72.7512 },
  { name: "Mardan", province: "Khyber Pakhtunkhwa", lat: 34.1986, lng: 72.0404 },
  { name: "Kasur", province: "Punjab", lat: 31.1187, lng: 74.4507 },
  { name: "Okara", province: "Punjab", lat: 30.8138, lng: 73.4534 },
  { name: "Mingora", province: "Khyber Pakhtunkhwa", lat: 34.7717, lng: 72.3602 },
  { name: "Nawabshah", province: "Sindh", lat: 26.2442, lng: 68.41 },
  { name: "Chiniot", province: "Punjab", lat: 31.72, lng: 72.9789 },
  { name: "Kotri", province: "Sindh", lat: 25.3657, lng: 68.3084 },
  { name: "Kamoke", province: "Punjab", lat: 31.9747, lng: 74.2233 },
  { name: "Hafizabad", province: "Punjab", lat: 32.0712, lng: 73.6881 },
  { name: "Sadiqabad", province: "Punjab", lat: 28.3091, lng: 70.1293 },
  { name: "Mirpur Khas", province: "Sindh", lat: 25.5276, lng: 69.0111 },
  { name: "Burewala", province: "Punjab", lat: 30.1667, lng: 72.65 },
  { name: "Kohat", province: "Khyber Pakhtunkhwa", lat: 33.5869, lng: 71.4429 },
  { name: "Khanewal", province: "Punjab", lat: 30.3017, lng: 71.932 },
  { name: "Dera Ismail Khan", province: "Khyber Pakhtunkhwa", lat: 31.8314, lng: 70.9019 },
  { name: "Abbottabad", province: "Khyber Pakhtunkhwa", lat: 34.1688, lng: 73.2215 },
  { name: "Muzaffargarh", province: "Punjab", lat: 30.0736, lng: 71.1805 },
  { name: "Mandi Bahauddin", province: "Punjab", lat: 32.587, lng: 73.4912 },
  { name: "Jhelum", province: "Punjab", lat: 32.9405, lng: 73.7276 },
  { name: "Attock", province: "Punjab", lat: 33.7667, lng: 72.3667 },
  { name: "Vehari", province: "Punjab", lat: 30.0453, lng: 72.3489 },
  { name: "Gwadar", province: "Balochistan", lat: 25.1216, lng: 62.3254 },
  { name: "Turbat", province: "Balochistan", lat: 26.0023, lng: 63.044 },
  { name: "Khuzdar", province: "Balochistan", lat: 27.8, lng: 66.6167 },
  { name: "Gilgit", province: "Gilgit-Baltistan", lat: 35.9208, lng: 74.3089 },
  { name: "Skardu", province: "Gilgit-Baltistan", lat: 35.2971, lng: 75.6333 },
  { name: "Muzaffarabad", province: "Azad Kashmir", lat: 34.37, lng: 73.4711 },
  { name: "Mirpur", province: "Azad Kashmir", lat: 33.1478, lng: 73.7517 },
];

export const PROVINCES: Province[] = ["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Islamabad", "Gilgit-Baltistan", "Azad Kashmir"];

export type CityGroup = { name: string; cities: string[] };

/** Built-in groups, one per province. Admins can add more on the Settings screen (search.city_groups). */
export const PROVINCE_GROUPS: CityGroup[] = PROVINCES.map((p) => ({
  name: p,
  cities: CITIES.filter((c) => c.province === p).map((c) => c.name),
}));

export function findCity(name: string): City | undefined {
  return CITIES.find((c) => c.name.toLowerCase() === name.toLowerCase());
}
