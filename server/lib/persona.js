// Helpers for storing and restoring the AI persona fields attached to an influencer.

/** Deep clone of persona fields, without nested defaults metadata. */
export function snapshotPersonaDefaults(persona) {
  if (!persona || typeof persona !== "object") return {};
  const { personaDefaults: _drop, ...rest } = persona;
  return JSON.parse(JSON.stringify(rest));
}

/** Keep the original generated snapshot (and answers) when the user edits persona. */
export function mergePersonaUpdate(existing = {}, incoming = {}) {
  const merged = { ...incoming };
  if (!merged.personaDefaults && existing.personaDefaults) {
    merged.personaDefaults = existing.personaDefaults;
  }
  if (merged.answers === undefined && existing.answers !== undefined) {
    merged.answers = existing.answers;
  }
  return merged;
}

/** Persona object ready to persist at launch time. */
export function personaWithDefaults(character) {
  const snapshot = snapshotPersonaDefaults(character);
  // Posting cadence lives on posting_schedule, not in AI persona fields.
  if (snapshot.postingStrategy) {
    const legacyThemes = snapshot.postingStrategy.hashtagThemes;
    delete snapshot.postingStrategy;
    if (Array.isArray(legacyThemes) && legacyThemes.length && !snapshot.hashtagThemes?.length) {
      snapshot.hashtagThemes = legacyThemes;
    }
  }
  return {
    ...snapshot,
    personaDefaults: snapshotPersonaDefaults(snapshot),
  };
}
