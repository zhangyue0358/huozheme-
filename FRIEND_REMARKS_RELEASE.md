# 好友备注功能发布说明

## 已实现

- 好友显示为 `备注名称（原昵称）`。备注为空时只显示原昵称。
- 好友卡片右侧“戳一下”上方的三个点打开操作菜单，菜单内可修改或清空备注。
- 添加好友、接受好友申请前弹窗确认，并提供可选备注输入（最多 20 个 Unicode 码点）。发送申请前不新增查询对方资料的接口。
- 备注保存在当前用户拥有的 `friend_remarks` 记录中，快照只关联登录用户自己的记录；双方可设不同备注，原 `profiles.nickname` 不变。
- 待接受申请可保留发送方自己的备注；接受申请与接收方备注在同一事务保存。重复接受不覆盖后续修改或清除新戳一戳。
- 删除好友或注销账户会通过外键级联删除相关备注；重新添加不恢复旧备注。
- 好友回馈、有人戳你和删除确认也使用当前用户的备注显示。
- iOS 菜单与编辑表单复用一个原生 Modal，避免同时关闭、打开两个弹窗的冲突。弹窗兼容键盘、小屏及 iPad 宽度。

## 发布顺序

本构建分支已准备代码和本地验证，生产数据库迁移、后端部署及安装包构建仍待执行。

构建分支：`codemagic/friend-remarks-1.0.1-26-20261112`。
App 版本：`1.0.1`，iOS 构建号和 Android versionCode：`26`。
本次关闭自动递增及推送触发构建，Codemagic 手动选择 `iOS TestFlight IPA (EAS local)`。
上传成功后若再次发布不同二进制，须先递增构建号；不要重复上传同一版本和构建号组合。

1. 先备份并在生产数据库由表所有者执行 `domestic-backend/db/patch_friend_remarks.sql`。补丁仅新增表和索引，可重复执行；不要在现有数据库重新执行完整建库脚本。
2. 确认后端数据库账号有新表的权限。现有环境使用 `huozhema_user`，如默认授权未覆盖新增表，由表所有者单独执行：

   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON public.friend_remarks TO huozhema_user;
   ```

   不给 App 客户端或运营后台的只读账号直接开放备注表。
3. 同步后端 `src/server.js`、新增 `src/friendRemarks.js` 和 `db/schema.sql`；保留其余现有后端文件。部署时可 `npm ci --omit=dev`，PGlite 仅是开发测试依赖。启动检查会检查新表，缺少迁移时不要切换生产进程。
4. 验证 API 健康检查以及新旧客户端的好友列表、发送和接受申请。旧客户端不传 `remark`，字段缺省不会抹掉已有备注，`name` 字段仍是原昵称。
5. 后端升级完成后，从上述构建分支构建 iOS / Android 包。此功能需要新客户端，新包须在后端升级后发布。

如需回退后端，恢复之前的服务代码并保留新增表，勿删除已产生的备注数据。新 App 的备注编辑在旧 API 上不可用，应避免这样的版本组合。

## 本地验证

```sh
npm ci
npm run typecheck
npm run check:client-auth
npm run check:client-business
npm run check:friend-remarks
cd domestic-backend
npm ci
npm run check
npm run check:friend-remarks
```

新增后端测试使用 PGlite 的真实 PostgreSQL 引擎、实际 API 路由、模拟 HTTP 传输和测试用户，运行完整 SQL。不会加载 `.env`、连接生产数据库、发送短信或访问云存储。覆盖升级幂等、双方隐私、未登录和越权请求、输入验证、事务回滚、旧客户端兼容、删除与注销清理。它不能替代多连接 PostgreSQL 并发锁验证。

客户端回归覆盖实际弹窗和处理函数，验证菜单入口、首次添加/接受、失败保留草稿、重复点击、清空和账号切换。尚需在新安装包进行 iPhone / iPad / Android 真机视觉与键盘测试；本地检查不等同于已完成真机验收。

2026-11-12：以上类型检查、客户端回归、后端语法与备注测试全部通过；`expo export --platform ios --platform android` 的两端 Metro/Hermes 代码导出也通过。这是代码打包检查，不是签名 IPA / APK 安装包。
