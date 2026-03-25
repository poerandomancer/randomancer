const PUBLIC_CARD_REACTIONS = [
  { id: 'fire', label: 'Fire', icon: '🔥' },
  { id: 'cursed', label: 'Cursed', icon: '💀' },
  { id: 'big_brain', label: 'Big Brain', icon: '🧠' },
  { id: 'chaotic', label: 'Chaotic', icon: '🎲' },
];

const PUBLIC_CARD_REACTION_IDS = PUBLIC_CARD_REACTIONS.map((reaction) => reaction.id);

function isPublicCardReaction(value) {
  return PUBLIC_CARD_REACTION_IDS.includes(String(value || '').trim());
}

export {
  PUBLIC_CARD_REACTIONS,
  PUBLIC_CARD_REACTION_IDS,
  isPublicCardReaction,
};
