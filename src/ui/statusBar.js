//@ts-check
'use strict';

function createStatusBar() {
  let state = 'off';

  return {
    getState() {
      return state;
    },
    setState(nextState) {
      if (['off', 'listening', 'error'].includes(nextState)) {
        state = nextState;
      }
      return state;
    },
    render() {
      return { state };
    }
  };
}

module.exports = {
  createStatusBar
};
