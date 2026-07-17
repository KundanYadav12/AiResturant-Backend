/**
 * Intelligent menu item matcher with alias support, substring matching,
 * and token-based fuzzy similarity scoring.
 */
function matchMenuItem(userInputName, menuItems) {
  if (!userInputName || typeof userInputName !== 'string') return null;

  const cleanInput = userInputName.toLowerCase().trim();

  // 1. Direct exact match
  let exactMatch = menuItems.find(
    (item) => item.name.toLowerCase().trim() === cleanInput
  );
  if (exactMatch) {
    return { item: exactMatch, score: 1.0, exact: true };
  }

  // 2. Common aliases & synonyms for Indian restaurants
  const aliases = {
    'butter roti': ['butter naan', 'tandoori roti', 'roti'],
    'roti': ['tandoori roti', 'butter naan'],
    'cold drink': ['coke', 'pepsi', 'sprite', 'soft drink'],
    'colddrink': ['coke', 'pepsi', 'sprite', 'soft drink'],
    'soft drink': ['coke', 'pepsi', 'sprite'],
    'softdrink': ['coke', 'pepsi', 'sprite'],
    'soda': ['coke', 'sprite'],
    'paneer butter': ['paneer butter masala'],
    'shikanji': ['masala shikanji', 'special masala shikanji', 'shikanji'],
    'paneer tikka': ['paneer tikka masala', 'paneer tikka'],
  };

  for (const [alias, targets] of Object.entries(aliases)) {
    if (cleanInput === alias || cleanInput.includes(alias)) {
      for (const target of targets) {
        const found = menuItems.find(
          (item) =>
            item.name.toLowerCase().includes(target) ||
            target.includes(item.name.toLowerCase())
        );
        if (found) {
          return { item: found, score: 0.9, exact: true };
        }
      }
    }
  }

  // 3. Substring match (e.g. "masala shikanji" -> "Special Masala Shikanji")
  let substringMatch = menuItems.find((item) => {
    const itemName = item.name.toLowerCase();
    return itemName.includes(cleanInput) || cleanInput.includes(itemName);
  });
  if (substringMatch) {
    return { item: substringMatch, score: 0.85, exact: true };
  }

  // 4. Word-based similarity / overlap scoring
  const fillers = new Set([
    'ek', 'do', 'teen', 'one', 'two', 'three', 'aur', 'with', 'plus', 'and',
    'please', 'add', 'order', 'bhai', 'ji', 'ki', 'ka', 'ko', 'deliver', 'table'
  ]);
  
  const getTokens = (str) =>
    str
      .split(/[\s,\-\+]+/)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
      .filter((w) => w.length > 1 && !fillers.has(w));

  const inputTokens = getTokens(cleanInput);
  if (inputTokens.length === 0) return null;

  let highestScore = 0;
  let candidate = null;

  for (const item of menuItems) {
    const itemTokens = getTokens(item.name.toLowerCase());
    if (itemTokens.length === 0) continue;

    // Jaccard similarity coefficient (intersection over union)
    const intersection = inputTokens.filter((t) => itemTokens.includes(t));
    const score = intersection.length / Math.max(inputTokens.length, itemTokens.length);

    if (score > highestScore) {
      highestScore = score;
      candidate = item;
    }
  }

  if (candidate && highestScore >= 0.4) {
    return {
      item: candidate,
      score: highestScore,
      exact: highestScore >= 0.7,
    };
  }

  return null;
}

module.exports = { matchMenuItem };
