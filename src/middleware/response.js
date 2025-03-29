// 统一响应处理中间件
const responseHandler = (req, res, next) => {
    // 成功响应
    res.success = (data = null, message = '操作成功', code = 200) => {
      res.status(code).json({
        success: true,
        code,
        message,
        data
      });
    };
  
    // 错误响应
    res.error = (message = '操作失败', code = 500, error = null) => {
      res.status(code).json({
        success: false,
        code,
        message,
        data: null,
        error: error?.message || error
      });
    };
  
    next();
  };
  
  module.exports = responseHandler;