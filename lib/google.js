/* Best-effort fetch of Google Business reviews via the Places API.
   Cached in memory for an hour to limit API calls. Returns null when
   not configured or when the request fails and nothing is cached yet —
   callers should treat that as "no Google reviews to show". */

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const GOOGLE_PLACE_ID = process.env.GOOGLE_PLACE_ID;

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache = { data: null, fetchedAt: 0 };

async function fetchGoogleReviews() {
  if (!GOOGLE_API_KEY || !GOOGLE_PLACE_ID) return null;

  const now = Date.now();
  if (cache.data && (now - cache.fetchedAt) < CACHE_TTL_MS) return cache.data;

  try {
    const url = 'https://maps.googleapis.com/maps/api/place/details/json'
      + '?place_id=' + encodeURIComponent(GOOGLE_PLACE_ID)
      + '&fields=rating,user_ratings_total,reviews,url'
      + '&language=fr&key=' + GOOGLE_API_KEY;
    const res = await fetch(url);
    if (!res.ok) return cache.data;
    const body = await res.json();
    if (body.status !== 'OK' || !body.result) return cache.data;

    const result = body.result;
    const data = {
      rating: result.rating || null,
      totalReviews: result.user_ratings_total || 0,
      profileUrl: result.url || null,
      reviews: (result.reviews || []).slice(0, 5).map((r) => ({
        author: r.author_name,
        rating: r.rating,
        text: r.text,
        relativeTime: r.relative_time_description
      }))
    };
    cache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    console.error('[google] fetch failed', err);
    return cache.data;
  }
}

module.exports = { fetchGoogleReviews };
