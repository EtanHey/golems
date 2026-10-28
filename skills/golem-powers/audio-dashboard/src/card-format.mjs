// Authoring-spec lint; separate from the renderer's job schema.
export function lintCardFormat(card) {
  if (!card || typeof card.visualization !== 'boolean' ||
      ![undefined, 'view-details', 'listen-deeper'].includes(card.detailAffordance)) {
    return ['INVALID_CARD_FORMAT'];
  }
  if (!card.visualization && card.detailAffordance === 'view-details') {
    return ['TEXT_ONLY_VIEW_DETAILS'];
  }
  if (card.detailAffordance === 'listen-deeper') {
    const audio = card.innerAudio;
    if (!audio || !Array.isArray(audio.sceneIds) || !audio.sceneIds.length ||
        !audio.sceneIds.every(id => typeof id === 'string' && id.trim()) ||
        audio.readAlong !== true || audio.wordSeek !== true) {
      return ['INVALID_INNER_AUDIO'];
    }
  }
  return [];
}
