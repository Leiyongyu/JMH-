# 页面设计文档（Desktop-first）

## 全局样式（全站）
- 设计基调：沿用 Ant Design 默认风格，信息密度偏桌面管理台。
- 颜色 Token：
  - Primary: #1677ff
  - Danger(低库存/缺货提示): #ff4d4f
  - Text: rgba(0,0,0,0.88) / Secondary: rgba(0,0,0,0.45)
  - Page BG: #f5f5f5；Card BG: #ffffff
- 字体与排版：
  - Base font-size: 14px；标题 16–20px；价格数字可 18–22px 加粗
- 交互：
  - 卡片 hover：提升阴影 + 轻微上移（translateY(-2px)）
  - 链接与按钮：使用 antd Button/Link，保持一致性

## 1) eBay 商品列表页（卡片瀑布流/网格）

### Layout
- 桌面优先：页面为纵向堆叠结构（统计区 → 工具条 → 卡片流 → 分页）。
- 列表容器：
  - 网格模式：CSS Grid（推荐）`grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px;`
  - 瀑布流模式：CSS Columns（可选）`columns: 4 280px; column-gap: 16px;`，卡片 `break-inside: avoid; margin-bottom: 16px;`
- 响应式断点（从桌面向下适配）：
  - ≥1200px：4 列
  - 992–1199px：3 列
  - 768–991px：2 列
  - <768px：1 列（卡片满宽）

### Meta Information
- title：eBay 商品库
- description：以卡片瀑布流/网格浏览 eBay 在线商品，查看价格与库存并进入详情。
- Open Graph：
  - og:title = eBay 商品库
  - og:type = website

### Page Structure
1. 顶部统计区（沿用现有三张统计卡）
2. 工具条：搜索框 + 刷新 +（管理员）立即同步
3. 卡片流：商品卡片集合
4. 分页条：页码切换/每页数量

### Sections & Components
- 工具条（横向 Flex）：
  - Search（SKU/标题）
  - Button：刷新
  - Button（管理员）：立即同步（loading/旋转）
- 商品卡片（可点击容器）：
  - 图片区：
    - 16:9 或 1:1（建议 16:9，统一观感）
    - 无图片字段时使用默认占位图（灰底 + 图标）
    - 缺货可叠加半透明蒙层 + “缺货”角标
  - 标题区：两行截断，hover 显示 tooltip
  - 信息区（左右分布）：
    - 价格：币种 + 金额（加粗、主视觉）
    - 库存：`库存：N`，N < 阈值时标红
  - 操作区：
    - “查看详情”（或整卡可点击）
    - 若列表页已有“加入购物车”入口，保留为次按钮
- 状态与空态：
  - loading：Skeleton 卡片（至少 8–12 个占位）
  - 空结果：Empty + “清空搜索/返回第一页”

### Interaction
- 点击卡片：进入 `/products/:id`，通过路由 state 传递 `product`。
- 鼠标悬浮：卡片阴影增强；标题 tooltip。

## 2) 商品详情页

### Layout
- 桌面优先两栏：左图右信息（CSS Grid `grid-template-columns: 420px 1fr; gap: 24px;`）。
- 小屏变为单栏：图片在上，信息在下。

### Meta Information
- title：商品详情 - {SKU 或标题}
- description：查看商品价格、库存与 eBay 链接。
- Open Graph：
  - og:title = 商品详情 - {SKU 或标题}

### Page Structure
1. 面包屑/返回：返回商品列表
2. 主体两栏：
   - 左：商品图片
   - 右：标题、SKU、价格、库存、外链、（可选）加入购物车
3. 辅助信息：同步时间（如需要展示）

### Sections & Components
- 顶部：
  - Back Button：返回列表
  - Breadcrumb：商品库 / 商品详情（可选）
- 图片区：
  - 主图 + 占位策略同列表
- 信息区：
  - Title（H2）
  - Key-Value 列表：SKU、库存、币种/价格
  - eBay 链接：若 `itemUrl` 存在，提供“打开 eBay 商品页”（新标签页）
  - 容错提示：
    - 若无路由 state（刷新/直达）：显示 Alert/Empty “无法获取商品信息，请从列表进入”，提供“返回列表”按钮

### Interaction
- 默认从列表进入并展示完整信息。
- 刷新/直达：触发容错空态，不请求新接口。
