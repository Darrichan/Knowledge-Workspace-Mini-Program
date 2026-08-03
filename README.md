# KW 微信小程序

Knowledge Workspace 的微信小程序端。

这是可由微信开发者工具直接导入的微信小程序工程，技术栈为 Taro 4、React、TypeScript 和 Sass。`mobile-app` 只保留为移动端设计预览，不是小程序发布代码。

## 本地开发

1. 启动现有 FastAPI 服务，默认地址为 `http://127.0.0.1:18000/api/v1`。
2. 在本目录执行 `npm run dev:weapp`。
3. 使用微信开发者工具导入本目录；小程序目录已经配置为 `dist`。
4. 本地联调已在 `project.config.json` 关闭合法域名校验。

真机调试不能使用 `127.0.0.1`。请把 `.env.development` 的地址替换为电脑局域网 IP，然后重新构建，并确认手机与电脑处于同一网络。

## 发布前配置

- `project.config.json` 已配置正式小程序 AppID 和 `cloudfunctions` 目录。
- 在微信开发者工具中选择当前云开发环境，上传并部署 `apiGateway` 云函数。
- 云函数只代理 JSON API 请求到 `https://kw.darrichan.top/api/v1`，AppSecret 仍只保存在 FastAPI 服务器。
- 在服务器 `/etc/knowledge-workspace/env` 配置同一小程序的 `WECHAT_MINI_APP_ID` 和 `WECHAT_MINI_APP_SECRET` 后重新部署 API。
- 在小程序后台补齐隐私保护指引、用户信息用途和所需接口权限。

## 云函数部署

1. 微信开发者工具导入本目录并开通或选择云开发环境。
2. 在“云开发”面板确认环境正常。
3. 右键 `cloudfunctions/apiGateway`，选择“上传并部署：云端安装依赖”。
4. 正式构建使用 `TARO_APP_API_MODE=cloud`，小程序不直接访问香港服务器。
5. 云函数环境变量可选设置 `KW_API_BASE`；未设置时固定使用 `https://kw.darrichan.top/api/v1`。

## 已接入页面

- 邮箱登录、邀请码注册、滑块验证
- 已绑定账号的微信快捷登录与登录后绑定
- 首页、我的空间、与我共享、个人中心
- 文档移动编辑与自动保存
- 思维导图移动编辑、横向画布与自动保存
- 文档、思维导图、表格、甘特图、文件夹创建入口
