'use strict';

// Home-screen key box. It does not depend on the preload bridge being
// detected: if no key is loaded, the box is shown. After a key is saved
// and practice/preview mode is off, live measurement is available.

function availabilityFromConfig(config) {
  const cfg = config || {};
  return {
    liveAvailable: Boolean(cfg.apiKey) && !cfg.forceMock && !cfg.preview,
  };
}

function homeKeyVisibility({ screen, liveAvailable, editingKey }) {
  const onHome = screen === 'lobby';
  const live = Boolean(liveAvailable);
  const editing = Boolean(editingKey);
  return {
    keyBoxHidden: !onHome || (live && !editing),
    removeHidden: !onHome || !live,
    changeKeyHidden: !onHome || !live || editing,
  };
}

module.exports = {
  availabilityFromConfig,
  homeKeyVisibility,
};
