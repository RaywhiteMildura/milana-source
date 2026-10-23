/** Australian racecourse coordinates (approximate, for weather lookups) and metadata. */
export interface VenueInfo {
  name: string;
  slug: string;
  state: string;
  lat: number;
  lon: number;
  tz: string;
  aliases?: string[];
  /** TAB venue mnemonic where known */
  tab?: string;
}

const V = (name: string, state: string, lat: number, lon: number, tz: string, aliases: string[] = [], tab?: string): VenueInfo => ({
  name,
  slug: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-'),
  state,
  lat,
  lon,
  tz,
  aliases,
  tab,
});

export const VENUES: VenueInfo[] = [
  V('Flemington', 'VIC', -37.7903, 144.912, 'Australia/Melbourne', ['Flemington Racecourse'], 'FLM'),
  V('Caulfield', 'VIC', -37.8794, 145.0397, 'Australia/Melbourne', ['Caulfield Heath', 'Caulfield Heath Track']),
  V('Moonee Valley', 'VIC', -37.7664, 144.928, 'Australia/Melbourne', ['The Valley', 'Moonee Valley Racecourse']),
  V('Sandown', 'VIC', -37.9497, 145.13, 'Australia/Melbourne', ['Sandown Hillside', 'Sandown Lakeside', 'Sandown Park']),
  V('Geelong', 'VIC', -38.175, 144.383, 'Australia/Melbourne', []),
  V('Ballarat', 'VIC', -37.565, 143.782, 'Australia/Melbourne', ['Ballarat Synthetic']),
  V('Bendigo', 'VIC', -36.764, 144.316, 'Australia/Melbourne', []),
  V('Cranbourne', 'VIC', -38.105, 145.29, 'Australia/Melbourne', []),
  V('Pakenham', 'VIC', -38.096, 145.525, 'Australia/Melbourne', ['Pakenham Synthetic']),
  V('Mornington', 'VIC', -38.23, 145.06, 'Australia/Melbourne', []),
  V('Sale', 'VIC', -38.113, 147.095, 'Australia/Melbourne', []),
  V('Kilmore', 'VIC', -37.3, 144.95, 'Australia/Melbourne', []),
  V('Seymour', 'VIC', -37.03, 145.14, 'Australia/Melbourne', []),
  V('Wangaratta', 'VIC', -36.36, 146.32, 'Australia/Melbourne', []),
  V('Mildura', 'VIC', -34.187, 142.164, 'Australia/Melbourne', []),
  V('Swan Hill', 'VIC', -35.34, 143.55, 'Australia/Melbourne', []),
  V('Warrnambool', 'VIC', -38.37, 142.46, 'Australia/Melbourne', []),
  V('Hamilton', 'VIC', -37.74, 142.02, 'Australia/Melbourne', []),
  V('Echuca', 'VIC', -36.13, 144.74, 'Australia/Melbourne', []),
  V('Kyneton', 'VIC', -37.25, 144.45, 'Australia/Melbourne', []),
  V('Werribee', 'VIC', -37.9, 144.66, 'Australia/Melbourne', []),
  V('Yarra Valley', 'VIC', -37.65, 145.52, 'Australia/Melbourne', ['Yarra Glen']),
  V('Moe', 'VIC', -38.17, 146.25, 'Australia/Melbourne', []),
  V('Traralgon', 'VIC', -38.2, 146.53, 'Australia/Melbourne', []),
  V('Bairnsdale', 'VIC', -37.83, 147.63, 'Australia/Melbourne', []),
  V('Donald', 'VIC', -36.37, 143.0, 'Australia/Melbourne', []),
  V('Horsham', 'VIC', -36.71, 142.21, 'Australia/Melbourne', []),
  V('Ararat', 'VIC', -37.28, 142.93, 'Australia/Melbourne', []),
  V('Stawell', 'VIC', -37.06, 142.77, 'Australia/Melbourne', []),
  V('Benalla', 'VIC', -36.55, 145.98, 'Australia/Melbourne', []),
  V('Wodonga', 'VIC', -36.13, 146.86, 'Australia/Melbourne', []),
  V('Randwick', 'NSW', -33.905, 151.227, 'Australia/Sydney', ['Royal Randwick', 'Randwick Kensington', 'Kensington', 'Randwick Kensington Track']),
  V('Rosehill', 'NSW', -33.8237, 151.0247, 'Australia/Sydney', ['Rosehill Gardens']),
  V('Warwick Farm', 'NSW', -33.917, 150.938, 'Australia/Sydney', []),
  V('Canterbury', 'NSW', -33.911, 151.115, 'Australia/Sydney', ['Canterbury Park']),
  V('Kembla Grange', 'NSW', -34.473, 150.803, 'Australia/Sydney', ['Kembla']),
  V('Newcastle', 'NSW', -32.934, 151.683, 'Australia/Sydney', ['Newcastle Broadmeadow']),
  V('Gosford', 'NSW', -33.43, 151.329, 'Australia/Sydney', []),
  V('Hawkesbury', 'NSW', -33.621, 150.806, 'Australia/Sydney', [], 'HAW'),
  V('Wyong', 'NSW', -33.28, 151.42, 'Australia/Sydney', []),
  V('Scone', 'NSW', -32.05, 150.87, 'Australia/Sydney', [], 'SCO'),
  V('Canberra', 'ACT', -35.338, 149.067, 'Australia/Sydney', ['Thoroughbred Park']),
  V('Eagle Farm', 'QLD', -27.427, 153.068, 'Australia/Brisbane', []),
  V('Doomben', 'QLD', -27.426, 153.062, 'Australia/Brisbane', []),
  V('Gold Coast', 'QLD', -28.006, 153.365, 'Australia/Brisbane', ['Aquis Park', 'Gold Coast Poly', 'Gold Coast Synthetic']),
  V('Sunshine Coast', 'QLD', -26.652, 153.067, 'Australia/Brisbane', ['Corbould Park', 'Caloundra'], 'SSC'),
  V('Ipswich', 'QLD', -27.608, 152.776, 'Australia/Brisbane', []),
  V('Toowoomba', 'QLD', -27.561, 151.92, 'Australia/Brisbane', ['Clifford Park']),
  V('Rockhampton', 'QLD', -23.38, 150.5, 'Australia/Brisbane', ['Callaghan Park']),
  V('Townsville', 'QLD', -19.3, 146.78, 'Australia/Brisbane', ['Cluden Park']),
  V('Morphettville', 'SA', -34.978, 138.541, 'Australia/Adelaide', ['Morphettville Parks']),
  V('Murray Bridge', 'SA', -35.09, 139.29, 'Australia/Adelaide', []),
  V('Gawler', 'SA', -34.6, 138.74, 'Australia/Adelaide', []),
  V('Oakbank', 'SA', -34.99, 138.84, 'Australia/Adelaide', []),
  V('Ascot', 'WA', -31.934, 115.934, 'Australia/Perth', []),
  V('Belmont', 'WA', -31.956, 115.927, 'Australia/Perth', ['Belmont Park']),
  V('Pinjarra', 'WA', -32.63, 115.87, 'Australia/Perth', ['Pinjarra Park']),
  V('Bunbury', 'WA', -33.34, 115.64, 'Australia/Perth', []),
  V('Northam', 'WA', -31.66, 116.67, 'Australia/Perth', []),
  V('Hobart', 'TAS', -42.846, 147.33, 'Australia/Hobart', ['Elwick', 'Tasracing Hobart']),
  V('Launceston', 'TAS', -41.443, 147.16, 'Australia/Hobart', ['Mowbray']),
  V('Devonport', 'TAS', -41.18, 146.36, 'Australia/Hobart', ['Spreyton']),
  V('Darwin', 'NT', -12.428, 130.847, 'Australia/Darwin', ['Fannie Bay']),
  V('Alice Springs', 'NT', -23.7, 133.88, 'Australia/Darwin', ['Pioneer Park']),
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function findVenue(nameOrSlug: string): VenueInfo | undefined {
  const n = norm(nameOrSlug);
  if (!n) return undefined;
  return (
    VENUES.find((v) => norm(v.name) === n || v.slug === n.replace(/\s+/g, '-')) ||
    VENUES.find((v) => v.aliases?.some((a) => norm(a) === n)) ||
    VENUES.find((v) => v.tab && v.tab.toLowerCase() === n) ||
    // "Flemington Racecourse" / "Sandown Hillside" style suffixes only; never "Newcastle UK" / "Ascot UK".
    VENUES.find((v) => n.startsWith(norm(v.name) + ' ') && !/\b(uk|gb|nz|usa|hk|ire|fr|jpn|sgp|za)$/.test(n))
  );
}

export function stateTimezone(state?: string): string {
  switch ((state || '').toUpperCase()) {
    case 'NSW':
    case 'ACT':
      return 'Australia/Sydney';
    case 'QLD':
      return 'Australia/Brisbane';
    case 'SA':
      return 'Australia/Adelaide';
    case 'WA':
      return 'Australia/Perth';
    case 'TAS':
      return 'Australia/Hobart';
    case 'NT':
      return 'Australia/Darwin';
    default:
      return 'Australia/Melbourne';
  }
}
