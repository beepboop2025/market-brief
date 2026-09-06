/** Choose the reading order; this does not calculate investment risk. */
export function orderCards(cards) {
  const priority = (card) => {
    if (['value_changed', 'state_changed'].includes(card.changeKind)) return 0;
    if (card.availability !== 'reported') return 1;
    if (card.changeKind === 'not_comparable') return 2;
    return 3;
  };
  return [...cards].sort((a, b) => priority(a) - priority(b)
    || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
