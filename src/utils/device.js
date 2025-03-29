// 获取用户设备信息
const getUserDeviceInfo = (req) => {
    const userAgent = req.headers['user-agent'];
    return JSON.stringify({
      userAgent,
      headers: {
        accept: req.headers.accept,
        'accept-language': req.headers['accept-language'],
        'accept-encoding': req.headers['accept-encoding']
      }
    });
  };
  
  module.exports = {
    getUserDeviceInfo
  };