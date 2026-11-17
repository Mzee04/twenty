'use strict';

function createLiveSession() {
  return {
    async start() {
      throw new Error('Live measurement is not available in the browser preview.');
    },
    async stop() {},
  };
}

module.exports = { createLiveSession };
