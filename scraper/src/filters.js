// Turns raw listing text into structured fields and decides whether to keep a car.

/** "$8,500" -> 8500 ; returns null if no price found */
export function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, '').match(/\$?\s*(\d{3,7})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Parse mileage from various formats:
 *   "84K miles" / "84k millas"   -> 84000
 *   "126,000 miles"              -> 126000
 *   "158.000 Millas" (euro/es)   -> 158000
 *   "Driven 84,000 miles"        -> 84000
 * Returns null if no mileage found.
 */
export function parseMileage(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  // "84k" / "84.5k" (optionally followed by miles/millas)
  let m = t.match(/(\d+(?:[.,]\d+)?)\s*k\b\s*(?:miles?|millas?|mi\b)?/);
  if (m && /k/.test(m[0])) return Math.round(parseFloat(m[1].replace(',', '.')) * 1000);
  // "158,000 miles" / "158.000 millas" / "84000 mi" / "Driven 126,000 miles"
  m = t.match(/(\d[\d.,]{2,})\s*(?:miles?|millas?|mi\b)/);
  if (m) return parseInt(m[1].replace(/[.,]/g, ''), 10);
  return null;
}

/** first 19xx/20xx in the title -> number ; null if none */
export function parseYear(title) {
  if (!title) return null;
  const m = String(title).match(/\b(19[8-9]\d|20[0-4]\d)\b/);
  return m ? parseInt(m[1], 10) : null;
}

function textIncludesAny(haystack, needles) {
  const h = (haystack || '').toLowerCase();
  return (needles || []).some((n) => h.includes(String(n).toLowerCase()));
}

// Browsing the "vehicles" category also returns motorcycles, boats, RVs and
// trailers. A real CAR title almost always names a car make, model, or body
// style — none of which appear on a boat/bike/RV. Require one.
const CAR_RE = new RegExp('\\b(' + [
  // makes
  'toyota','honda','ford','chevrolet','chevy','nissan','hyundai','kia','jeep','mazda','subaru','bmw',
  'mercedes','benz','lexus','dodge','gmc','ram','acura','infiniti','audi','volkswagen','vw','volvo',
  'cadillac','buick','chrysler','mitsubishi','tesla','lincoln','genesis','porsche','jaguar','fiat',
  'maserati','bentley','ferrari','lamborghini','scion','pontiac','saturn','hummer','saab','isuzu',
  'lucid','rivian','polestar','datsun','mercury','land rover','range rover','alfa romeo','mini cooper',
  'mini','lotus','rolls','mclaren','aston martin','bugatti','maybach','koenigsegg',
  // body styles
  'sedan','suv','coupe','hatchback','pickup','minivan','wagon','convertible','crossover',
  // common models (help titles that omit the make)
  'camry','corolla','rav4','tacoma','tundra','4runner','highlander','sienna','prius','avalon','supra','venza',
  'civic','accord','cr-v','pilot','odyssey','hr-v','passport','ridgeline','insight',
  'f-150','f150','f-250','f250','mustang','explorer','escape','expedition','fusion','ranger','bronco','maverick',
  'silverado','equinox','malibu','tahoe','suburban','camaro','colorado','traverse','corvette','impala','cruze','blazer',
  'altima','sentra','rogue','murano','maxima','frontier','pathfinder','versa','kicks','armada','titan','leaf',
  'elantra','sonata','tucson','santa fe','palisade','kona','accent','veloster','ioniq','santa cruz',
  'forte','sorento','sportage','telluride','seltos','optima','stinger','carnival',
  'wrangler','grand cherokee','cherokee','compass','gladiator','renegade',
  'mazda3','mazda6','miata','cx-5','cx-9','cx-30','cx-50','cx-3',
  'outback','forester','crosstrek','impreza','ascent','legacy','wrx',
  '3 series','5 series','4 series','330i','328i','glc','gle','gla','gls','c-class','e-class','s-class','sprinter',
  'charger','challenger','durango','grand caravan','sierra','yukon','acadia','terrain',
  'tlx','mdx','rdx','qx60','qx80','q5','q7','q3','a4','a6','a5','e-tron',
  'atlas','tiguan','jetta','passat','golf','gti','taos'
].join('|') + ')\\b', 'i');

export function looksLikeCar(car) {
  return CAR_RE.test((car.title || '') + ' ' + (car.mileage || ''));
}

function matchesWanted(car, w) {
  const title = (car.title || '').toLowerCase();

  if (w.make && !title.includes(w.make.toLowerCase())) return false;

  if (w.models && w.models.length > 0) {
    const ok = w.models.some((m) => title.includes(m.toLowerCase()));
    if (!ok) return false;
  }

  if (w.keywords && w.keywords.length > 0) {
    if (!textIncludesAny(title, w.keywords)) return false;
  }

  if (w.yearMin != null || w.yearMax != null) {
    if (car.year == null) return false; // spec asks about year but we couldn't read one
    if (w.yearMin != null && car.year < w.yearMin) return false;
    if (w.yearMax != null && car.year > w.yearMax) return false;
  }

  if (w.priceMin != null && (car.priceValue == null || car.priceValue < w.priceMin)) return false;
  if (w.priceMax != null && (car.priceValue == null || car.priceValue > w.priceMax)) return false;

  if (w.maxMileage != null && car.mileageValue != null && car.mileageValue > w.maxMileage) return false;

  return true;
}

/** Returns true if the car should be kept, given the config.filters block. */
export function keepCar(car, filters) {
  if (!filters) return true;

  if (textIncludesAny(car.title, filters.excludeKeywords)) return false;

  // Must actually be a car (drops boats/motorcycles/RVs from the vehicles browse).
  if (!looksLikeCar(car)) return false;

  // City whitelist: if set and we know the car's city, it must be in the list.
  const include = filters.includeCities;
  if (include && include.length > 0 && car.city) {
    const city = car.city.toLowerCase().trim();
    const ok = include.some((c) => c.toLowerCase() === city);
    if (!ok) return false;
  }

  const wanted = filters.wanted || [];
  if (wanted.length === 0) return true; // no specs => keep everything

  return wanted.some((w) => matchesWanted(car, w));
}
