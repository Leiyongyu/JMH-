# 页面设计说明（桌面端优先）

## 全局样式（适用于本页面所在的后台框架）
- Layout：整体采用 CSS Grid（左侧固定导航 + 右侧内容区），内容区内部使用 Flexbox 进行横向排列（搜索栏/操作区）。
- Spacing：以 8px 为基础栅格；卡片/区块内边距 16–24px；表格行高 44–48px。
- Typography：
  - H1 20px/28px（页面标题）
  - Body 14px/22px（正文/表格）
  - Caption 12px（辅助信息）
- Color tokens（与现有系统不冲突为前提，可映射到现有 token）：
  - Background：#F7F8FA（页面底色）
  - Surface：#FFFFFF（卡片/表格容器）
  - Text primary：#1F2329；Text secondary：#646A73
  - Border：#E5E6EB
  - Primary：#1677FF（主按钮/高亮）
  - Danger：#F53F3F（错误态）
- Button/Link 状态：
  - 按钮 hover 加深 6–8%；disabled 降低透明度并禁用点击
  - 链接 hover 显示下划线

## 页面：用户管理页

### 1) Meta Information
- Title：用户管理 - eBay 商品
- Description：管理员查看与搜索系统用户列表。
- Open Graph：
  - og:title = 用户管理
  - og:description = 管理员查看与搜索系统用户列表

### 2) Page Structure
- 外层：后台主框架（已存在）
  - 左侧 Sidebar：包含“eBay 商品”分组（可展开/折叠）
  - 右侧 Main：承载用户管理页面内容
- 内容区采用“标题区 + 筛选区 + 表格区 + 分页区”的纵向堆叠结构。

### 3) Sections & Components

#### A. 左侧菜单（导航增强点）
- 组件：SidebarMenu / SubMenu
- 在“eBay 商品”下新增子项：
  - 文案：用户管理
  - 图标：复用现有列表/用户类图标（如系统已有）
  - 交互：点击跳转到 /ebay/users；保持选中态高亮

#### B. 页面标题与面包屑
- 顶部行（同一行内左右布局，Flex）：
  - 左：
    - H1：用户管理
    - Breadcrumb：eBay 商品 / 用户管理（若系统已有面包屑组件则复用）
  - 右：预留（本期不增加新增/导出等按钮）

#### C. 搜索区（基础搜索）
- 容器：Surface 卡片或与表格同容器顶部工具栏
- 组件：
  - Input（placeholder：搜索邮箱/用户名）
  - Button：搜索
  - Button/Link：清空
- 交互规则：
  - 回车触发搜索
  - 清空后恢复默认列表并回到第 1 页

#### D. 用户表格区（列表展示）
- 组件：DataTable
- 列定义（按信息密度从左到右）：
  - 用户ID（可截断展示，支持 hover 显示完整）
  - 邮箱/用户名
  - 角色（admin/user 标签样式）
  - 状态（active/disabled 标签样式）
  - 创建时间（格式化显示）
- 状态设计：
  - Loading：表格骨架屏（5–10 行）
  - Empty：空态文案“暂无用户”或“未找到匹配结果”
  - Error：错误提示条（展示简要原因 + 重试按钮）

#### E. 分页区
- 组件：Pagination
- 显示：上一页/下一页、页码、每页条数（10/20/50）
- 行为：
  - 切页保持当前搜索条件
  - 修改每页条数后回到第 1 页

#### F. 权限拦截（仅管理员）
- 触发点：进入路由 /ebay/users 时
- 表现：
  - 推荐：直接显示“无权限访问”空白态（含返回按钮）或跳转回可访问的默认页
  - 文案：你没有权限访问该页面，请联系管理员

### 4) Responsive（简单适配）
- >= 1200px：标准两栏（Sidebar + Main），表格完整列
- 768–1199px：Sidebar 可收起为图标栏；表格列允许更紧凑并对“用户ID”列更早截断
- < 768px：允许 Sidebar 抽屉化；表格可横向滚动（仍保证可用）
