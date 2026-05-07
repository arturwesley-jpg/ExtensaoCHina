// auth-constants.js
"use strict";

(() => {
  const XH = globalThis.XH || (globalThis.XH = {});

  XH.authConstants = {
    KEYS: {
      TOKENS_LOCAL: "xh_tokens",
      LOGIN_STATE_LOCAL: "xh_login_state",
      LAST_EMAIL_LOCAL: "xh_last_email",
      MAGIC_LINK_RATE_LOCAL: "xh_magic_link_rate",
    },
    TTL_MS: {
      LOGIN_STATE: 15 * 60 * 1000,
      MAGIC_LINK: 30 * 60 * 1000,
      MAGIC_LINK_SEND_COOLDOWN: 30 * 1000,
    },
  };
})();
