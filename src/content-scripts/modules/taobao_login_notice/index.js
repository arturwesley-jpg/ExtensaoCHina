// src/content-scripts/modules/taobao_login_notice/index.js
(() => {
  "use strict";
  const notice = globalThis.__xh_taobao_login_notice;
  if (notice) {
    notice.bootstrap();
  }
})();
