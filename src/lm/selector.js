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

  const exact = models.find((model) => {
    const id = String(model.id || model.name || '').toLowerCase();
    return id === requested.toLowerCase();
  });
  if (exact && matchesAllowed(String(exact.id || exact.name || ''), allowed)) {
    return exact;
  }

  const byFamily = models.find((model) => matchesAllowed(String(model.id || model.name || ''), allowed));
  if (byFamily) {
    return byFamily;
  }

  if (requested) {
    const partial = models.find((model) => String(model.id || model.name || '').toLowerCase().includes(requested.toLowerCase()));
    if (partial) {
      return partial;
    }
  }

  return models[0];
}

module.exports = {
  normalizeFamilies,
  matchesAllowed,
  pickModel
};
