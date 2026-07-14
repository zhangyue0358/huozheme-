# 活着吗上架截图素材

这个目录用于保存应用商店截图素材。

## 目录

- `source/`：从手机导出的原始截图。
- `iphone/`：准备上传 App Store Connect 的 iPhone 截图。
- `android/`：准备上传 Google Play Console 的手机截图。

## 推荐文件名

按下面顺序保存最终 5 张截图：

1. `01_home.png`：首页确认活着
2. `02_journal_photos_quote.png`：随笔、照片和每日箴言
3. `03_todos.png`：今天最想做的三件事
4. `04_calendar.png`：打卡日历
5. `05_friends.png`：好友存活雷达

## 检查

放好截图后运行：

```bash
npm run export:screenshots
npm run check:screenshots
```

`export:screenshots` 会把 `source/` 里的原图导出为 App Store Connect 6.9 英寸 iPhone 截图尺寸：`1290 x 2796`。
同时会导出 Android 版本到 `android/`：保留原图比例，不裁切不拉伸，只补左右深色边框，使截图满足 Google Play 的比例要求。

检查重点：

- 不出现真实手机号、邮箱、定位、店铺名、第三方品牌。
- 不出现红屏、Expo 菜单、开发调试文字。
- 不出现文字重叠、按钮被底部导航遮挡。
- iPhone 截图优先准备 1-10 张。
- Android 手机截图至少 2 张，建议 4 张以上。
