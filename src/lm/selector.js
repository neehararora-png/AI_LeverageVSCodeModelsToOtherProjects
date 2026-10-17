//@ts-check
'use strict';

function normalizeFamilies(families = ['copilot']) {
  return Array.isArray(families) ? families.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean) : ['copilot'];
}

function matchesAllowed(modelName, allowedFamilies) {
  const name = String(modelName || '').toLowerCase();
  const families = normalizeFamilies(allowedFamilies);
  return families.length === 0 || families.some((family) => name.includes(family));
}

function pickModel(requestedModel = '', availableModels = [], allowedFamilies = ['copilot']) {
  const models = Array.isArray(availableModels) ? availableModels : [];
  const requested = String(requestedModel || '').trim();
  const allowed = normalizeFamilies(allowedFamilies);

  if (models.length === 0) {
    return {
      id: requested || 'copilot',
      family: allowed[0] || 'copilot'
    };
  }

  const isAllowed = (model) => matchesAllowed([
    model.id,
    model.name,
    model.family
  ].filter(Boolean).join(' '), allowed);
  const exact = models.find((model) => {
    const id = String(model.id || model.name || '').toLowerCase();
    return id === requested.toLowerCase() && isAllowed(model);
  });
  if (exact) {
    return exact;
  }

  const byFamily = models.find(isAllowed);
  if (byFamily) {
    return byFamily;
  }

  if (requested) {
    const partial = models.find((model) => isAllowed(model)
      && String(model.id || model.name || '').toLowerCase().includes(requested.toLowerCase()));
    if (partial) {
      return partial;
    }
  }

  return null;
}

module.exports = {
  normalizeFamilies,
  matchesAllowed,
  pickModel
};
