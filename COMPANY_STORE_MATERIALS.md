# 活着吗公司主体上架材料清单

更新日期：2026-07-02

## 当前已确定

```text
应用名称：活着吗
运营主体：北京森贝科技有限公司
企业邮箱：senbeikeji@senbeikeji.cn
国家/地区：中国
隐私政策 URL：https://zhangyue0358.github.io/huozheme-/privacy.html
用户协议 URL：https://zhangyue0358.github.io/huozheme-/terms.html
产品官网 URL：https://zhangyue0358.github.io/huozheme-/
D-U-N-S Number：517429052
Android package：com.huozhema.app
iOS bundle id：com.huozhema.app
统一社会信用代码：91110108MAET83N58J
公司注册地址：北京市海淀区西北旺东路10号院东区15号楼-1层01
公司常用联系电话：18810409001
上架联系人姓名：张越
上架联系人手机号：18810409001
```

## 还需要你补齐

```text
公司官网或产品官网：https://zhangyue0358.github.io/huozheme-/
D-U-N-S Number：517429052
```

建议优先补：

1. 继续完成 Apple Developer 组织账号注册。
2. 注册 Google Play Console 组织账号。
3. 后续把产品官网绑定到公司域名，例如 `huozhema.senbeikeji.cn`。

## Apple Developer 组织账号

需要准备：

- 公司/组织法律实体名称：北京森贝科技有限公司
- 统一社会信用代码：91110108MAET83N58J
- 公司注册地址：北京市海淀区西北旺东路10号院东区15号楼-1层01
- 公司电话：18810409001
- 有权代表公司签署协议的人：张越
- D-U-N-S Number：517429052
- 公司官网/产品官网：https://zhangyue0358.github.io/huozheme-/
- Apple Account，并开启双重认证
- Apple Developer Program 年费

注意：

- 组织账号通过后，App Store 展示的 seller name 通常会是公司主体，而不是个人姓名。
- D-U-N-S 信息要尽量和营业执照/公司官网信息一致。
- 如果 D-U-N-S 暂时没有，先申请/查询，不要等提交时才处理。

## D-U-N-S Number 是什么

D-U-N-S Number 是 Dun & Bradstreet 维护的 9 位企业识别码，用来识别一个具体法律实体和地址。

Apple 用它来校验公司/组织身份和法律实体状态。公司和教育机构加入 Apple Developer Program 组织账号时，需要提供注册在法律实体名下的 D-U-N-S Number；个人开发者不需要。

Google Play 组织开发者账号也要求 D-U-N-S Number。组织账号通常需要 D-U-N-S、组织名称、组织地址、组织电话、组织网站、联系人、开发者邮箱和开发者电话。如果没有 D-U-N-S，可以向 Dun & Bradstreet 申请，流程可能需要最多 30 天，因此要提前准备。

## D-U-N-S 准备结果

Apple Developer 邮件已返回公司 D-U-N-S：

```text
公司英文名：Beijing Senbei Technology Co., Ltd
D-U-N-S Number：517429052
```

后续在 Apple Developer Program 或 Google Play Console 组织账号里使用该编号。

待查询资料：

```text
公司名称：北京森贝科技有限公司
统一社会信用代码：91110108MAET83N58J
注册地址：北京市海淀区西北旺东路10号院东区15号楼-1层01
联系电话：18810409001
联系人：张越
联系邮箱：senbeikeji@senbeikeji.cn
```

## Google Play 组织账号

需要准备：

- Developer name：建议用“北京森贝科技有限公司”或品牌名“活着吗”
- D-U-N-S Number：517429052
- 组织名称：北京森贝科技有限公司
- 组织地址：北京市海淀区西北旺东路10号院东区15号楼-1层01
- 组织电话：18810409001
- 组织网站：https://zhangyue0358.github.io/huozheme-/
- 联系人姓名：张越
- 联系邮箱：senbeikeji@senbeikeji.cn
- 联系电话：18810409001
- 公开开发者邮箱：senbeikeji@senbeikeji.cn
- 公开开发者电话：18810409001
- Google Play Console 注册费

注意：

- Google Play 组织账号会公开显示法律名称、法律地址、开发者邮箱和开发者电话。
- 联系邮箱、联系电话、开发者邮箱、开发者电话都需要能收验证码，并且后续保持可用。
- 组织账号的公司名称和地址需要和 Google Payments / D-U-N-S 资料匹配。

## 国内安卓市场

国内安卓市场通常会额外需要：

- 营业执照
- 法人/经办人身份信息
- 软件著作权，简称软著
- ICP 备案或 APP 备案材料
- 隐私政策 URL
- 用户协议 URL
- App 权限说明
- App 截图
- APK 或 AAB 包
- 加固/安全检测报告，部分市场可能要求

建议顺序：

1. 先做 Apple / Google Play 组织账号。
2. 同时准备软著申请材料。
3. 再处理国内安卓市场。

## 当前最短路径

1. 等 Apple 身份筛查/身份信息审核完成。
2. 继续 Apple Developer Program 组织账号注册，填入 D-U-N-S：`517429052`。
3. 注册 Google Play Console 组织账号，填入同一 D-U-N-S。
4. 决定正式登录方案，优先解决手机号短信服务商。
5. 明确账号注销路径：服务端删除 Supabase Auth 用户，或先提供人工注销邮箱。
6. 正式包关闭测试账号按钮。
7. 准备 App Store / Google Play 截图。
8. 等 EAS Android 构建额度恢复，重新打 Android preview 包。
