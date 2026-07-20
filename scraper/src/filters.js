// Turns raw listing text into structured fields and decides whether to keep a car.

/** "$8,500" -> 8500 ; returns null if no price found */
export function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, '').match(/\$?\s*(\d{3,7})/);
  return m ? parseInt(m[1], 10) : null;
}

/** "84K miles" -> 84000 ; "126,000 miles" -> 126000 ; null if none */
export function parseMileage(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/,/g, '');
  const k = t.match(/(\d+(?:\.\d+)?)\s*k\s*miles?/);
  if (k) return Math.round(parseFloat(k[1]) * 1000);
  const n = t.match(/(\d{3,7})\s*miles?/);
  return n ? parseInt(n[1], 10) : null;
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
