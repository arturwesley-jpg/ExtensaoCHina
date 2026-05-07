/**
 * Jest setup — mock chrome APIs (runs before test framework)
 */

// chrome.storage.local mock
const storageLocal = {};
const storageSync = {};

global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys, cb) => {
        if (typeof keys === "string") cb({ [keys]: storageLocal[keys] });
        else if (Array.isArray(keys)) {
          const result = {};
          for (const k of keys) result[k] = storageLocal[k];
          cb(result);
        } else cb({ ...storageLocal });
      }),
      set: jest.fn((items, cb) => {
        Object.assign(storageLocal, items);
        if (cb) cb();
      }),
    },
    sync: {
      get: jest.fn((keys, cb) => {
        if (typeof keys === "string") cb({ [keys]: storageSync[keys] });
        else if (Array.isArray(keys)) {
          const result = {};
          for (const k of keys) result[k] = storageSync[k];
          cb(result);
        } else cb({ ...storageSync });
      }),
      set: jest.fn((items, cb) => {
        Object.assign(storageSync, items);
        if (cb) cb();
      }),
    },
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    onAlarm: { addListener: jest.fn() },
  },
  runtime: {
    getURL: jest.fn((path) => `chrome-extension://fake-id/${path}`),
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
  },
  scripting: {
    registerContentScripts: jest.fn(),
    executeScript: jest.fn(),
  },
  tabs: {
    query: jest.fn((q, cb) => cb([])),
  },
};
