function sanitizeRestaurant(restaurant) {
  if (!restaurant) return null;
  const copy = { ...restaurant };
  copy.googleConfigured = !!copy.google_api_key;
  copy.groqConfigured = !!copy.groq_api_key;
  delete copy.google_api_key;
  delete copy.groq_api_key;
  return copy;
}

module.exports = {
  sanitizeRestaurant
};
