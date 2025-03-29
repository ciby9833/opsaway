# OpsAway Backend

组织管理系统后端服务

## 技术栈

- Node.js + Express.js
- MySQL
- JWT (认证)
- bcrypt (密码加密)

## 项目结构

```
src/
  ├── config/     # 配置文件
  ├── controllers/# 控制器
  ├── middleware/ # 中间件
  ├── models/     # 数据模型
  ├── routes/     # 路由
  ├── utils/      # 工具函数
  └── app.js      # 应用入口
tests/            # 测试文件
```

## 安装

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入必要的配置信息
```

## 开发

```bash
# 启动开发服务器
npm run dev

# 运行测试
npm test
```

## 生产环境

```bash
# 启动生产服务器
npm start
```

## API 文档

API 文档将在开发过程中逐步完善。

## 环境变量

- `PORT`: 服务器端口
- `NODE_ENV`: 环境（development/production）
- `DB_HOST`: 数据库主机
- `DB_PORT`: 数据库端口
- `DB_USER`: 数据库用户名
- `DB_PASSWORD`: 数据库密码
- `DB_NAME`: 数据库名称
- `JWT_SECRET`: JWT 密钥
- `JWT_REFRESH_SECRET`: JWT 刷新密钥
- `ADMIN_EMAIL`: 管理员邮箱
- `ADMIN_PASSWORD`: 管理员密码
- `CORS_ORIGIN`: 允许的跨域来源 




让我详细解释环境切换的作用和部署流程：

1. **环境切换的作用**：
   - 开发环境（development）：
     - 显示详细的错误信息
     - 启用调试日志
     - 使用本地数据库
     - 允许跨域请求
     - 禁用缓存
   
   - 生产环境（production）：
     - 隐藏错误详情
     - 只记录重要日志
     - 使用生产数据库
     - 严格的安全设置
     - 启用缓存
     - 优化性能

2. **部署到生产环境的步骤**：

a. 首先，创建生产环境的配置文件 `.env.production`：

b. 创建部署脚本 `deploy.sh`：


# 停止当前运行的服务
pm2 stop opsaway-b || true

# 拉取最新代码
git pull origin main

# 安装依赖
npm install --production

# 复制生产环境配置
cp .env.production .env

# 构建应用（如果需要）
# npm run build

# 启动服务
pm2 start src/app.js --name opsaway-b --env production

# 保存 PM2 进程列表
pm2 save
```
c. 更新 `package.json` 添加部署相关脚本：


```
3. **部署流程**：

a. 本地开发：
```bash
# 开发环境
npm run dev
```

b. 部署到生产服务器：
```bash
# 1. 在服务器上安装依赖
npm install -g pm2

# 2. 首次部署
npm run deploy:prod

# 3. 后续更新
git pull
npm run deploy:prod
```

4. **生产环境需要调整的内容**：

a. 数据库配置：
- 使用生产环境的数据库连接信息
- 调整连接池配置
- 使用更强的密码

b. Redis配置：
- 使用生产环境的Redis服务器
- 设置密码
- 可能需要集群配置

c. 安全配置：
- 使用更强的JWT密钥
- 调整CORS设置
- 启用所有安全中间件

d. 性能配置：
- 调整连接池大小
- 配置缓存策略
- 启用压缩

e. 日志配置：
- 配置日志级别
- 设置日志轮转
- 配置错误监控

5. **环境切换的好处**：
- 开发时可以看到详细错误信息
- 生产环境更安全、性能更好
- 测试环境可以隔离数据
- 便于调试和维护



关于邮件发送：
#案例
// 这个文件只负责导出邮件模板  src/templates/index.js
// 这个文件负责邮件发送功能  src/config/email.js

在控制器中使用：
const emailTemplates = require('../templates/index');      // 获取邮件模板
const { sendEmail } = require('../config/email');         // 获取发送邮件的函数

emailTemplates 提供"写什么"（邮件内容）
sendEmail 负责"怎么发"（发送功能）
这种分离是为了：
关注点分离：模板和发送功能各自独立
更好的维护性：可以独立修改模板或发送逻辑
更好的复用性：同一个发送功能可以用于不同的模板
这就是为什么即使使用了统一的模板入口文件，我们仍然需要单独引入 sendEmail 函数。


关于数据库配置：
`config/index.js` 和数据库连接是两个不同的概念：

1. **config/index.js 的作用**：
- 这是一个配置文件，只包含配置信息（如数据库连接信息、端口号等）
- 它不包含实际的连接实例或功能实现


2. **数据库连接的实现**：
```javascript:src/config/database.js
const mysql = require('mysql2/promise');
const config = require('./index');  // 引入配置


3. **在模型中的使用**：
```javascript:src/models/user.model.js
const db = require('../config/database');  // 引入数据库连接实例
const config = require('../config');       // 引入配置（如果需要其他配置值）


这种分离的好处是：
1. **配置与实现分离**：
   - `config/index.js` 只负责管理配置值
   - `config/database.js` 负责创建和管理数据库连接
   - `models/user.model.js` 负责业务逻辑

2. **单一职责**：
   - 配置文件不应该包含实际的功能实现
   - 数据库连接文件负责创建和维护连接
   - 模型文件负责数据操作

3. **连接池复用**：
   - 数据库连接是一个需要被复用的资源
   - 通过 `database.js` 创建一个连接池
   - 所有模型共享同一个连接池

所以：
- `config/index.js` 是用来存储配置信息的
- 实际的功能实现（如数据库连接、邮件发送等）需要单独的文件
- 这些功能实现文件会使用 `config/index.js` 中的配置值

建议的文件结构：
```
src/
├── config/
│   ├── index.js         # 所有配置值
│   ├── database.js      # 数据库连接实现
│   ├── email.js         # 邮件功能实现
│   └── redis.js         # Redis连接实现
├── models/
│   └── user.model.js    # 使用数据库连接的模型
```
