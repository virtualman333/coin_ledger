/**
 * 隐私授权：调 chooseMedia / setClipboardData 这类隐私接口前先确认。
 *
 * 微信 2023 之后要求：后台配置了《用户隐私保护指引》时，首次调用隐私接口要用户授权。
 * 官方推荐做法就是 getPrivacySetting + requirePrivacyAuthorize。
 * 若后台还没配置，这两个接口会失败 —— 此时直接放行，不要让用户卡住。
 */
function ensure() {
  return new Promise((resolve) => {
    if (typeof wx.getPrivacySetting !== 'function') return resolve(true);
    wx.getPrivacySetting({
      success: (res) => {
        if (!res || !res.needAuthorization) return resolve(true);
        wx.requirePrivacyAuthorize({
          success: () => resolve(true),
          fail: () => resolve(false),
        });
      },
      fail: () => resolve(true),
    });
  });
}

module.exports = { ensure };
