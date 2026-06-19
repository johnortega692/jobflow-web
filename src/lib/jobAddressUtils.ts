/** Parse city / state / zip lines — port of desktop ``job_address_utils.parse_city_state_zip_line``. */

const STATE_NAME_TO_ABBREV: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

function stateTokenToAbbrev(token: string): string {
  const t = token.trim().replace(/\.$/, "");
  if (!t) return "";
  if (t.length === 2) return t.toUpperCase();
  return STATE_NAME_TO_ABBREV[t.toLowerCase()] ?? t;
}

export function parseCityStateZipLine(text: string): [city: string, zip: string, state: string] {
  const raw = text.trim();
  if (!raw) return ["", "", ""];

  const zipM = raw.match(/(\d{5}(?:-\d{4})?)\s*$/);
  if (!zipM) return [raw, "", ""];

  const zip = zipM[1]!;
  const before = raw.slice(0, zipM.index).trim().replace(/,$/, "");
  if (!before) return ["", zip, ""];

  const cityCommaState = before.match(/^(.+?),\s*([A-Za-z][A-Za-z.]+)\s*$/);
  if (cityCommaState) {
    return [cityCommaState[1]!.trim(), zip, stateTokenToAbbrev(cityCommaState[2]!)];
  }

  const cityState = before.match(/^(.+?)\s+([A-Za-z]{2})\.?\s*$/);
  if (cityState) {
    return [cityState[1]!.trim(), zip, cityState[2]!.toUpperCase()];
  }

  const lowBefore = before.toLowerCase();
  const names = Object.keys(STATE_NAME_TO_ABBREV).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (lowBefore.endsWith(name)) {
      const city = before.slice(0, -name.length).trim().replace(/,$/, "");
      if (city) return [city, zip, STATE_NAME_TO_ABBREV[name]!];
    }
  }

  return [before, zip, ""];
}
